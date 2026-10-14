#!/usr/bin/env python3
"""Read-only Turkish OCR quality inventory for existing indexed PDF text.

It does not fetch PDFs, change annual JSON, or edit the published site.
The scores are screening heuristics, not a certification of text correctness.
"""
from __future__ import annotations
import csv
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import argparse

SPECIAL = re.compile(r'[\uFFFD\u00A4\u00A7\u00B6\u00AC\u00BF{}\[\]\\|~^]')
DIGIT_INSIDE_WORD = re.compile(r'(?iu)(?<=[a-zçğıöşü])[0-9](?=[a-zçğıöşü])|(?<=[a-zçğıöşü])[€$](?=[a-zçğıöşü])')
ODD_SEQUENCES = re.compile(r'(?iu)(?:[qwx]{2,}|[bcdfghjklmnpqrstvwxyzçğş]{9,})')
LONG_WORDS = re.compile(r'(?iu)\b[^\W\d_]{8,}\b')
VOWELS = set('aeıioöuüAEIİOÖUÜ')

def quality_score(text: str) -> float:
    text = str(text or '')
    no_vowels = sum(1 for word in LONG_WORDS.findall(text)
                    if not any(char in VOWELS for char in word))
    anomalies = 3 * len(SPECIAL.findall(text))
    anomalies += 4 * len(DIGIT_INSIDE_WORD.findall(text))
    anomalies += 3 * len(ODD_SEQUENCES.findall(text))
    anomalies += 2 * no_vowels
    return round(1000 * anomalies / max(len(text), 1), 2)

def inventory(data_dir: Path, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    years = []
    for path in sorted(data_dir.glob('20[12][0-9].json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        counts = Counter()
        for doc in data.get('documents', []):
            counts['documents'] += 1
            for index, text in enumerate(doc.get('pages') or []):
                counts['pages'] += 1
                score = quality_score(text)
                length = len(text or '')
                if length < 50:
                    bucket = 'short_or_blank'
                elif score >= 25:
                    bucket = 'high_priority'
                elif score >= 12:
                    bucket = 'review'
                else:
                    bucket = 'lower_priority'
                counts[bucket] += 1
                if bucket != 'lower_priority':
                    rows.append({
                        'year': data['year'], 'decision_number': doc.get('number'),
                        'document_id': doc.get('id'), 'pdf_page': index + 1,
                        'characters': length, 'noise_per_1000': score, 'priority': bucket})
        years.append({'year': data.get('year'), **dict(counts)})
    rows.sort(key=lambda item: (0 if item['priority'] == 'high_priority' else 1 if item['priority']=='short_or_blank' else 2, -item['noise_per_1000']))
    with (out_dir / 'review_pages.csv').open('w', newline='', encoding='utf-8-sig') as out:
        writer = csv.DictWriter(out, fieldnames=['year','decision_number','document_id','pdf_page','characters','noise_per_1000','priority'])
        writer.writeheader()
        writer.writerows(rows)
    total = Counter()
    for yr in years:
        for k,v in yr.items():
            if k!='year':total[k]+=v
    report = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'method': 'Heuristic detection; manually inspect OCR and source PDFs before accepting replacements.',
        'pdfs_downloaded': 0,
        'archive_files_modified': 0,
        'total': dict(total),
        'years': years,
    }
    (out_dir/'summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2), encoding='utf-8')
    print('DATA QUALITY INVENTORY')
    print(json.dumps({'total':report['total'],'years':len(years),'priority_pages':len(rows)},ensure_ascii=False))
    for y in years:
        print(f"{y['year']}: {y['pages']} pages, high_priority={y['high_priority']}, review={y['review']}, short_or_blank={y['short_or_blank']}")
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--data',type=Path,default=Path('docs/data'))
    p.add_argument('--output',type=Path,default=Path('reports/ocr-quality-audit'))
    args=p.parse_args()
    inventory(args.data,args.output)
