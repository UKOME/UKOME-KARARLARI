#!/usr/bin/env python3
"""Create conservative, inspectable agenda splits from the existing PDF OCR text.

A split is made only where a clearly labelled agenda heading is detected.
Other PDFs remain a single result rather than guessing agenda boundaries.
No PDFs are fetched and no existing annual JSON is changed.
"""
import json
import re
import sys
from pathlib import Path

# Strong headings only. Numeric lists like "1-)" alone are intentionally excluded.
HEADING = re.compile(
    r'(?i)(?<![\w])(?:'
    r'g[üu]ndem(?:in|de)?\s*(?:maddesi\s*)?(?P<a>\d{1,3})\s*[.\-:]?\s*(?:nolu|numaral[ıi]|inci|uncu|[.]?\s*maddesi)?'
    r'|(?P<b>\d{1,3})\s*[.\-)]\s*g[üu]ndem\s*maddesi'
    r'|(?P<c>\d{1,3})\s*[.]\s*madde\s*[:\-]'
    r')', re.UNICODE)


def split_document(doc):
    pages = doc.get('pages') or []
    if not pages or not any(str(p).strip() for p in pages):
        return [{'label': 'Belge', 'from_page': 0, 'from_char': 0, 'to_page': max(0, len(pages)-1), 'to_char': len(pages[-1]) if pages else 0, 'confident': False}]
    text = '\n'.join(pages)
    offsets = [0]
    for p in pages[:-1]:
        offsets.append(offsets[-1] + len(p) + 1)
    hits = []
    for hit in HEADING.finditer(text):
        n = int(hit.group('a') or hit.group('b') or hit.group('c'))
        if not 1 <= n <= 100:
            continue
        # Avoid OCR hallucination within another word or continuous prose where possible.
        if hits and hit.start() - hits[-1][0] < 90:
            continue
        hits.append((hit.start(), n))
    # Strong segmentation requires two separate numbered agenda headings.
    if len(hits) < 2 or len({n for _,n in hits}) < 2:
        return [{'label': 'Belge', 'from_page': 0, 'from_char': 0, 'to_page': len(pages)-1, 'to_char': len(pages[-1]), 'confident': False}]
    spans=[]
    if hits[0][0] > 0:
        # Before the first heading: attach to first entry to avoid losing introductory context.
        hits[0] = (0,hits[0][1])
    for i,(start,num) in enumerate(hits):
        end=hits[i+1][0] if i+1 < len(hits) else len(text)
        if end <= start: continue
        from_p=max(k for k,v in enumerate(offsets) if v <= start)
        to_p=max(k for k,v in enumerate(offsets) if v < end)
        from_c = max(0,start-offsets[from_p])
        to_c = min(len(pages[to_p]),end-offsets[to_p])
        spans.append({'label': f'Gündem {num}', 'from_page':from_p,'from_char':from_c,'to_page':to_p,'to_char':to_c,'confident':True})
    return spans if len(spans)>1 else [{'label':'Belge', 'from_page':0,'from_char':0,'to_page':len(pages)-1,'to_char':len(pages[-1]),'confident':False}]


def build(root: Path):
    target=root / 'agenda'
    target.mkdir(exist_ok=True)
    report={'source': 'indexed full text', 'detected_agenda_documents':0,'total_agenda_items':0,'unsplit_documents':0,'years':{}}
    for file in sorted(root.glob('20??.json')):
        year=int(file.stem)
        source=json.loads(file.read_text(encoding='utf-8'))
        items={}
        for d in source.get('documents',[]):
            key=d.get('id') or d.get('url')
            if not key: continue
            ranges=split_document(d)
            items[key]=ranges
            if len(ranges)>1: report['detected_agenda_documents']+=1
            else: report['unsplit_documents']+=1
            report['total_agenda_items']+=len(ranges)
        dest=target/file.name
        dest.write_text(json.dumps({'year':year,'segments':items},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        report['years'][str(year)]={'documents':len(items),'items':sum(len(s) for s in items.values()),'separated':sum(len(s)>1 for s in items.values())}
    (target/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Agenda detection report:',json.dumps(report,ensure_ascii=False))
    return report

if __name__=='__main__':
    build(Path(sys.argv[1]) if len(sys.argv)>1 else Path('docs/data'))
