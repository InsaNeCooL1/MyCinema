#!/usr/bin/env python3
"""Підрахунок строк коду в проєкті з розбивкою по секціях.

Запуск: python3 tools/count-lines.py
"""

from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

EXCLUDE_DIRS = {'.git', 'node_modules', '.cache', 'backups', '__pycache__'}
EXCLUDE_FILES = {'bundle.js', 'styles.css', 'package-lock.json'}

TEXT_EXT = {'.js', '.css', '.html', '.py', '.json', '.md', '.xml', '.java', '.gradle', '.toml', '.yml', '.yaml', '.svg', '.txt'}


def section_for(path):
    rel = path.relative_to(ROOT).as_posix()
    if rel.startswith('src/card/'):
        return 'JS · картка (src/card)'
    if rel.startswith('src/'):
        if rel in ('src/collections-data.js', 'src/tops-data.js'):
            return 'Дані · згенеровані добірки'
        return 'JS · модулі (src)'
    if rel.startswith('styles/'):
        return 'CSS · стилі (styles)'
    if rel == 'index.html':
        return 'HTML · розмітка'
    if rel.startswith('tools/'):
        return 'Скрипти · tools'
    if rel.startswith('tests/'):
        return 'Тести · tests'
    if rel.startswith('worker/'):
        return 'Документація · worker'
    if rel.startswith('android/'):
        return 'Android · нативна частина'
    if rel.startswith('.github/'):
        return 'CI · .github'
    if path.suffix == '.md':
        return 'Документація'
    if rel in ('collections-raw.json', 'tools/unresolved.json', 'tools/unresolved-tops.json'):
        return 'Дані · сирі та звіти'
    return 'Корінь · конфіги'


def main():
    sections = defaultdict(lambda: {'files': 0, 'lines': 0, 'blank': 0, 'top': []})
    generated = {}
    total = 0

    for path in sorted(ROOT.rglob('*')):
        if not path.is_file() or path.suffix not in TEXT_EXT:
            continue
        if any(part in EXCLUDE_DIRS for part in path.parts):
            continue
        rel = path.relative_to(ROOT).as_posix()
        try:
            lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
        except OSError:
            continue
        count = len(lines)
        blank = sum(1 for line in lines if not line.strip())
        if rel in EXCLUDE_FILES:
            generated[rel] = count
            continue
        sec = section_for(path)
        s = sections[sec]
        s['files'] += 1
        s['lines'] += count
        s['blank'] += blank
        s['top'].append((count, rel))
        total += count

    order = [
        'JS · модулі (src)', 'JS · картка (src/card)', 'Дані · згенеровані добірки',
        'CSS · стилі (styles)', 'HTML · розмітка', 'Скрипти · tools', 'Тести · tests',
        'Документація · worker', 'Документація', 'Дані · сирі та звіти',
        'Android · нативна частина', 'CI · .github', 'Корінь · конфіги',
    ]

    print('═' * 68)
    print('ПІДРАХУНОК СТРОК КОДУ — MyCinema')
    print('═' * 68)
    print(f"{'Секція':<34}{'файлів':>8}{'рядків':>10}{'порожніх':>11}")
    print('─' * 68)
    for name in order:
        if name not in sections:
            continue
        s = sections[name]
        print(f"{name:<34}{s['files']:>8}{s['lines']:>10}{s['blank']:>11}")
    print('─' * 68)
    print(f"{'РАЗОМ (вихідники)':<34}{sum(s['files'] for s in sections.values()):>8}{total:>10}")
    print()

    print('Топ-10 файлів за рядками:')
    all_files = [(c, r) for s in sections.values() for c, r in s['top']]
    for count, rel in sorted(all_files, reverse=True)[:10]:
        print(f'  {count:>7}  {rel}')

    print()
    print('Згенеровані асети (не входять у загальний підрахунок):')
    for name in ('bundle.js', 'styles.css'):
        if name in generated:
            print(f'  {generated[name]:>7}  {name}')

    total_with_generated = total + sum(generated.values())
    print(f'\nРазом зі згенерованими асетами: {total_with_generated} рядків')


if __name__ == '__main__':
    main()
