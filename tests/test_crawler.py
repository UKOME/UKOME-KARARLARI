import io
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fitz
from crawler import archive_pages, decision_links, extract_pdf, tags

class CrawlerTests(unittest.TestCase):
    def test_archive_year_detection(self):
        html = '''<nav><a href="/t23_ulasim-dairesi-baskanligi.aspx?sayfa=icerik&amp;sid=3052">UKOME Kararları (2026)</a><a href="/t23_ulasim-dairesi-baskanligi.aspx?sayfa=icerik&amp;sid=3042">UKOME Kararları (2025 )</a><a href="/other">Duyuru (2026)</a></nav>'''
        links = archive_pages(html)
        self.assertTrue(links[2026].endswith('sid=3052'))
        self.assertTrue(links[2025].endswith('sid=3042'))
        self.assertEqual(len(links), 2)

    def test_pdf_link_extraction(self):
        html = '''<article><a href="/upload/teskilat/dosya/a.pdf">2026-01 Merkez Trafik Düzenlemeleri</a><a href="https://manisa.bel.tr/upload/teskilat/dosya/b.pdf">2026-02 Merkez Engelli Araç Park Yerleri</a><a href="/t23_ulasim">Ulaşım</a></article>'''
        links = decision_links(html, 2026)
        self.assertEqual(len(links), 2)
        self.assertEqual([x['number'] for x in links], [1, 2])

    def test_pdf_text_extract(self):
        doc=fitz.open()
        page=doc.new_page()
        page.insert_text((36,80), 'MANISA SEYAHAT test decision D4', fontsize=12)
        data=doc.tobytes();doc.close()
        pages, count, ocr_count, notes=extract_pdf(data, ocr=False, max_pages=0)
        self.assertEqual(count,1)
        self.assertIn('MANISA SEYAHAT', pages[0])
        self.assertEqual(ocr_count,0)
        self.assertEqual(notes, [])

    def test_topic_and_district_classification(self):
        d,t,n=tags('Turgutlu ilçesinde kasis ve duba düzenlemesi değerlendirilmiştir. Muradiye Mahallesi', '2026-25 Trafik düzenleme')
        self.assertIn('Turgutlu', d)
        self.assertIn('Kasis ve hız kesici',t)
        self.assertIn('Duba ve fiziki düzenleme',t)
        self.assertIn('Muradiye',n)

if __name__=='__main__':unittest.main()

class EndToEndTests(unittest.TestCase):
    def test_generated_year_index_and_manifest(self):
        import tempfile
        from unittest.mock import patch
        import crawler
        home='''<a href="/t23_ulasim-dairesi-baskanligi.aspx?sayfa=icerik&amp;sid=3052">UKOME Kararları (2026)</a>'''
        archive='''<a href="/upload/teskilat/dosya/a.pdf">2026-01 Kasis Düzenlemesi</a>'''
        def fake_get(_, url): return home + archive
        def fake_index(d, *args):
            return {**d, 'pages':['Manisa Seyahat Kasis talebi incelendi.'], 'page_count':1, 'ocr_pages':0,
                    'status':'ok', 'errors':[], 'districts':[], 'topics':['Kasis ve hız kesici'], 'neighborhoods':[]}
        with tempfile.TemporaryDirectory() as folder:
            with patch('crawler.get_page', side_effect=fake_get), patch('crawler.index_one', side_effect=fake_index):
                result=crawler.run(Path(folder), False, 0, 1, False, 2026)
            self.assertEqual(result,0)
            data=__import__('json').loads((Path(folder)/'2026.json').read_text(encoding='utf-8'))
            self.assertEqual(len(data['documents']),1)
            self.assertIn('Manisa Seyahat', data['documents'][0]['pages'][0])
            report=__import__('json').loads((Path(folder)/'manifest.json').read_text(encoding='utf-8'))
            self.assertEqual(report['indexed'],1)
