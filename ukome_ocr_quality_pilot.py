#!/usr/bin/env python3
"""Compare published UKOME PDF OCR with the existing index; never edit archive data."""
from __future__ import annotations
import argparse
import io
import json
import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import fitz
import pytesseract
import requests
from PIL import Image

ODD_CHARS = re.compile(r'[\uFFFD\u00A4\u00A7\u00B6\u00AC\u00BF{}\[\]\\|~^]')
MIXED = re.compile(r'(?iu)(?<=\w)[0-9](?=\w)|(?<=\w)[€$](?=\w)')
BAD_WORDS = re.compile(r'(?iu)(?:[qwx]{2,}|[bcdfghjklmnpqrstvwxyzçğş]{9,})')
WORDS = re.compile(r'(?iu)\b[^\W\d_]{4,}\b')
VOWELS = set('aeıioöuüAEIİOÖUÜ')

def noise_score(text: str) -> float:
    words = WORDS.findall(text or '')
    vowel_free = sum(len(w) > 7 and not any(c in VOWELS for c in w) for w in words)
    bad = 3 * len(ODD_CHARS.findall(text)) + 4 * len(MIXED.findall(text))
    bad += 3 * len(BAD_WORDS.findall(text)) + 2 * vowel_free
    return round(bad * 1000 / max(1, len(text)), 2)

def download_municipal_pdf(url: str, destination: Path) -> None:
    p = urlparse(url)
    if p.scheme != 'https' or p.hostname not in {'manisa.bel.tr', 'www.manisa.bel.tr'} or not p.path.lower().endswith('.pdf'):
        raise ValueError('Only published Manisa municipality PDF URLs are allowed')
    with requests.get(url, timeout=(20, 150), stream=True, headers={'User-Agent': 'UKOME-OCR-Quality-Pilot/1.0'}) as response:
        response.raise_for_status()
        total = 0
        with destination.open('wb') as out:
            for chunk in response.iter_content(1024 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > 160 * 1024 * 1024:
                    raise ValueError('PDF exceeds pilot limit of 160 MB')
                out.write(chunk)
    if destination.open('rb').read(5) != b'%PDF-':
        raise ValueError('Downloaded content is not PDF')

def pilot(year: int, number: int, data: Path, output: Path) -> None:
    annual = json.loads((data / f'{year}.json').read_text(encoding='utf-8'))
    matches = [d for d in annual['documents'] if d.get('number') == number]
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one decision {year}-{number}; found {len(matches)}')
    doc = matches[0]
    output.mkdir(parents=True, exist_ok=True)
    report = {'year': year, 'number': number, 'title': doc['title'], 'url': doc['url'],
              'archive_modified': False, 'pages': [], 'warning': 'OCR is a review candidate, not an official decision text.'}
    with tempfile.TemporaryDirectory() as temp:
        pdf_path = Path(temp) / 'source.pdf'
        download_municipal_pdf(doc['url'], pdf_path)
        with fitz.open(pdf_path) as pdf:
            old_pages = doc.get('pages', [])
            if len(pdf) != len(old_pages):
                raise ValueError(f'Page count changed: PDF {len(pdf)}, indexed {len(old_pages)}; no changes made')
            for i, page in enumerate(pdf):
                old = old_pages[i]
                pix = page.get_pixmap(dpi=300, alpha=False)
                img = Image.open(io.BytesIO(pix.tobytes('png')))
                choices = []
                for psm in [3, 6]:
                    txt = pytesseract.image_to_string(img, lang='tur+eng', config=f'--psm {psm}', timeout=160)
                    choices.append((noise_score(txt), -len(txt), psm, txt))
                _, _, psm, candidate = min(choices, key=lambda x: (x[0], x[1]))
                old_score, new_score = noise_score(old), noise_score(candidate)
                similar_length = 0.6 <= len(candidate) / max(1, len(old)) <= 1.7
                recommend = old_score >= 12 and new_score < old_score * 0.75 and similar_length
                report['pages'].append({'pdf_page': i + 1, 'old_noise_per_1000': old_score,
                    'new_noise_per_1000': new_score, 'old_chars': len(old),
                    'new_chars': len(candidate), 'ocr_psm': psm,
                    'recommend_manual_review': recommend})
                (output / f'page_{i+1}_indexed.txt').write_text(old, encoding='utf-8')
                (output / f'page_{i+1}_turkish_ocr.txt').write_text(candidate, encoding='utf-8')
                print(f'Page {i+1}: indexed={old_score}, new={new_score}; review={recommend}')
    (output / 'comparison.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Finished pilot {year}-{number}. Annual JSON not modified; report: {output}')

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--year', type=int, default=2015)
    p.add_argument('--number', type=int, default=108)
    p.add_argument('--data', type=Path, default=Path('docs/data'))
    p.add_argument('--output', type=Path, default=Path('reports/ocr-pilot'))
    a = p.parse_args()
    pilot(a.year, a.number, a.data, a.output)
