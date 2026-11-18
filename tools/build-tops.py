#!/usr/bin/env python3
"""Статичні топи: IMDb dataset (Top 250 / Top 100 / Top 100 TV) + TMDB discover.

Запуск: python3 tools/build-tops.py
Вихід: src/tops-data.js -> const MC_TOPS = [...]
"""

import gzip
import json
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools' / '.cache' / 'tops'
CACHE.mkdir(parents=True, exist_ok=True)
RATINGS = CACHE / 'title.ratings.tsv.gz'
BASICS = CACHE / 'title.basics.tsv.gz'
OUT = ROOT / 'src' / 'tops-data.js'
UNRESOLVED = ROOT / 'tools' / 'unresolved-tops.json'

PROXY = 'https://mycinema-proxy.insaneteresh123.workers.dev'
IMDB_DS = 'https://datasets.imdbws.com/title.ratings.tsv.gz'
WORKERS = 6
TIMEOUT = 20
M = 25000


def fetch(url, tries=2):
    last = None
    for i in range(tries + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 MyCinema/1.0'})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            if i < tries:
                time.sleep(0.5 * (i + 1))
    raise last


def get_json(url):
    return json.loads(fetch(url).decode('utf-8'))


def cached(name, producer):
    p = CACHE / (re.sub(r'[^a-zA-Z0-9]+', '_', name) + '.json')
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    value = producer()
    p.write_text(json.dumps(value, ensure_ascii=False))
    return value


def norm(t):
    t = (t or '').lower().strip()
    t = re.sub(r'[^\w\s]+', ' ', t, flags=re.UNICODE)
    return re.sub(r'\s+', ' ', t).strip()


def year_of(v):
    m = re.match(r'(\d{4})', str(v or ''))
    return int(m.group(1)) if m else 0


def imdb_rows(limit=650):
    if not RATINGS.exists():
        print('Завантажую IMDb ratings…')
        RATINGS.write_bytes(fetch(IMDB_DS))
    rows, ratings = [], []
    with gzip.open(RATINGS, 'rt', encoding='utf-8') as f:
        next(f)
        for line in f:
            p = line.rstrip('\n').split('\t')
            if len(p) != 3:
                continue
            try:
                r, v = float(p[1]), int(p[2])
            except ValueError:
                continue
            ratings.append(r)
            if v >= M:
                rows.append((p[0], r, v))
    C = sum(ratings) / len(ratings)
    rows.sort(key=lambda x: (x[2] / (x[2] + M)) * x[1] + (M / (x[2] + M)) * C, reverse=True)
    print(f'IMDb: {len(ratings)} рейтингів, {len(rows)} з >=25k, C={C:.3f}')
    return rows[:limit]


def basics_lookup(wanted):
    """Один прохід по title.basics.tsv.gz — назви й типи тільки для потрібних ID."""
    found = {}
    if not BASICS.exists():
        print('Завантажую IMDb basics…')
        BASICS.write_bytes(fetch('https://datasets.imdbws.com/title.basics.tsv.gz'))
    with gzip.open(BASICS, 'rt', encoding='utf-8') as f:
        next(f)
        for line in f:
            if not line or line[0] != 't':
                continue
            p = line.rstrip('\n').split('\t')
            if len(p) >= 6 and p[0] in wanted:
                found[p[0]] = {
                    'title': p[2] if p[2] != '\\N' else '',
                    'year': year_of(p[5] if p[5] != '\\N' else ''),
                    'type': p[1],
                }
                if len(found) == len(wanted):
                    break
    return found


def tmdb_search(kind, title, year):
    def produce():
        params = {'query': title, 'language': 'en-US'}
        if year:
            params['year'] = str(year)
        try:
            data = get_json(f'{PROXY}/search/{kind}?' + urllib.parse.urlencode(params))
            results = data.get('results') or []
        except Exception:  # noqa: BLE001
            results = []
        target = norm(title)
        best, score = None, 0
        for row in results:
            names = [norm(row.get('title') or row.get('name') or ''),
                     norm(row.get('original_title') or row.get('original_name') or '')]
            ry = year_of(row.get('release_date') or row.get('first_air_date'))
            for n in names:
                if not n:
                    continue
                s = 1.0 if n == target else (0.8 if target in n or n in target else 0)
                if s and abs(ry - year) <= 2:
                    if s > score or (s == score and row.get('vote_count', 0) > (best or {}).get('vote_count', 0)):
                        best, score = row, s
        return best or None
    return cached(f'tmdb_{kind}_{norm(title)}_{year}', produce)


def to_item(row, kind):
    return {
        'key': f'{kind}-{row["id"]}',
        'id': row['id'],
        'type': kind,
        'title': row.get('title') or row.get('name') or '',
        'year': year_of(row.get('release_date') or row.get('first_air_date')),
        'poster': row.get('poster_path') or '',
        'rating': round(float(row.get('vote_average') or 0), 1),
    }


def resolve_meta(candidates, kind, limit):
    """Порядок результату = порядок IMDb WR (НЕ пересортовуємо за TMDB-рейтингом)."""
    results, unresolved = {}, []
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(tmdb_search, kind, m['title'], m['year']): m for m in candidates}
        for f in as_completed(futures):
            meta = futures[f]
            row = f.result()
            if row and row.get('id') and row.get('poster_path'):
                results[(meta['title'], meta['year'])] = to_item(row, kind)
            else:
                unresolved.append({'title': meta['title'], 'year': meta['year'], 'type': kind})
    out = []
    for meta in candidates:
        item = results.get((meta['title'], meta['year']))
        if item:
            out.append(item)
        if len(out) >= limit:
            break
    return out, unresolved


