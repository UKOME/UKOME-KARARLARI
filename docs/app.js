'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const number = (n) => new Intl.NumberFormat('tr-TR').format(n || 0);
  const districts = ['Ahmetli','Akhisar','Alaşehir','Demirci','Gölmarmara','Gördes','Kırkağaç','Köprübaşı','Kula','Salihli','Sarıgöl','Saruhanlı','Selendi','Soma','Şehzadeler','Turgutlu','Yunusemre'];
  const topicNames = ['Kasis ve hız kesici','Duba ve fiziki düzenleme','Çekici ve otopark','Ticari taksi','Toplu ulaşım','Servis taşımacılığı','Yetki ve güzergâh','Engelli park yeri','Otopark ve parklanma','Sinyalizasyon','Trafik işaretleme','Yol ve kavşak','Hız sınırları','Ücret tarifeleri','Geçiş yolu izni','Hemzemin geçit','MTSK sınav güzergâhı','Terminal ve peron'];
  const norm = (v) => String(v || '').normalize('NFC').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g,'i');
  const safe = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const state = {docs:[], filtered:[], page:1, ready:false, loading:false, manifest:null, activeDoc:null, readerPage:0, originalPdfCount:0, segmentedCount:0};
  // The additional subjects below run against already indexed PDF text: no PDF download needed.
  const extendedTopics = {
    'Yaya geçidi ve yaya güvenliği': ['yaya geçidi','yaya geçit','yaya güvenli','yaya üst geçidi','yaya alt geçidi'],
    'Okul ve öğrenci güvenliği': ['okul önü','okul çevresi','okul geçidi','okul giriş','öğrenci indirme','öğrenci güvenli'],
    'Durak yeri ve düzenlemesi': ['durak yeri','durak taleb','durak konumu','durak değiş','yeni durak','durak cebi'],
    'Park yasağı ve parklanma': ['park yasağı','park yasa','park etme','parklanma','park yeri düzenle'],
    'Tek yön ve yön değişikliği': ['tek yön','tek yönlü','yön değişikliği','yön düzenle','yolun tek yöne'],
    'Trafiğe kapatma ve açma': ['trafiğe kapat','trafiğe açıl','araç trafiğine kapat','geçici yol kapatma'],
    'Kavşak ve dönel kavşak': ['kavşak düzenle','dönel kavşak','göbek düzenle','kavşak yapım','kavşak proj'],
    'Bisiklet yolu': ['bisiklet yolu','bisiklet şeridi','bisiklet park'],
    'Yükleme ve boşaltma': ['yükleme boşaltma','yükleme ve boşaltma','yük indirme','mal indirme'],
    'Sokak ve cadde düzenlemesi': ['sokak düzenle','cadde düzenle','bulvar düzenle','yol düzenleme'],
    'Muhtar ve muhtarlık talepleri': ['muhtar','muhtarlık','muhtarının','muhtarlığı'],
    'Plaka ve tahsis işlemleri': ['plaka tahsis','plaka devir','plaka değiş','plaka iptal','plaka işlemleri'],
    'Akıllı ulaşım ve elektronik denetim': ['pts sistemi','plaka tanıma','elektronik denetleme','eds','akıllı ulaşım'],
    'Tır, kamyon ve ağır taşıt': ['kamyon güzerg','tır güzerg','ağır taşıt','tonaj sınır','yük taşıma'],
    'Araç park ve bekleme noktası': ['bekleme alan','bekleme yeri','cep düzenle','otobüs park','taksi bekleme'],
    'Trafik aynası, bariyer ve korkuluk': ['trafik aynası','bariyer','korkuluk','demir bariyer'],
    'Köprü ve alt geçit': ['köprü düzenle','alt geçit','üst geçit'],
    'Hat ve sefer düzenlemesi': ['hat güzerg','hat değiş','sefer saat','sefer düzen','hat uzat'],
    'Dilekçe ve talep değerlendirmesi': ['talebinin değerlendiril','dilekçesinde','talebine ilişkin','talep ettiği']
  };
  const roadTerms = {sokak:/\b(?:sokak\w*|sk\.?|sok\.?)\b/,cadde:/\b(?:cadde\w*|cadd\w*|cad\.?|cd\.?)\b/,bulvar:/\b(?:bulvar\w*|bulv\.?|blv\.?)\b/};
  const applicants = {muhtar:['muhtar','muhtarl'],firma:['firma','kooperatif','şirket','limited','anonim şirket'],vatandas:['vatandaş','şahıs','gerçek kişi'],kurum:['müdürlük','belediye başkanlığ','kaymakamlık','kurum','daire başkanlığ']};

  const perPage = 16;
  const inputs = ['q','mode','year','district','topic','neighborhood','company','status','sort','decisionNo','roadType','roadName','person','unit','applicant'];

  function options(id, values) {
    const select = $(id);
    for (const name of values) {
      const item = document.createElement('option');
      item.value = name; item.textContent = name; select.appendChild(item);
    }
  }
  options('district', districts); options('topic', topicNames.concat(Object.keys(extendedTopics)));

  function showAlert(message) { $('alert').textContent = message; $('alert').hidden = false; }
  function hideAlert() { $('alert').hidden = true; }
  function documentSearchText(d) {
    const fields = [d.segmented ? d.agendaLabel : d.title, ...(d.pages || []), ...(d.neighborhoods || []), ...(d.topics || []), ...(d.districts || [])];
    return norm(fields.join('\n'));
  }
  const str = (id) => $(id).value.trim();
  function queryTokens(s) {return norm(s).split(/\s+/).filter(Boolean);}
  const synonyms = {
    'kasis':['kasis','hız kesici','hız tümseği','hız azaltıcı'],
    'duba':['duba','delinatör','esnek dikme','ayırıcı dikme'],
    'cekici':['çekici','araç çekme','araç kaldırma','otoparka çek'],
    'engelli':['engelli','erişilebilir','özürlü'],
    'muhtar':['muhtar','muhtarlık'],
    'durak':['durak','durak yeri','durak cebi'],
    'park yasagi':['park yasağı','park edilmemesi','park yasa'],
    'yaya gecidi':['yaya geçidi','yaya güvenliği','yaya geçit']
  };
  function matchMode(hay, needle, mode) {
    const terms = queryTokens(needle);
    const expansion = synonyms[norm(needle).trim()];
    if (expansion && mode !== 'exact') return expansion.some(word => hay.includes(norm(word)));
    if (!terms.length) return true;
    if (mode === 'exact') return hay.includes(norm(needle));
    if (mode === 'any') return terms.some(x => hay.includes(x));
    return terms.every(x => hay.includes(x));
  }
  function findPage(d, ...items) {
    const phrases = items.filter(Boolean);
    if (!phrases.length) return -1;
    let best = -1, bestScore = -1;
    (d.pages || []).forEach((text, i) => {
      const val = norm(text);
      const score = phrases.reduce((n, p) => n + (val.includes(norm(p)) ? 3 : queryTokens(p).filter(x => val.includes(x)).length), 0);
      if (score > bestScore) { best = i; bestScore = score; }
    });
    return bestScore > 0 ? best : -1;
  }
  function excerpt(d, page, ...items) {
    const text = (d.pages || [])[page] || '';
    if (!text) return 'Bu belge için okunabilir karar metni henüz oluşturulamadı. Orijinal PDF bağlantısından inceleyebilirsiniz.';
    const checks = items.filter(Boolean);
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
    return {q:str('q'), mode:str('mode'), year:str('year'), district:str('district'), topic:str('topic'), neighborhood:str('neighborhood'), company:str('company'), status:str('status'), sort:str('sort'), decisionNo:str('decisionNo'), roadType:str('roadType'), roadName:str('roadName'), person:str('person'), unit:str('unit'), applicant:str('applicant')};
  }
  const primaryTopicWords = {
    'Kasis ve hız kesici':['kasis','hız kesici','hız tümseği'],
    'Duba ve fiziki düzenleme':['duba','delinatör','bariyer','ayırıcı'],
    'Çekici ve otopark':['çekici','otoparka çek','araç çekme'],
    'Ticari taksi':['ticari taksi','taksi durağı','t plaka'],
    'Toplu ulaşım':['otobüs','toplu taşıma','toplu ulaşım','minibüs'],
    'Servis taşımacılığı':['servis aracı','öğrenci servisi','personel servisi','servis taşımacılığı'],
    'Yetki ve güzergâh':['d4','d1','güzergâh','yetki belgesi'],
    'Engelli park yeri':['engelli park','engelli araç','engelli park yeri'],
    'Otopark ve parklanma':['otopark','parklanma','park yeri'],
    'Sinyalizasyon':['sinyalizasyon','trafik ışığı','ışıklı işaret'],
    'Trafik işaretleme':['trafik levhası','işaretleme','levha'],
    'Yol ve kavşak':['kavşak','yol düzenleme'],
    'Hız sınırları':['hız sınırı','hız limiti'],
    'Ücret tarifeleri':['ücret tarifesi','tarife'],
    'Geçiş yolu izni':['geçiş yolu izni','geçiş izni'],
    'Hemzemin geçit':['hemzemin geçit'],
    'MTSK sınav güzergâhı':['mtsk','sınav güzergâhı'],
    'Terminal ve peron':['terminal','peron','otogar']
  };
  function topicMatches(d, selected) {
    if (!selected) return true;
    if ((d.topics || []).includes(selected)) return true;
    const terms = extendedTopics[selected] || (d.segmented ? primaryTopicWords[selected]||[] : []);
    return terms.some(term => d._search.includes(norm(term)));
  }
  function roadMatches(d, name, roadType) {
    const typ = roadTerms[roadType];
    if (!name && !typ) return true;
    if (!typ) return d._search.includes(norm(name));
    if (!name) return typ.test(d._search);
    // Require the road's name and its type near each other within a single page.
    // This reduces unrelated combinations from different agenda items.
    return [d.title, ...(d.pages || [])].some(text => {
      const body = norm(text), wanted = norm(name);
      let from = 0;
      while (from < body.length) {
        const at = body.indexOf(wanted,from);
        if (at < 0) break;
        const vicinity = body.slice(Math.max(0,at-85), Math.min(body.length,at+wanted.length+85));
        if (typ.test(vicinity)) return true;
        from = at + wanted.length;
      }
      return false;
    });
  }
  function numberMatches(d, wanted) {
    if (!wanted) return true;
    const raw = wanted.trim().replace(/\s+/g,'');
    const match = raw.match(/^(20\d{2})[-/.](\d{1,4})$/);
    if (match) return String(d.year)===match[1] && Number(d.number)===Number(match[2]);
    if (/^\d{1,4}$/.test(raw)) return Number(d.number) === Number(raw);
    return norm(d.title).includes(norm(wanted));
  }
  function agendaView(d, record, index, total) {
    if (!record || total < 2) return d;
    const pageMap=[];
    const pages=[];
    for (let pg=record.from_page; pg<=record.to_page; pg++) {
      const source=d.pages?.[pg]||'';
      const first=pg===record.from_page?record.from_char:0;
      const last=pg===record.to_page?record.to_char:source.length;
      pages.push(source.slice(first,last));pageMap.push(pg);
    }
    const text=pages.join(' ');
    return {...d, id:String(d.id||d.url)+':agenda:'+index, sourceId:d.id,
      pages, pageMap, agendaLabel:record.label, segmented:true,
      // Source-wide tags must not be attributed to another agenda item.
      districts:(d.districts||[]).filter(x=>norm(text).includes(norm(x))),
      neighborhoods:(d.neighborhoods||[]).filter(x=>norm(text).includes(norm(x))),
      topics:[], originalTitle:d.title,
      title:d.title+' — '+record.label};
  }
  function expandAgendas(d, ranges) {
    if (!Array.isArray(ranges) || ranges.length<2) return [d];
    return ranges.map((r,i)=>agendaView(d,r,i,ranges.length));
  }
  const pdfPage = (d, page) => (d.pageMap && d.pageMap[page]!==undefined ? d.pageMap[page] : page) + 1;
  function recompute() {
    const f=currentFilters();
    state.filtered=state.docs.filter(d=>{
      if(f.year && String(d.year)!==f.year)return false;
      if(f.status && (f.status==='error' ? d.status==='ok' : d.status!=='ok'))return false;
      if(f.decisionNo&&!numberMatches(d,f.decisionNo))return false;
      // A decision number typed in the main search box is recognized from metadata.
      let searchFilters=f;
      if(UKOMESearch.isDecisionNumberQuery(f.q)){
        if(!numberMatches(d,f.q))return false;
        searchFilters={...f,q:''};
      }
      const evidence=UKOMESearch.matchRecord(d,searchFilters);
      d._evidence=evidence;
      return evidence.matched;
    });
    const chronological=(a,b)=>b.year-a.year||(b.number||0)-(a.number||0);
    const relevance=d=>(d._evidence?.score||0)+(UKOMESearch.norm(d.title).includes(UKOMESearch.norm(f.q||'').trim())&&f.q?10:0);
    state.filtered.sort(f.sort==='old'?(a,b)=>-chronological(a,b):f.sort==='relevance'?(a,b)=>relevance(b)-relevance(a)||chronological(a,b):chronological);
    state.page=1;render();
  }
  function render() {
    if (!state.ready) return;
    const total = state.filtered.length;
    $('result-title').textContent = `${number(total)} eşleşen sonuç bulundu`;
    $('result-description').textContent = `${number(state.originalPdfCount)} kaynak PDF · ${number(state.segmentedCount)} PDF'de açık gündem başlıkları ayrı listelendi`;
    $('export').disabled = !total;
    const pageCount = Math.max(1, Math.ceil(total/perPage));
    state.page = Math.max(1,Math.min(pageCount,state.page));
    const f=currentFilters();
    const visible = state.filtered.slice((state.page-1)*perPage, state.page*perPage);
    if (!total) {
      $('results-list').innerHTML='<div class="empty"><strong>Aramanızla eşleşen karar bulunamadı.</strong><p>Farklı yazım biçimlerini deneyebilir veya filtreleri azaltabilirsiniz.</p></div>';
    } else {
      $('results-list').innerHTML = visible.map(d=> {
        const terms = [f.q, f.company, f.neighborhood, f.roadName, f.person, f.unit].filter(Boolean);
        const page = d._evidence?.page >= 0 ? d._evidence.page : findPage(d, ...terms);
        const taglist = [ ...(d.districts||[]).slice(0,3), ...(d.topics||[]).slice(0,3), ...(d.neighborhoods||[]).slice(0,2) ];
        const pdf = d.url && /^https:\/\//i.test(d.url) ? d.url : '#';
        const address = pdf === '#' ? '#' : pdf + (page >= 0 ? `#page=${pdfPage(d,page)}` : '');
        const sample = d._evidence?.snippetStart !== undefined && d._evidence.page >= 0 ? ((d.pages?.[page]||'').slice(d._evidence.snippetStart, d._evidence.snippetStart+360)) : excerpt(d, Math.max(0,page), ...terms);
        const count = d.segmented ? d.pages.length : (d.page_count||d.pages?.length||0);
        return `<article class="result-card"><div class="card-top"><span class="year-pill">${safe(d.year)}</span><span class="no-pill">${d.number ? 'KARAR '+String(d.number).padStart(2,'0') : 'KARAR ARŞİVİ'}</span><span class="card-status ${d.status!=='ok'?'is-error':''}">${d.status==='ok'?'● Metni okundu':'○ Metin okunamadı'}</span></div><h3 class="card-title">${safe(d.title)}</h3>${d.segmented?'<div class="agenda-note">Açık başlıktan ayrıştırılmış gündem maddesi · Kaynak PDF korunuyor</div>':''}<p class="card-snippet">${emphasize(sample, terms)}</p><div class="card-meta">${taglist.map(t=>`<span class="tag">${safe(t)}</span>`).join('')}${!taglist.length?'<span class="tag">Konu başlığından eşleşen sonuç</span>':''}</div><div class="card-foot"><span class="page-line">${count ? `${number(count)} sayfa` : 'Sayfa bilgisi yok'}${page>=0 ? ` · PDF sayfası: ${pdfPage(d,page)}` : ''}${d._evidence?.evidence==='same-passage' && d._evidence?.groupCount>1 ? ' · Ölçütler aynı bölümde' : ''}${d.ocr_pages ? ` · ${d.ocr_pages} OCR` : ''}</span><div class="card-actions"><button type="button" class="read-link" data-doc="${safe(d.id)}">Karar metnini görüntüle</button><a class="pdf-link" href="${safe(address)}" target="_blank" rel="noopener noreferrer">Kaynak PDF'yi aç ↗</a></div></div></article>`;
      }).join('');
    }
    $('pagination').hidden=pageCount<=1;
    $('page-info').textContent=`Sayfa ${state.page}/${pageCount} · ${number(total)} sonuç`;
    $('prev').disabled=state.page===1;
    $('next').disabled=state.page===pageCount;
  }
  function downloadCSV() {
    const fields = ['Yıl','Karar No','Başlık / Gündem','İlçeler','Konular','Mahalleler','Sayfa','Durum','Kaynak PDF'];
    const lines = [fields,...state.filtered.map(d => [d.year,d.number||'',d.title,(d.districts||[]).join('; '),(d.topics||[]).join('; '),(d.neighborhoods||[]).join('; '),d.page_count||0,d.status,d.url])];
    const quote = (v) => '"'+String(v == null?'':v).replace(/"/g,'""')+'"';
    const blob = new Blob(['\ufeff'+lines.map(row=>row.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const a = document.createElement('a');a.href=URL.createObjectURL(blob);a.download='manisa-ukome-kararlar.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }
  function schedule() { clearTimeout(schedule.timer);schedule.timer=setTimeout(recompute,170); }
  inputs.forEach(id => $(id).addEventListener(['q','company','neighborhood','decisionNo','roadName','person','unit'].includes(id) ? 'input':'change', schedule));
  $('clear').addEventListener('click',()=> {['q','year','district','topic','neighborhood','company','status','decisionNo','roadType','roadName','person','unit','applicant'].forEach(x=>$(x).value='');$('mode').value='all';$('sort').value='relevance';recompute();});
  document.querySelectorAll('[data-term]').forEach(el=>el.addEventListener('click',()=>{$('q').value=el.dataset.term;$('mode').value='exact';recompute();}));
  $('export').addEventListener('click',downloadCSV);
  $('prev').addEventListener('click',()=>{state.page--;render();$('result-title').scrollIntoView({behavior:'smooth'});});
  $('next').addEventListener('click',()=>{state.page++;render();$('result-title').scrollIntoView({behavior:'smooth'});});

  function paintReader() {
    const d=state.activeDoc;
    if (!d) return;
    const pages=d.pages || [];
    const index=state.readerPage;
    const text=pages[index] || 'Bu sayfa için okunabilir metin bulunmuyor. Kaynak PDF üzerinden inceleyiniz.';
    const f=currentFilters();
    const terms=[f.q,f.company,f.neighborhood,f.roadName,f.person,f.unit].filter(Boolean);
    $('reader-text').innerHTML=emphasize(text,terms).replace(/\n/g,'<br>');
    $('reader-page').value=String(index);
    $('reader-prev').disabled=index<=0;
    $('reader-next').disabled=index>=pages.length-1;
    $('reader-pdf').href=/^https:\/\//.test(d.url||'') ? d.url + `#page=${pdfPage(d,index)}` : '#';
    $('reader-meta').textContent=`${d.year} · ${d.number ? 'Karar '+d.number+' · ' : ''}${pages.length} metin bölümü · PDF sayfası ${pdfPage(d,index)}`;
    $('reader-text').scrollTop=0;
  }
  function openReader(id) {
    const d=state.docs.find(item=>item.id===id);
    if(!d) return;
    state.activeDoc=d;
    const f=currentFilters();
    const page=d._evidence?.page >= 0 ? d._evidence.page : findPage(d,...[f.q,f.company,f.neighborhood,f.roadName,f.person,f.unit].filter(Boolean));
    state.readerPage=Math.max(0,page);
    $('reader-title').textContent=d.title;
    const picker=$('reader-page');
    picker.replaceChildren();
    (d.pages||[]).forEach((_,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`PDF ${pdfPage(d,i)} / ${d.page_count||d.pages.length}`;picker.appendChild(o);});
    if (!picker.options.length){const o=document.createElement('option');o.value='0';o.textContent='1 / 1';picker.appendChild(o);}
    paintReader();
    $('reader').showModal();
  }
  $('results-list').addEventListener('click',ev=>{
    const b=ev.target.closest('[data-doc]');
    if (b) openReader(b.dataset.doc);
  });
  $('reader-close').addEventListener('click',()=> $('reader').close());
  $('reader-prev').addEventListener('click',()=>{state.readerPage=Math.max(0,state.readerPage-1);paintReader();});
  $('reader-next').addEventListener('click',()=>{state.readerPage=Math.min((state.activeDoc?.pages?.length||1)-1,state.readerPage+1);paintReader();});
  $('reader-page').addEventListener('change',()=>{state.readerPage=Number($('reader-page').value)||0;paintReader();});
  $('reader').addEventListener('click',ev=>{if(ev.target===$('reader'))$('reader').close();});
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
        const data=await r.json();
        let segments={};
        try {
          const agendaReq=await fetch(`data/agenda/${encodeURIComponent(year)}.json`);
          if (agendaReq.ok) segments=(await agendaReq.json()).segments||{};
        } catch (_) { /* Work with original PDFs until split index is created. */ }
        return {pdfs:data.documents||[],segments};
      }));
      let failures=0;
      for(const item of loaded){
        if(item.status!=='fulfilled'){failures++;continue;}
        const {pdfs,segments}=item.value;
        state.originalPdfCount+=pdfs.length;
        for(const d of pdfs){
          const ranges=segments[d.id||d.url]||[];
          if(ranges.length>1)state.segmentedCount++;
          state.docs.push(...expandAgendas(d,ranges));
        }
      }
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
