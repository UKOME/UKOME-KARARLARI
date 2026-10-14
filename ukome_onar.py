#!/usr/bin/env python3
"""Repair ONLY two unreadable records in the already published UKOME archive.

Run from the repository root on GitHub Actions. Existing year files are loaded
from docs/data. No archive discovery or re-indexing of other PDFs is performed.
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import fitz
import pytesseract
import requests
from PIL import Image
from pytesseract import Output

from crawler import normalize, session, tags

DATA = Path("docs/data")
TARGETS = {2015: (6, "ENGELLİ PAR"), 2025: (123, "TRAFİK LEVHA")}
LIMIT_BYTES = 750 * 1024 * 1024  # A safety ceiling, not the old 50 MB limit.
LOG = logging.getLogger("ukome-onar")


def download_pdf(url: str, target: Path) -> int:
    """Download to disk in chunks: even a large PDF is not held in RAM."""
    size = 0
    http = session()
    with http.get(url, timeout=(25, 180), stream=True) as response:
        response.raise_for_status()
        stated = response.headers.get("Content-Length")
        if stated and stated.isdigit() and int(stated) > LIMIT_BYTES:
            raise RuntimeError(f"Kaynak PDF {int(stated) / 1048576:.1f} MB; 750 MB güvenlik sınırını aşıyor")
        with target.open("wb") as dest:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                size += len(chunk)
                if size > LIMIT_BYTES:
                    raise RuntimeError("PDF 750 MB güvenlik sınırını aşıyor")
                dest.write(chunk)
    with target.open("rb") as source:
        if source.read(5) != b"%PDF-":
            raise RuntimeError("Kaynak sunucudan PDF olmayan içerik geldi")
    return size


def ocr_page(page: fitz.Page, all_orientations: bool) -> str:
    """Read image-only pages; try text at right angles for rotated scans."""
    rect = page.rect
    scale = min(1.8, 2400 / max(rect.width, rect.height, 1))
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    del pix
    best_text, best_quality = "", 0.0
    angles = (0, 90, 180, 270) if all_orientations else (0, 90, 270, 180)
    for angle in angles:
        candidate = image if angle == 0 else image.rotate(angle, expand=True)
        try:
            response = pytesseract.image_to_data(
                candidate, lang="tur+eng", config="--psm 3",
                output_type=Output.DICT, timeout=110,
            )
            words = []
            quality = 0.0
            for word, conf in zip(response["text"], response["conf"]):
                word = word.strip()
                try:
                    confidence = float(conf)
                except (ValueError, TypeError):
                    continue
                if confidence >= 30 and len(word) >= 2:
                    words.append(word)
                    quality += confidence * min(len(word), 14)
            candidate_text = " ".join(words)
            if quality > best_quality:
                best_quality, best_text = quality, candidate_text
            # Avoid three extra OCR attempts for normally oriented readable pages.
            if not all_orientations and angle == 0 and quality > 15000 and len(candidate_text) > 200:
                break
        except (RuntimeError, pytesseract.TesseractError) as error:
            LOG.warning("OCR denemesi başarısız (açı %s): %s", angle, str(error)[:150])
        finally:
            if angle:
                candidate.close()
    image.close()
    return best_text


def read_pdf(pdf_path: Path, rotate_scan: bool) -> tuple[list[str], int, int]:
    pages, ocr_count = [], 0
    with fitz.open(str(pdf_path)) as pdf:
        page_count = len(pdf)
        LOG.info("PDF açıldı: %s sayfa", page_count)
        for index in range(page_count):
            page = pdf[index]
            native = page.get_text("text", sort=True).strip()
            found = native
            if len(native) < 75:
                try:
                    detected = ocr_page(page, all_orientations=rotate_scan)
                    if len(detected) > len(native):
                        found = detected
                        ocr_count += 1
                except Exception as error:
                    LOG.warning("Sayfa %s OCR hatası: %s", index + 1, str(error)[:170])
            pages.append(" ".join(found.replace("\x00", " ").split()))
            if index % 10 == 0 or index + 1 == page_count:
                LOG.info("PDF sayfası işlendi: %s/%s", index + 1, page_count)
    return pages, page_count, ocr_count


def repair_year(year: int, number: int, expected_title: str) -> bool:
    path = DATA / f"{year}.json"
    archive = json.loads(path.read_text(encoding="utf-8"))
    docs = [doc for doc in archive["documents"] if doc.get("number") == number]
    if len(docs) != 1:
        raise RuntimeError(f"{year}-{number}: Tek kayıt bulunamadı ({len(docs)} kayıt)")
    entry = docs[0]
    # Prevent silently changing an unrelated record if the source numbering changes.
    if normalize(expected_title) not in normalize(entry["title"]):
        raise RuntimeError(f"Yanlış karar başlığı: {entry['title']!r}")
    if entry.get("status") == "ok" and any(str(p).strip() for p in entry.get("pages", [])):
        LOG.info("%s-%02d zaten metin içeriyor, atlanıyor", year, number)
        return False
    LOG.info("Sadece şu belge onarılıyor: %s (kaynak: %s)", entry["title"], entry["url"])
    with tempfile.TemporaryDirectory(prefix="ukome-") as folder:
        pdf_file = Path(folder) / f"{year}-{number}.pdf"
        size = download_pdf(entry["url"], pdf_file)
        LOG.info("PDF indirildi: %.1f MB", size / 1048576)
        pages, page_count, ocr_count = read_pdf(pdf_file, rotate_scan=year == 2015)
    text = "\n".join(pages)
    if len(re.findall(r"[a-zA-ZçÇğĞıİöÖşŞüÜ]", text)) < 25:
        LOG.warning("%s-%02d: Hâlâ yeterli metin yok. Mevcut kayıt korunuyor.", year, number)
        return False
    updated = dict(entry)
    updated.update({
        "pages": pages,
        "page_count": page_count,
        "ocr_pages": ocr_count,
        "status": "ok",
        "errors": [],
    })
    updated["districts"], updated["topics"], updated["neighborhoods"] = tags(text, entry["title"])
    archive["documents"][archive["documents"].index(entry)] = updated
    archive["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    tmp = path.with_suffix(".repair-tmp")
    tmp.write_text(json.dumps(archive, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)
    LOG.info("DÜZELTİLDİ: %s-%02d; %s sayfa, %s OCR", year, number, page_count, ocr_count)
    return True



def make_large_pdf_fix_persistent(path: Path = Path("crawler.py")) -> bool:
    """Make future scheduled scans stream large PDFs to disk, not RAM."""
    source = path.read_text(encoding="utf-8")
    if 'ukome-pdf-stream-' in source:
        LOG.info("Ana tarayıcıda büyük PDF desteği zaten var")
        return False
    old_open = 'pdf = fitz.open(stream=payload, filetype="pdf")'
    start_marker = '        with http.get(item["url"], timeout=(12, 65), stream=True) as response:\n'
    end_marker = '        record.update({"pages": pages, "page_count": count, "ocr_pages": ocr_pages,'
    if old_open not in source or start_marker not in source or end_marker not in source:
        raise RuntimeError("Beklenmeyen crawler.py sürümü: indirme kodu değişmiş")
    start = source.index(start_marker)
    end = source.index(end_marker, start)
    replacement = '''        # Stream PDFs into a temporary file; do not buffer huge PDFs in RAM.
        import tempfile
        with tempfile.TemporaryDirectory(prefix="ukome-pdf-stream-") as folder:
            pdf_path = Path(folder) / "source.pdf"
            with http.get(item["url"], timeout=(25, 180), stream=True) as response:
                response.raise_for_status()
                total = 0
                with pdf_path.open("wb") as dest:
                    for chunk in response.iter_content(1024 * 1024):
                        if not chunk:
                            continue
                        total += len(chunk)
                        if total > 750 * 1024 * 1024:
                            raise ValueError("PDF 750 MB güvenlik sınırını aşıyor")
                        dest.write(chunk)
            with pdf_path.open("rb") as source_pdf:
                if source_pdf.read(5) != b"%PDF-":
                    raise ValueError("PDF yerine farklı içerik geldi")
            pages, count, ocr_pages, notices = extract_pdf(str(pdf_path), ocr, max_pages)
'''
    source = source[:start] + replacement + source[end:]
    source = source.replace(old_open,
        'pdf = fitz.open(filename=payload) if isinstance(payload, str) else fitz.open(stream=payload, filetype="pdf")', 1)
    compile(source, str(path), "exec")
    path.write_text(source, encoding="utf-8")
    LOG.info("Ana tarayıcı büyük PDF'leri artık geçici diske indiriyor")
    return True


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    results = {}
    for year, (number, title) in TARGETS.items():
        try:
            results[f"{year}-{number:02d}"] = "Düzeltildi" if repair_year(year, number, title) else "Henüz düzeltilemedi"
        except Exception as error:
            LOG.error("%s-%02d onarılamadı: %s", year, number, error)
            results[f"{year}-{number:02d}"] = "Hata: " + str(error)[:200]
    if any(x == "Düzeltildi" for x in results.values()):
        make_large_pdf_fix_persistent()
    summary = ["## Yalnızca iki eksik PDF onarımı", ""]
    for key, value in results.items():
        summary.append(f"- **{key}**: {value}")
    summary.append("\nDiğer 1.387 belgenin metni korunmuştur.\n")
    for line in summary:
        print(line)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as file:
            file.write("\n".join(summary))
    return 0 if any(x == "Düzeltildi" for x in results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
