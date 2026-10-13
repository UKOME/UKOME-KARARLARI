#!/usr/bin/env python3
"""Aggregate yearly JSON reports without touching the municipal website."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def build(folder: Path) -> dict:
    stats = {}
    for path in sorted(folder.glob('20[12][0-9].json')):
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            year = int(path.stem)
            docs = data['documents']
            stats[year] = {
                'total': len(docs),
                'ok': sum(d.get('status') == 'ok' for d in docs),
                'errors': sum(d.get('status') != 'ok' for d in docs),
                'pages': sum(len(d.get('pages', [])) for d in docs),
                'ocr_pages': sum(d.get('ocr_pages', 0) for d in docs),
            }
        except (ValueError, KeyError, OSError) as exc:
            print(f'Hatalı dizin: {path}: {exc}', file=sys.stderr)
    current_year = datetime.now(timezone.utc).year
    missing = [y for y in range(2014, current_year + 1) if y not in stats]
    manifest = {
        'version': 1,
        'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'origin': 'https://www.manisa.bel.tr',
        'years': sorted(stats, reverse=True),
        'stats': stats,
        'total': sum(s['total'] for s in stats.values()),
        'indexed': sum(s['ok'] for s in stats.values()),
        'failed_years': missing,
        'ocr_enabled': True,
    }
    folder.mkdir(parents=True, exist_ok=True)
    (folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Yıllar:', len(stats), 'PDF:', manifest['total'], 'Okunan:', manifest['indexed'], 'Eksik yıllar:', missing)
    return manifest


if __name__ == '__main__':
    build(Path(sys.argv[1] if len(sys.argv) > 1 else 'docs/data'))
