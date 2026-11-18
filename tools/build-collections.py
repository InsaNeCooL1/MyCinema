#!/usr/bin/env python3
"""Генератор статичних даних підбірок із collections-raw.json.

Сирий файл містить креативні добірки у форматі:
  { title, year, type, ua? }
Кожен тайтл резолвиться через TMDB /search/{movie,tv} (публічний воркер-проксі)
за оригінальною назвою + роком. Результат — src/collections-data.js.

Запуск: python3 tools/build-collections.py
"""

import difflib
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'collections-raw.json'
OUT = ROOT / 'src' / 'collections-data.js'
CACHE_DIR = ROOT / 'tools' / '.cache' / 'collections'
UNRESOLVED = ROOT / 'tools' / 'unresolved.json'

PROXY = 'https://mycinema-proxy.insaneteresh123.workers.dev'
WORKERS = 6
TIMEOUT = 20
MAX_RETRIES = 2
YEAR_TOLERANCE = 1
FUZZY_MIN = 0.84

CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Ручні аліаси для назв, які TMDB search не знаходить за оригінальною формою
MANUAL_ALIASES = {
    ('movie', 'ocean s 8', 2018): "Ocean's Eight",
    ('movie', '12 monkeys', 1995): 'Twelve Monkeys',
    ('tv', 'war peace', 2016): 'War and Peace',
    ('tv', 'spring tide', 2016): 'Springfloden',
    ('tv', 'dae jang geum', 2003): 'Jewel in the Palace',
    ('tv', 'the heavy water war', 2015): 'The Saboteurs',
}


def normalize(text):
    text = (text or '').lower().strip()
    text = re.sub(r'[^\w\s]+', ' ', text, flags=re.UNICODE)
    return re.sub(r'\s+', ' ', text).strip()


def item_year(value):
    match = re.match(r'(\d{4})', str(value or ''))
    return int(match.group(1)) if match else 0


def cache_key(kind, title, year):
    raw = f'{kind}|{normalize(title)}|{year}'.encode('utf-8')
    return hashlib.sha1(raw).hexdigest() + '.json'


def fetch_json(url):
    last = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 MyCinema/1.0'})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
                return json.loads(res.read().decode('utf-8'))
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt < MAX_RETRIES:
                time.sleep(0.4 * (attempt + 1))
    raise last


def search(kind, title, year, with_year=True):
    params = {'query': title, 'language': 'en-US'}
    if with_year:
        params['year'] = str(year)
    url = f'{PROXY}/search/{kind}?' + urllib.parse.urlencode(params)
    data = fetch_json(url)
    results = data.get('results') or []
    return results if isinstance(results, list) else []


def pick(results, title, year):
    if not results:
        return None
    target = normalize(title)
    exact = []
    contained = []
    fuzzy = []
    for row in results:
        ry = item_year(row.get('release_date') or row.get('first_air_date'))
        names = [normalize(n) for n in (
            row.get('title'), row.get('name'),
            row.get('original_title'), row.get('original_name')
        ) if n]
        if any(n == target for n in names) and abs(ry - year) <= YEAR_TOLERANCE:
            exact.append(row)
            continue
        # "Daredevil" -> "Marvel's Daredevil", "War & Peace" -> "War and Peace"
        if any(target in n or n in target for n in names) and abs(ry - year) <= 2:
            contained.append(row)
            continue
        if abs(ry - year) <= YEAR_TOLERANCE:
            ratio = max((difflib.SequenceMatcher(None, target, n).ratio() for n in names), default=0)
            if ratio >= FUZZY_MIN:
                fuzzy.append((ratio, row))

    pool = exact or contained or [row for _, row in sorted(fuzzy, key=lambda x: -x[0])]
    if not pool:
        return None
    return max(pool, key=lambda r: (r.get('vote_count') or 0, r.get('vote_average') or 0))


def resolve(entry):
    kind = entry['type']
    title = entry['title']
    year = int(entry.get('year') or 0)
    alias = MANUAL_ALIASES.get((kind, normalize(title), year))
    if alias:
        title = alias
    ck = cache_key(kind, title, year)
    path = CACHE_DIR / ck
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass

    result = None
    try:
        result = pick(search(kind, title, year), title, year)
        if not result:
            result = pick(search(kind, title, year, with_year=False), title, year)
    except Exception as exc:  # noqa: BLE001
        result = {'__error__': str(exc)}

    payload = None
    if result and not result.get('__error__'):
        payload = {
            'id': result.get('id'),
            'originalTitle': result.get('original_title') or result.get('original_name') or result.get('title') or result.get('name'),
            'year': item_year(result.get('release_date') or result.get('first_air_date')),
            'poster': result.get('poster_path') or '',
            'rating': round(float(result.get('vote_average') or 0), 1),
        }
    path.write_text(json.dumps(payload, ensure_ascii=False))
    return payload


def main():
    raw = json.loads(RAW.read_text())
    tasks = []
    for col in raw['collections']:
        for item in col.get('items', []):
            tasks.append((col['id'], item))

    print(f'Тайтлів до резолву: {len(tasks)}')
    resolved = {}
    started = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(resolve, entry): (col_id, entry)
                   for col_id, entry in tasks}
        for idx, future in enumerate(as_completed(futures), 1):
            col_id, entry = futures[future]
            try:
                resolved[(col_id, entry['title'], entry.get('type'), entry.get('year'))] = future.result()
            except Exception as exc:  # noqa: BLE001
                resolved[(col_id, entry['title'], entry.get('type'), entry.get('year'))] = {'__error__': str(exc)}
            if idx % 250 == 0:
                print(f'  {idx}/{len(tasks)} за {int(time.time()-started)}с')

    collections_out = []
    unresolved = []
    for col in raw['collections']:
        items_out = []
        for item in col.get('items', []):
            got = resolved.get((col['id'], item['title'], item.get('type'), item.get('year')))
            if not got or got.get('__error__') or not got.get('id'):
                unresolved.append({
                    'collection': col['id'],
                    'title': item.get('title'),
                    'year': item.get('year'),
                    'type': item.get('type'),
                    'reason': (got or {}).get('__error__', 'not found'),
                })
                continue
            items_out.append({
                'key': f"{item['type']}-{got['id']}",
                'id': got['id'],
                'type': item['type'],
                'title': got['originalTitle'],
                'ua': item.get('ua') or '',
                'year': got['year'] or item.get('year'),
                'poster': got['poster'],
                'rating': got['rating'],
            })
        collections_out.append({
            'id': col['id'],
            'title': col['title'],
            'emoji': col.get('emoji', ''),
            'description': col.get('description', ''),
            'category': col.get('category', ''),
            'items': items_out,
        })

    UNRESOLVED.write_text(json.dumps(unresolved, ensure_ascii=False, indent=2) + '\n')
    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    header = ('/* AUTO-GENERATED by tools/build-collections.py — НЕ редагувати вручну. */\n'
              f'/* generatedAt: {stamp} */\n')
    body = 'const MC_COLLECTIONS = ' + json.dumps(collections_out, ensure_ascii=False, indent=2) + ';\n'
    OUT.write_text(header + body)

    total = sum(len(c['items']) for c in collections_out)
    print(f'ГОТОВО: {len(collections_out)} добірок, {total} тайтлів, '
          f'{len(unresolved)} не резолвнуто. Час: {int(time.time()-started)}с')
    print(f'Файл: {OUT}')


if __name__ == '__main__':
    main()
