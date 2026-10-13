#!/usr/bin/env python3
"""Manisa UKOME public PDF archive -> compact static full-text index.

Designed for GitHub Actions; no setup or PDF files on a staff computer.
The index contains copies of publicly published text, and source links remain
attached to every indexed PDF. The website is not accessed on every search.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import io
import json
import logging
import os
import re
import sys
import time
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import fitz
import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

HOME = "https://www.manisa.bel.tr/t23_ulasim-dairesi-baskanligi.aspx?sayfa=icerik&sid=3052"
BASE = "https://www.manisa.bel.tr"
YEARS = range(2014, datetime.now(timezone.utc).year + 2)
DISTRICTS = ["Ahmetli", "Akhisar", "Alaşehir", "Demirci", "Gölmarmara", "Gördes", "Kırkağaç", "Köprübaşı", "Kula", "Salihli", "Sarıgöl", "Saruhanlı", "Selendi", "Soma", "Şehzadeler", "Turgutlu", "Yunusemre"]
TOPICS = {
    "Kasis ve hız kesici": [r"\bkasis\b", r"hız kesici", r"yol sathı hız kontrol", r"hız tümseği"],
    "Duba ve fiziki düzenleme": [r"\bduba\b", r"delinatör", r"esnek ayırıcı", r"mantar bariyer"],
    "Çekici ve otopark": [r"\bçekici\b", r"kurtarıcı", r"yediemin"],
    "Ticari taksi": [r"ticari taksi", r"taksi durağı", r"taksi plak"],
    "Toplu ulaşım": [r"toplu taşı", r"toplu ulaş", r"otobüs", r"minibüs"],
    "Servis taşımacılığı": [r"servis taş", r"servis araç", r"\bj plaka\b", r"\bj plak"],
    "Yetki ve güzergâh": [r"güzerg", r"yetki belgesi", r"d4\b", r"a1 yetki"],
    "Engelli park yeri": [r"engelli.*park", r"özürlü.*park"],
    "Otopark ve parklanma": [r"otopark", r"park yasağı", r"park yeri"],
    "Sinyalizasyon": [r"sinyalizasyon", r"trafik ış", r"ışıklı kavşak"],
    "Trafik işaretleme": [r"trafik işaret", r"trafik levha", r"yol çizgi", r"düşey işaret"],
    "Yol ve kavşak": [r"kavşak", r"yol kapama", r"yol yön", r"refüj", r"orta refüj"],
    "Hız sınırları": [r"hız sınır", r"hız limiti"],
    "Ücret tarifeleri": [r"ücret tarif", r"ücret artış", r"fiyat tarif", r"taksimetre"],
    "Geçiş yolu izni": [r"geçiş yolu izin"],
    "Hemzemin geçit": [r"hemzemin"],
    "MTSK sınav güzergâhı": [r"m\.t\.s\.k", r"direksiyon (eğitim|sınav)", r"motorlu taşıt sürücü"],
    "Terminal ve peron": [r"terminal", r"peron tahsis", r"peron yeri"],
}
NORM_TRANS = str.maketrans({"İ": "i", "I": "ı", "Ş": "ş", "Ğ": "ğ", "Ü": "ü", "Ö": "ö", "Ç": "ç"})
LOG = logging.getLogger("ukome")


def normalize(value: str) -> str:
    return unicodedata.normalize("NFC", value or "").translate(NORM_TRANS).casefold()


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": "ManisaUKOMEArchiveIndexer/1.0 (public archive; weekly indexing)", "Accept-Language": "tr-TR,tr;q=0.9"})
    retry = Retry(total=3, backoff_factor=1.3, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry, pool_maxsize=12)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def get_page(http: requests.Session, url: str) -> str:
    r = http.get(url, timeout=(12, 45))
    r.raise_for_status()
    r.encoding = r.apparent_encoding if r.encoding and r.encoding.lower() in ("iso-8859-1", "windows-1252") else (r.encoding or "utf-8")
    return r.text


def archive_pages(html: str, base: str = BASE) -> dict[int, str]:
    soup = BeautifulSoup(html, "html.parser")
    pages = {}
    for anchor in soup.find_all("a", href=True):
        title = " ".join(anchor.get_text(" ", strip=True).split())
        match = re.fullmatch(r"UKOME\s+Kararlar[ıi]\s*\(\s*(20\d{2})\s*\)", title, re.I)
        if not match:
            continue
        year = int(match.group(1))
        if year in YEARS:
            pages[year] = urljoin(base, anchor["href"])
    return pages


def decision_links(html: str, year: int, base: str = BASE) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    results = {}
    for a in soup.find_all("a", href=True):
        url = urljoin(base, a["href"].strip())
        path = urlsplit(url).path.casefold()
        if not (path.endswith(".pdf") or ("/upload/" in path and "/dosya/" in path)):
            continue
        title = " ".join(a.get_text(" ", strip=True).split())
        if not title:
            title = Path(path).name
        if not (re.match(rf"\s*{year}\b", title) or str(year) in title):
            # Older pages sometimes omit year from titles; preserve matching documents
            # but avoid arbitrary PDF links in the sidebar and footer.
            if "teskilat/dosya" not in path:
                continue
        number = re.search(rf"(?:{year}\s*[-/.]?\s*)(\d{{1,4}})\b", title)
        results[url] = {"id": hashlib.sha1(url.encode()).hexdigest()[:16], "year": year,
                        "number": int(number.group(1)) if number else None,
                        "title": title, "url": url, "archive_page": None}
    return list(results.values())


def tags(text: str, title: str) -> tuple[list[str], list[str], list[str]]:
    corpus = normalize(title + "\n" + text)
    district = [x for x in DISTRICTS if re.search(rf"(?<!\w){re.escape(normalize(x))}(?!\w)", corpus)]
    topic = [name for name, patterns in TOPICS.items() if any(re.search(p, corpus, flags=re.I) for p in patterns)]
    neighborhoods = set()
    # Heuristic only: never treat these extracted names as authoritative administrative data.
    pattern = re.compile(r"\b([A-ZÇĞİÖŞÜ][a-zçğıöşüİı]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşüİı]+){0,3})\s+Mahall(?:esi|esinde|esinin|esine|e|\.)\b")
    for match in pattern.finditer(text[:500_000]):
        name = " ".join(match.group(1).split())
        if 2 <= len(name) <= 65:
            neighborhoods.add(name)
    return district, topic, sorted(neighborhoods)[:90]


def extract_pdf(payload: bytes, ocr: bool, max_pages: int) -> tuple[list[str], int, int, list[str]]:
    pdf = fitz.open(stream=payload, filetype="pdf")
    count = len(pdf)
    if max_pages <= 0:
        max_pages = count
    out, ocr_pages, notices = [], 0, []
    try:
        for n in range(min(count, max_pages)):
            p = pdf[n]
            raw = p.get_text("text", sort=True) or ""
            if ocr and len(raw.strip()) < 50:
                try:
                    import pytesseract
                    from PIL import Image
                    pix = p.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
                    im = Image.open(io.BytesIO(pix.tobytes("png")))
                    detected = pytesseract.image_to_string(im, lang="tur+eng", config="--psm 3")
                    if len(detected.strip()) > len(raw.strip()):
                        raw = detected
                        ocr_pages += 1
                except Exception as ex:
                    notices.append("OCR uygulanamadı: " + str(ex)[:130])
            out.append(" ".join(raw.replace("\x00", " ").split()))
    finally:
        pdf.close()
    if count > max_pages:
        notices.append(f"Yalnızca ilk {max_pages}/{count} sayfa indekslendi")
    return out, count, ocr_pages, list(dict.fromkeys(notices))


def index_one(item: dict, ocr: bool, max_pages: int) -> dict:
    record = dict(item)
    record.update({"pages": [], "page_count": 0, "ocr_pages": 0, "status": "error", "errors": []})
    try:
        http = session()
        with http.get(item["url"], timeout=(12, 65), stream=True) as response:
            response.raise_for_status()
            buffer = io.BytesIO()
            for chunk in response.iter_content(1024 * 512):
                buffer.write(chunk)
                if buffer.tell() > 50 * 1024 * 1024:
                    raise ValueError("PDF 50 MB sınırını aşıyor")
        payload = buffer.getvalue()
        if not payload.startswith(b"%PDF-"):
            raise ValueError("PDF yerine farklı içerik geldi")
        pages, count, ocr_pages, notices = extract_pdf(payload, ocr, max_pages)
        record.update({"pages": pages, "page_count": count, "ocr_pages": ocr_pages,
                       "status": "ok" if any(x.strip() for x in pages) else "empty", "errors": notices})
        text = "\n".join(pages)
        record["districts"], record["topics"], record["neighborhoods"] = tags(text, record["title"])
    except Exception as exc:
        record["status"] = "error"
        record["errors"].append(str(exc)[:220])
        record["districts"], record["topics"], record["neighborhoods"] = tags("", record["title"])
        LOG.warning("PDF işlenemedi: %s: %s", item["title"], exc)
    return record


def run(output: Path, ocr: bool, max_pages: int, workers: int, full: bool, only_year: int | None = None) -> int:
    output.mkdir(parents=True, exist_ok=True)
    http = session()
    try:
        home_html = get_page(http, HOME)
        pages_by_year = archive_pages(home_html)
    except Exception as exc:
        LOG.error("Arşiv ana sayfasına erişilemedi: %s", exc)
        return 2
    if not pages_by_year:
        LOG.error("Yıl sayfaları saptanamadı, veri silinmedi")
        return 2
    LOG.info("Bulunan arşiv yılları: %s", sorted(pages_by_year))
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    stats, failed_years = {}, []
    for year, yearurl in sorted(pages_by_year.items(), reverse=True):
        if only_year and year != only_year:
            continue
        path = output / f"{year}.json"
        old = {}
        if path.exists():
            try:
                old = {d["url"]: d for d in json.loads(path.read_text(encoding="utf-8"))["documents"]}
            except (OSError, ValueError, KeyError):
                pass
        try:
            links = decision_links(get_page(http, yearurl), year)
        except Exception as exc:
            LOG.error("%s yılı açılamadı; eski veri korundu: %s", year, exc)
            failed_years.append(year)
            continue
        if not links:
            LOG.error("%s yılında PDF bağlantısı yok; eski veri korundu", year)
            failed_years.append(year)
            continue
        for d in links:
            d["archive_page"] = yearurl
        to_fetch, documents = [], []
        for d in links:
            prev = old.get(d["url"])
            current = year >= datetime.now(timezone.utc).year - 1
            if prev and not full and not current and prev.get("status") == "ok":
                prev.update({k: d[k] for k in ("title", "year", "number", "archive_page")})
                documents.append(prev)
            else:
                to_fetch.append(d)
        LOG.info("%s: %s PDF bulundu, %s yeniden işlenecek", year, len(links), len(to_fetch))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(index_one, d, ocr, max_pages): d for d in to_fetch}
            for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
                documents.append(future.result())
                if i % 20 == 0:
                    LOG.info("%s yılı PDF işlendi: %s/%s", year, i, len(to_fetch))
        documents.sort(key=lambda d: (d["number"] is None, d["number"] or 99999, d["title"]))
        payload = {"year": year, "updated_at": now, "source": yearurl, "documents": documents}
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tmp.replace(path)
        ok = sum(d["status"] == "ok" for d in documents)
        stats[year] = {"total": len(documents), "ok": ok, "errors": len(documents) - ok,
                       "pages": sum(len(d.get("pages", [])) for d in documents),
                       "ocr_pages": sum(d.get("ocr_pages", 0) for d in documents)}
    # Manifest must include unchanged years so year selection remains complete.
    for f in output.glob("20[12][0-9].json"):
        yr = int(f.stem)
        if yr not in stats:
            try:
                docs = json.loads(f.read_text(encoding="utf-8"))["documents"]
                stats[yr] = {"total": len(docs), "ok": sum(d["status"] == "ok" for d in docs),
                             "errors": sum(d["status"] != "ok" for d in docs),
                             "pages": sum(len(d.get("pages", [])) for d in docs),
                             "ocr_pages": sum(d.get("ocr_pages", 0) for d in docs)}
            except Exception:
                continue
    manifest = {"version": 1, "updated_at": now, "origin": BASE, "years": sorted(stats.keys(), reverse=True),
                "stats": stats, "total": sum(x["total"] for x in stats.values()),
                "indexed": sum(x["ok"] for x in stats.values()),
                "failed_years": failed_years, "ocr_enabled": ocr}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    LOG.info("Bitti: %s PDF bağlantısı, %s metni okunmuş, eksik yıl: %s", manifest["total"], manifest["indexed"], failed_years)
    return 0 if stats and not failed_years else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="docs/data")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--max-pages", type=int, default=0, help="PDF başına taranacak azami sayfa; 0 tüm sayfalar")
    parser.add_argument("--ocr", action="store_true")
    parser.add_argument("--full", action="store_true", help="Re-index all years")
    parser.add_argument("--year", type=int, help="Only index specified year")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    return run(Path(args.output), args.ocr, args.max_pages, max(1, min(8, args.workers)), args.full, args.year)


if __name__ == "__main__":
    sys.exit(main())
