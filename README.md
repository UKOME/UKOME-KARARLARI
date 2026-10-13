# Manisa UKOME Karar Arama Sistemi

Bu proje Manisa Büyükşehir Belediyesi'nin internette yayımladığı **2014 ve sonrasındaki UKOME PDF kararlarını** bulup karar metinlerini önceden işleyen, tarayıcıdan hızlı aramaya uygun bir arşiv oluşturur.

**Önemli:** Bu bağımsız bir arama uygulamasıdır; resmî belediye sitesi değildir. Karar metninde hukuken geçerli olan belge kaynak PDF'dir. Otomatik alan çıkarma ve OCR hatalı sonuç verebilir. Kamuya açık kararlar kişisel bilgi içerebileceğinden herkese açık yayımlamadan önce kurumun veri yayımlama ve KVKK değerlendirmesi yapılmalıdır.

## Kurulumsuz kullanım: GitHub üzerinden yayın

1. [github.com/new](https://github.com/new) adresinde `manisa-ukome-arama` isimli **Public** (herkese açık) yeni depo açın. Ana dal `main` olsun. İsterseniz README seçeneğini açın.
2. İndirdiğiniz ZIP'i Windows'ta **Tümünü ayıkla** ile açın. İçindeki `crawler.py`, `requirements.txt`, `docs` klasörü ve **`.github` klasörünü** seçin. GitHub deponuzdaki **Add file → Upload files** ekranına **dosya ve klasörlerin kendilerini** sürükleyip bırakın; **Commit changes** ile kaydedin. Ana dalda `.github/workflows/ukome-guncelle.yml` yolunun yer aldığını kontrol edin.
3. Depoda **Settings → Pages → Build and deployment → Source → GitHub Actions** seçin. (GitHub'ın kendi özel dağıtım işlemi kullanılacaktır.)
4. **Actions → UKOME Arşivini Güncelle ve Yayımla → Run workflow** butonuna basın. İlk tarama GitHub'ın bulut bilgisayarında yapılır; belediyenin PDF'lerine bağlı olarak uzayabilir. İşlemin yeşil tamamlandığını kontrol edin.
5. **Settings → Pages** ekranında çıkan internet adresini açın. Adres genel olarak `https://KULLANICI.github.io/manisa-ukome-arama/` biçiminde olur.

**Sonraki güncellemeler:** GitHub Actions her pazartesi otomatik yeni kararları denetler. Önceki yıllarda başarılı indekslenen PDF'lerin metni korunur. Güncel yıl ve bir önceki yıl yeniden işlenir; diğer yıllarda hatalı PDF'ler tekrar denenir. İstenirse `Run workflow` ile elle yenileme yapılabilir. Arama yapılırken PDF'ler yeniden indirilmez.

**PDF hataları:** Kararlar belediyenin sunucusundan indirilemezse, bozuksa veya taranmış belgenin OCR'si başarısız olursa sistem bunu gizlemez: arayüzde 'Metin okunamadı' olarak işaretler. Varsayılan olarak PDF'lerin **tüm sayfaları** işlenir. Çok büyük belgelerde taramayı sınırlamak gerekirse `--max-pages` parametresi kullanılabilir. Veri dizininin eksikliği veya başarısız yıl taraması web sayfasında bildirilir.

## Arama özellikleri

- PDF'lerin **tüm sayfa metinlerinde** serbest arama; tüm kelimeler, tam ifade veya herhangi bir kelime
- Firma/kurum adı (örneğin **Manisa Seyahat**) ve mahalle/yer adıyla serbest arama
- İlçe, yıl, konu, belge durumu ve filtrelerin birlikte uygulanması
- Kasis, duba, çekici, D4 yetki belgesi, yol düzenlemesi, sinyalizasyon, servis, ücret, peron ve benzeri kategoriler
- Eşleşmenin bulunduğu PDF sayfasını işaretleyen bağlantı, kısa metin önizlemesi
- Sonuçları **CSV** biçiminde indirme
- OCR: Görüntü olarak taranmış sayfalar için Türkçe + İngilizce Tesseract; sonuçları kontrol edin

## Teknik yapı

- `crawler.py`: kamuya açık yıllık karar arşivlerini bulur; yıllık sayfalardaki PDF bağlantılarını ayrıştırır; PyMuPDF ve OCR ile metin çıkarır; yıl/yaprak/page verilerini JSON'a kaydeder.
- `docs/index.html`, `docs/style.css`, `docs/app.js`: ek sunucu veya veritabanı gerektirmeyen statik arama uygulaması; hiçbir PDF kullanıcı arama yaptığında okunmaz.
- `docs/data/20xx.json`: yıl bazlı işlenmiş kararlar. Bu dosyalar **ilk çalıştırmada oluşturulur**.
- `build_manifest.py`: yıl bazlı indekslerin işlenme sayıları ve hata raporunu birleştirir.
- `.github/workflows/ukome-guncelle.yml`: Her yılı kontrollü paralel işlemler halinde tarar, verileri birleştirir ve uygulamayı GitHub Pages üzerinde yayımlar.

## Sorun giderme

- Site 'Arşiv oluşturulmayı bekliyor' diyorsa **Actions** sekmesinden iş akışının gerçekten tamamlandığını kontrol edin.
- Actions bölümünde iş akışı görünmüyorsa `main` dalında `.github/workflows/ukome-guncelle.yml` dosyası eksik olabilir.
- **Deploy Pages** hatası alırsanız Settings → Pages bölümünde **Source: GitHub Actions** seçili mi kontrol edin.
- `git push` 403 hatası olursa Settings → Actions → General → Workflow permissions bölümünde **Read and write permissions** seçeneğini etkinleştirmek gerekebilir.
- `manisa.bel.tr` erişimi başarısızsa tarama eksik kalabilir. Bu durumda GitHub'daki iş akışı günlüğü ve `docs/data/manifest.json` sayıları incelenmelidir.
- İleride arşiv yeni bir yıla geçerse `crawler.py` içinde `YEARS` listesi güncellenebilir.

## Yerel geliştirme (isteğe bağlı, kurum bilgisayarına kurulum gerekmez)

```bash
python -m pip install -r requirements.txt
python crawler.py --ocr --year 2026
python -m http.server 8000 --directory docs
```

Uygulamanın çalışması için herhangi bir Cloudflare hesabı gerekmez.
