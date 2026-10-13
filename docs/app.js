'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const number = (n) => new Intl.NumberFormat('tr-TR').format(n || 0);
  const districts = ['Ahmetli','Akhisar','Alaşehir','Demirci','Gölmarmara','Gördes','Kırkağaç','Köprübaşı','Kula','Salihli','Sarıgöl','Saruhanlı','Selendi','Soma','Şehzadeler','Turgutlu','Yunusemre'];
  const topicNames = ['Kasis ve hız kesici','Duba ve fiziki düzenleme','Çekici ve otopark','Ticari taksi','Toplu ulaşım','Servis taşımacılığı','Yetki ve güzergâh','Engelli park yeri','Otopark ve parklanma','Sinyalizasyon','Trafik işaretleme','Yol ve kavşak','Hız sınırları','Ücret tarifeleri','Geçiş yolu izni','Hemzemin geçit','MTSK sınav güzergâhı','Terminal ve peron'];
  const norm = (v) => String(v || '').normalize('NFC').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g,'i');
  const safe = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const state = {docs:[], filtered:[], page:1, ready:false, loading:false, manifest:null};
  const perPage = 16;
  const inputs = ['q','mode','year','district','topic','neighborhood','company','status','sort'];

  function options(id, values) {
    const select = $(id);
    for (const name of values) {
      const item = document.createElement('option');
      item.value = name; item.textContent = name; select.appendChild(item);
    }
  }
  options('district', districts); options('topic', topicNames);

  function showAlert(message) { $('alert').textContent = message; $('alert').hidden = false; }
  function hideAlert() { $('alert').hidden = true; }
  function documentSearchText(d) {
    const fields = [d.title, ...(d.pages || []), ...(d.neighborhoods || []), ...(d.topics || []), ...(d.districts || [])];
    return norm(fields.join('\n'));
  }
  const str = (id) => $(id).value.trim();
  function queryTokens(s) {return norm(s).split(/\s+/).filter(Boolean);}
  function matchMode(hay, needle, mode) {
    const terms = queryTokens(needle);
    if (!terms.length) return true;
    if (mode === 'exact') return hay.includes(norm(needle));
    if (mode === 'any') return terms.some(x => hay.includes(x));
    return terms.every(x => hay.includes(x));
  }
  function findPage(d, search, company, neighborhood) {
    const phrases = [search, company, neighborhood].filter(Boolean);
    if (!phrases.length) return -1;
    let best = -1, bestScore = -1;
    (d.pages || []).forEach((text, i) => {
      const val = norm(text);
      const score = phrases.reduce((n, p) => n + (val.includes(norm(p)) ? 3 : queryTokens(p).filter(x => val.includes(x)).length), 0);
      if (score > bestScore) { best = i; bestScore = score; }
    });
    return bestScore > 0 ? best : -1;
  }
  function excerpt(d, page, search, company, neighborhood) {
    const text = (d.pages || [])[page] || '';
    if (!text) return 'Bu belge için okunabilir karar metni henüz oluşturulamadı. Orijinal PDF bağlantısından inceleyebilirsiniz.';
    const checks = [search, company, neighborhood].filter(Boolean);
    let at = 0;
    const normText = norm(text);
    for (const candidate of checks) {
      const idx = normText.indexOf(norm(candidate));
      if (idx >= 0) { at = idx; break; }
      const toks = queryTokens(candidate);
      for (const token of toks) { const pos = normText.indexOf(token); if (pos >= 0) { at = pos; break; } }
      if (at) break;
    }
    const start = Math.max(0, at - 125);
    const chunk = text.slice(start, start + 350).trim();
    return (start ? '…' : '') + chunk + (start + 350 < text.length ? '…' : '');
  }
  function emphasize(s, terms) {
    const candidates = [...new Set(terms.flatMap(s => [s, ...String(s).split(/\s+/)]).map(v => v.trim()).filter(v => v.length >= 3))].sort((a,b)=>b.length-a.length).slice(0,14);
    if (!candidates.length) return safe(s);
    // Highlight without allowing any source PDF markup to enter the DOM.
    const raw = String(s);
    const escapedPieces = [];
    let index = 0;
    const normalized = norm(raw);
    const offsets = [];
    for (const word of candidates) {
      const needle = norm(word); let from = 0;
      while (from < normalized.length) {
        const hit = normalized.indexOf(needle, from);
        if (hit < 0) break;
        offsets.push([hit,hit+needle.length]); from = hit + needle.length;
        if (offsets.length > 70) break;
      }
    }
    offsets.sort((a,b)=>a[0]-b[0]);
    for (const [a,b] of offsets) { if (a < index) continue; escapedPieces.push(safe(raw.slice(index,a)), '<mark>', safe(raw.slice(a,b)), '</mark>'); index=b; }
    escapedPieces.push(safe(raw.slice(index)));
    return escapedPieces.join('');
  }
  function currentFilters() {
    return {q:str('q'), mode:str('mode'), year:str('year'), district:str('district'), topic:str('topic'), neighborhood:str('neighborhood'), company:str('company'), status:str('status'), sort:str('sort')};
  }
  function recompute() {
    const f = currentFilters();
    const q = norm(f.q), company = norm(f.company), neighborhood = norm(f.neighborhood);
    state.filtered = state.docs.filter(d => {
      if (f.year && String(d.year) !== f.year) return false;
      if (f.district && !(d.districts || []).includes(f.district)) return false;
      if (f.topic && !(d.topics || []).includes(f.topic)) return false;
      if (f.status && (f.status === 'error' ? d.status === 'ok' : d.status !== 'ok')) return false;
      if (q && !matchMode(d._search, f.q, f.mode)) return false;
      if (company && !d._search.includes(company)) return false;
      if (neighborhood && !d._search.includes(neighborhood)) return false;
      return true;
    });
    const relevance = (d) => {
      if (!f.q && !f.company && !f.neighborhood) return 0;
      return [f.q, f.company, f.neighborhood].filter(Boolean).reduce((score, term)=> score + (norm(d.title).includes(norm(term)) ? 5 : 0) + (d._search.includes(norm(term)) ? 2 : 0), 0);
    };
    const chronological = (a,b) => b.year - a.year || (b.number||0) - (a.number||0);
    state.filtered.sort(f.sort === 'old' ? (a,b)=>-chronological(a,b) : f.sort === 'relevance' ? (a,b)=>relevance(b)-relevance(a)||chronological(a,b) : chronological);
    state.page=1; render();
  }
  function render() {
    if (!state.ready) return;
    const total = state.filtered.length;
    $('result-title').textContent = `${number(total)} karar belgesi bulundu`;
    $('result-description').textContent = `${number(state.docs.length)} belgeden eşleşen sonuçlar · Her satır bir PDF dosyasını gösterir`;
    $('export').disabled = !total;
    const pageCount = Math.max(1, Math.ceil(total/perPage));
    state.page = Math.max(1,Math.min(pageCount,state.page));
    const f=currentFilters();
    const visible = state.filtered.slice((state.page-1)*perPage, state.page*perPage);
    if (!total) {
      $('results-list').innerHTML='<div class="empty"><strong>Aramanızla eşleşen karar bulunamadı.</strong><p>Farklı yazım biçimlerini deneyebilir veya filtreleri azaltabilirsiniz.</p></div>';
    } else {
      $('results-list').innerHTML = visible.map(d=> {
        const page = findPage(d, f.q, f.company, f.neighborhood);
        const taglist = [ ...(d.districts||[]).slice(0,3), ...(d.topics||[]).slice(0,3), ...(d.neighborhoods||[]).slice(0,2) ];
        const pdf = d.url && /^https:\/\//i.test(d.url) ? d.url : '#';
        const address = pdf === '#' ? '#' : pdf + (page >= 0 ? `#page=${page+1}` : '');
        const sample = excerpt(d, Math.max(0,page), f.q, f.company, f.neighborhood);
        const count = d.page_count||d.pages?.length||0;
        return `<article class="result-card"><div class="card-top"><span class="year-pill">${safe(d.year)}</span><span class="no-pill">${d.number ? 'KARAR '+String(d.number).padStart(2,'0') : 'KARAR ARŞİVİ'}</span><span class="card-status ${d.status!=='ok'?'is-error':''}">${d.status==='ok'?'● Tam metin':'○ Metin okunamadı'}</span></div><h3 class="card-title">${safe(d.title)}</h3><p class="card-snippet">${emphasize(sample, [f.q,f.company,f.neighborhood].filter(Boolean))}</p><div class="card-meta">${taglist.map(t=>`<span class="tag">${safe(t)}</span>`).join('')}${!taglist.length?'<span class="tag">Konu başlığından eşleşen sonuç</span>':''}</div><div class="card-foot"><span class="page-line">${count ? `${number(count)} sayfa` : 'Sayfa bilgisi yok'}${page>=0 ? ` · Eşleşme: ${page+1}. sayfa` : ''}${d.ocr_pages ? ` · ${d.ocr_pages} OCR` : ''}</span><a class="pdf-link" href="${safe(address)}" target="_blank" rel="noopener noreferrer">Kaynak PDF'yi aç ↗</a></div></article>`;
      }).join('');
    }
    $('pagination').hidden=pageCount<=1;
    $('page-info').textContent=`Sayfa ${state.page}/${pageCount} · ${number(total)} belge`;
    $('prev').disabled=state.page===1;
    $('next').disabled=state.page===pageCount;
  }
  function downloadCSV() {
    const fields = ['Yıl','Karar No','Başlık','İlçeler','Konular','Mahalleler','Sayfa','Durum','Kaynak PDF'];
    const lines = [fields,...state.filtered.map(d => [d.year,d.number||'',d.title,(d.districts||[]).join('; '),(d.topics||[]).join('; '),(d.neighborhoods||[]).join('; '),d.page_count||0,d.status,d.url])];
    const quote = (v) => '"'+String(v == null?'':v).replace(/"/g,'""')+'"';
    const blob = new Blob(['\ufeff'+lines.map(row=>row.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a');a.href=URL.createObjectURL(blob);a.download='manisa-ukome-kararlar.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }
  function schedule() { clearTimeout(schedule.timer);schedule.timer=setTimeout(recompute,170); }
  inputs.forEach(id => $(id).addEventListener(id==='q'||id==='company'||id==='neighborhood' ? 'input':'change', schedule));
  $('clear').addEventListener('click',()=> {['q','year','district','topic','neighborhood','company','status'].forEach(x=>$(x).value='');$('mode').value='all';recompute();});
  document.querySelectorAll('[data-term]').forEach(el=>el.addEventListener('click',()=>{$('q').value=el.dataset.term;$('mode').value='exact';recompute();}));
  $('export').addEventListener('click',downloadCSV);
  $('prev').addEventListener('click',()=>{state.page--;render();$('result-title').scrollIntoView({behavior:'smooth'});});
  $('next').addEventListener('click',()=>{state.page++;render();$('result-title').scrollIntoView({behavior:'smooth'});});

  async function load() {
    state.loading = true;
    try {
      const request = await fetch('data/manifest.json',{cache:'no-cache'});
      if (!request.ok) throw new Error('İndeks dosyası henüz yayımlanmamış.');
      const manifest=await request.json();state.manifest=manifest;
      const years=manifest.years||[];
      options('year', years.map(String));
      $('updated').textContent=manifest.updated_at ? new Date(manifest.updated_at).toLocaleDateString('tr-TR') : '—';
      $('stat-docs').textContent=number(manifest.total);
      $('stat-years').textContent=number(years.length);
      $('stat-pages').textContent=number(Object.values(manifest.stats||{}).reduce((n,stat)=>n+(stat.pages||0),0));
      if (!years.length) {
        showAlert('Henüz hiçbir PDF tam metin dizinine alınmadı. GitHub üzerindeki “UKOME Arşivini Güncelle” işlemi tamamlandığında gerçek kararlar burada listelenecek.');
        $('result-title').textContent='Arşiv oluşturulmayı bekliyor';
        $('result-description').textContent='Arayüz hazır, karar metinleri henüz yüklenmedi.';
        $('results-list').innerHTML='<div class="empty"><strong>Henüz veri bulunmuyor.</strong><p>Bu sayfa örnek karar üretmez; yalnızca belediyenin gerçek PDF dosyalarından çıkarılan bilgileri listeler.</p></div>';
        return;
      }
      const loaded=await Promise.allSettled(years.map(async year=> {
        const r=await fetch(`data/${encodeURIComponent(year)}.json`);
        if(!r.ok) throw new Error(`${year} verisi yüklenemedi`);
        const data=await r.json();return data.documents||[];
      }));
      let failures=0;
      for(const item of loaded){if(item.status==='fulfilled')state.docs.push(...item.value);else failures++;}
      for (const d of state.docs) d._search = documentSearchText(d);
      state.ready=true;
      if (failures) showAlert(`${failures} yıla ait veri dosyasına ulaşılamadı. Gösterilen sonuçlar kısmi olabilir.`);
      else if (manifest.indexed < manifest.total || (manifest.failed_years||[]).length) showAlert(`Arşivdeki ${number(manifest.total)} PDF bağlantısının ${number(manifest.indexed)} tanesinden metin çıkarılabildi. Okunamayan kararlar için kaynak PDF bağlantısını kullanın; bazı yılların taraması eksik olabilir.`);
      else hideAlert();
      recompute();
    } catch(error) {
      showAlert(`Arşiv verileri açılamadı: ${error.message}. Uygulamanın yayımlandığı adresi ve güncelleme işlemini kontrol edin.`);
      $('result-title').textContent='Arşiv henüz erişilebilir değil';
      $('result-description').textContent='Daha sonra tekrar deneyin.';
    } finally {state.loading=false;}
  }
  load();
})();