def discover(kind, params, limit=100):
    def produce():
        pages = []
        for pg in (1, 2, 3):
            q = dict(params)
            q.update({'page': pg, 'language': 'en-US'})
            try:
                pages += (get_json(f'{PROXY}/discover/{kind}?' + urllib.parse.urlencode(q)).get('results') or [])
            except Exception:  # noqa: BLE001
                pass
        seen, out = set(), []
        for r in pages:
            if not r.get('poster_path') or r['id'] in seen:
                continue
            seen.add(r['id'])
            out.append(to_item(r, kind))
        return out[:limit]
    return cached('discover_' + kind + '_' + urllib.parse.urlencode(sorted(params.items())), produce)


def keyword_id(query):
    def produce():
        try:
            d = get_json(f'{PROXY}/search/keyword?' + urllib.parse.urlencode({'query': query, 'language': 'en-US'}))
            results = d.get('results') or []
            return results[0]['id'] if results else 0
        except Exception:  # noqa: BLE001
            return 0
    return cached('keyword_' + norm(query), produce)


def main():
    unresolved = []
    tops = []

    rows = imdb_rows(2000)
    wanted = {t for t, _, _ in rows}
    print('Шукаю назви в IMDb basics…')
    basics = basics_lookup(wanted)

    movies = []
    series = []
    for t, _, _ in rows:
        m = basics.get(t)
        if not m or not m.get('title'):
            continue
        if m['type'] == 'movie' and len(movies) < 260:
            movies.append(m)
        elif m['type'] in ('tvSeries', 'tvMiniSeries') and len(series) < 110:
            series.append(m)
        if len(movies) >= 260 and len(series) >= 110:
            break
    print(f'Кандидатів: movie={len(movies)}, series={len(series)}')

    for tid, title, sub, kind, source, limit in [
        ('imdb250', 'ТОП 250 IMDb', 'найкращі фільми за версією IMDb', 'movie', movies, 250),
        ('imdb100', 'ТОП 100 IMDb', 'класика кіно', 'movie', movies, 100),
        ('imdbtv100', 'ТОП 100 серіалів IMDb', 'найкращі серіали', 'tv', series, 100),
    ]:
        items, miss = resolve_meta(source, kind, limit)
        unresolved += miss
        tops.append({'id': tid, 'title': title, 'subtitle': sub, 'source': 'IMDb', 'items': items})
        print(f'{title}: {len(items)}')

    for tid, title, kind, params in [
        ('comedy100', 'ТОП 100 Комедій', 'movie', {'with_genres': '35', 'sort_by': 'vote_count.desc', 'vote_count.gte': '5000'}),
        ('scifi100', 'ТОП наукова фантастика', 'movie', {'with_genres': '878', 'sort_by': 'vote_count.desc', 'vote_count.gte': '5000'}),
        ('cartoon100', 'ТОП 100 Мультфільтів', 'movie', {'with_genres': '16', 'sort_by': 'vote_count.desc', 'vote_count.gte': '5000'}),
        ('netflix50', 'ТОП 50 серіалів Netflix', 'tv', {'with_networks': '213', 'sort_by': 'popularity.desc'}),
    ]:
        tops.append({'id': tid, 'title': title, 'subtitle': 'TMDB', 'source': 'TMDB',
                     'items': discover(kind, params, 100)})
        print(f'{title}: {len(tops[-1]["items"])}')

    for tid, title, kw in [('superhero100', 'ТОП 100 супергеройське', 'superhero'),
                           (' christmas50', 'ТОП-50 різдвяних', 'christmas')]:
        kid = keyword_id(kw)
        if not kid:
            continue
        tops.append({'id': tid.strip(), 'title': title, 'subtitle': 'TMDB', 'source': 'TMDB',
                     'items': discover('movie', {'with_keywords': str(kid), 'sort_by': 'vote_count.desc'}, 100)})
        print(f'{title}: {len(tops[-1]["items"])}')

    UNRESOLVED.write_text(json.dumps(unresolved, ensure_ascii=False, indent=2) + '\n')
    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    header = ('/* AUTO-GENERATED by tools/build-tops.py — НЕ редагувати вручну. */\n'
              f'/* generatedAt: {stamp} */\n')
    OUT.write_text(header + 'const MC_TOPS = ' + json.dumps(tops, ensure_ascii=False, indent=2) + ';\n')
    print(f'ГОТОВО: {len(tops)} топів, {sum(len(t["items"]) for t in tops)} тайтлів, {len(unresolved)} не резолвнуто')


if __name__ == '__main__':
    main()
