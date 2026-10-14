/* UKOME V4: Evidence-based, multi-constraint search. No external dependency. */
(function(root,factory){
  const api=factory();
  if(typeof module !== 'undefined' && module.exports) module.exports=api;
  if(root) root.UKOMESearch=api;
})(typeof window !== 'undefined' ? window : globalThis,function(){
'use strict';
const norm = s => String(s||'').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^\p{L}\p{N}\s./+\-]/gu,' ').replace(/\s+/g,' ');
const terms = s=>norm(s).trim().split(/\s+/).filter(Boolean);
const topics = {
 'Kasis ve hız kesici':['kasis','hız kesici','hız tümseği','hız azaltıcı'],
 'Duba ve fiziki düzenleme':['duba','delinatör','esnek dikme','ayırıcı dikme'],
 'Çekici ve otopark':['çekici','araç çekme','otoparka çek','yediemin'],
 'Ticari taksi':['ticari taksi','taksi durağı','t plaka'],
 'Toplu ulaşım':['toplu taşıma','toplu ulaşım','otobüs','minibüs'],
 'Servis taşımacılığı':['servis taşımacılığı','öğrenci servisi','personel servisi','servis aracı'],
 'Yetki ve güzergâh':['yetki belgesi','güzergah','güzergâh','d4','d1'],
 'Engelli park yeri':['engelli park','engelli araç','özürlü park'],
 'Otopark ve parklanma':['otopark','parklanma','park yeri'],
 'Sinyalizasyon':['sinyalizasyon','trafik ışığı','ışıklı kavşak'],
 'Trafik işaretleme':['trafik levhası','işaretleme','levha'],
 'Yol ve kavşak':['kavşak','yol düzenleme','refüj'],
 'Hız sınırları':['hız sınırı','hız limiti'],
 'Ücret tarifeleri':['ücret tarifesi','fiyat tarifesi','taksimetre'],
 'Geçiş yolu izni':['geçiş yolu izni'], 'Hemzemin geçit':['hemzemin'],
 'MTSK sınav güzergâhı':['mtsk','sınav güzergâhı'],
 'Terminal ve peron':['terminal','peron','otogar'],
 'Yaya geçidi ve yaya güvenliği':['yaya geçidi','yaya güvenliği','yaya geçit'],
 'Okul ve öğrenci güvenliği':['okul önü','okul çevresi','okul geçidi','öğrenci güvenliği'],
 'Durak yeri ve düzenlemesi':['durak yeri','durak talebi','durak cebi'],
 'Park yasağı ve parklanma':['park yasağı','park edilmemesi','park yasa'],
 'Tek yön ve yön değişikliği':['tek yön','yön değişikliği'],
 'Trafiğe kapatma ve açma':['trafiğe kapat','trafiğe açıl'],
 'Kavşak ve dönel kavşak':['kavşak','dönel kavşak','kavşak yapım'],
 'Bisiklet yolu':['bisiklet yolu','bisiklet şeridi'],
 'Yükleme ve boşaltma':['yükleme boşaltma','mal indirme','yük indirme'],
 'Sokak ve cadde düzenlemesi':['sokak düzenleme','cadde düzenleme','bulvar düzenleme'],
 'Muhtar ve muhtarlık talepleri':['muhtar','muhtarlık'],
 'Plaka ve tahsis işlemleri':['plaka tahsis','plaka devir','plaka işlemleri'],
 'Akıllı ulaşım ve elektronik denetim':['pts sistemi','plaka tanıma','eds'],
 'Tır, kamyon ve ağır taşıt':['kamyon','tır','ağır taşıt','tonaj'],
 'Araç park ve bekleme noktası':['bekleme alanı','bekleme yeri','otobüs park'],
 'Trafik aynası, bariyer ve korkuluk':['trafik aynası','bariyer','korkuluk'],
 'Köprü ve alt geçit':['köprü','alt geçit','üst geçit'],
 'Hat ve sefer düzenlemesi':['hat güzergâhı','sefer saati','sefer düzenlemesi'],
 'Dilekçe ve talep değerlendirmesi':['talebinin değerlendirilmesi','dilekçesinde','talebine ilişkin']
};
const synonyms = {
 kasis:topics['Kasis ve hız kesici'], duba:topics['Duba ve fiziki düzenleme'],
 cekici:topics['Çekici ve otopark'], osb:['osb','organize sanayi bölgesi','organize sanayi bolgesi'],
 muhtar:['muhtar','muhtarı','muhtarın','muhtarlık','muhtarlığı'], durak:['durak','durak yeri','durak cebi'],
 'yaya gecidi':['yaya geçidi','yaya güvenliği'],
 'park yasagi':['park yasağı','park edilmemesi','park yasa']
};
const applicants={muhtar:['muhtar','muhtarı','muhtarın','muhtarlık','muhtarlığı'],firma:['firma','kooperatif','şirket','limited'],vatandas:['vatandaş','şahıs'],kurum:['müdürlük','belediye başkanlığı','kaymakamlık','daire başkanlığı']};
const roadTypes={sokak:['sokak','sokağı','sk','sok'],cadde:['cadde','caddesi','cd','cad'],bulvar:['bulvar','bulvarı','blv']};
function wordMatches(txt,word){
  const w=norm(word).trim();if(!w)return [];
  const found=[];let at=0;
  while((at=txt.indexOf(w,at))!==-1){
    const left=at===0||!/[a-z0-9]/.test(txt[at-1]);
    const end=at+w.length, right=end===txt.length||!/[a-z0-9]/.test(txt[end]);
    if(left && right)found.push([at,end]);
    at+=Math.max(1,w.length);
    if(found.length>280)break;
  }
  return found;
}
function occurrences(text,alternatives){
 const out=[];
 for(const w of new Set(alternatives.map(x=>norm(x).trim()).filter(Boolean))){
  out.push(...wordMatches(text,w));
 }
 return out.sort((a,b)=>a[0]-b[0]);
}
function makeGroups(f){
 const groups=[];
 function add(name,alts){const v=alts.filter(x=>String(x||'').trim());if(v.length)groups.push({name,alts:v});}
 const q=String(f.q||'').trim(), mode=f.mode||'all';
 if(q){
   const alias=synonyms[norm(q).trim()];
   if(alias && mode!=='exact')add('q',alias);
   else if(mode==='exact')add('q',[q]);
   else if(mode==='any')add('q',terms(q));
   else {
     const tokens=terms(q);
     // A multi-word query must be locally related, but word order is optional.
     tokens.forEach((t,i)=>add('q'+i,synonyms[t]||[t]));
   }
 }
 add('district',[f.district]);add('company',[f.company]);add('neighborhood',[f.neighborhood]);
 add('person',[f.person]);add('unit',[f.unit]);
 if(f.topic)add('topic',topics[f.topic]||[f.topic]);
 if(f.applicant)add('applicant',applicants[f.applicant]||[]);
 if(f.roadType && f.roadName){
   add('roadname',[f.roadName]);add('roadtype',roadTypes[f.roadType]||[]);
 }else if(f.roadName)add('roadname',[f.roadName]);
 else if(f.roadType)add('roadtype',roadTypes[f.roadType]||[]);
 return groups;
}
// Content that describes attendees or legal boilerplate is not a decision locality.
const ALL_DISTRICTS=['Ahmetli','Akhisar','Alaşehir','Demirci','Gölmarmara','Gördes','Kırkağaç','Köprübaşı','Kula','Salihli','Sarıgöl','Saruhanlı','Selendi','Soma','Şehzadeler','Turgutlu','Yunusemre'];
const BOILERPLATE=/(ukome genel kurulu|katılımıyla|katilimiyla|temsilcilerinin|temsilcisi|ile ilgili mevzuat|ilgili mevzuat hukumleri|ilgili mevzuat hükümleri)/;
const HARD_BREAK=/(?:gundem maddesi\s*\d+|\d+\s*[.)-]\s*gundem maddesi|ukome karari\s*:|teklif\s*:|teknik komisyon gorusu\s*:)/g;
function boilderplateOnly(txt, left, right){
  const around=txt.slice(Math.max(0,left-120), Math.min(txt.length,right+80));
  // A roster's names may include districts and OSBs; don't infer a locality from attendance.
  return BOILERPLATE.test(around) && !/(talep|karara|guzergah|osb|sanayi|kasis|cadde|sokak|bulvar|mahall)/.test(txt.slice(left,right));
}
function nearestMatch(page,groups,f){
 const text=norm(page||''); if(!text.trim())return null;
 const hits=[];
 for(let gi=0;gi<groups.length;gi++){
   const occ=occurrences(text,groups[gi].alts);
   if(!occ.length)return null;
   // All groups must have observable textual evidence. No document-wide tags are used.
   for(const [start,end] of occ) hits.push({start,end,group:gi});
 }
 hits.sort((a,b)=>a.start-b.start || a.end-b.end);
 const k=groups.length, counts=Array(k).fill(0);
 let have=0, left=0,best=null;
 const cap=Math.min(720, k===1 ? 1100 : 280+95*(k-2));
 for(let right=0;right<hits.length;right++){
   if(counts[hits[right].group]++===0)have++;
   while(have===k&&left<=right){
      const a=hits[left],b=hits[right];
      const width=b.end-a.start;
      if(width<=cap){
        const between=text.slice(a.start,b.end);
        HARD_BREAK.lastIndex=0;
        const boundary=HARD_BREAK.test(between);
        const roster=boilderplateOnly(text,a.start,b.end);
        // Road's name must appear very near its type, not merely elsewhere in the passage.
        const roadName=groups.findIndex(x=>x.name==='roadname'),roadType=groups.findIndex(x=>x.name==='roadtype');
        const roadOk=roadName<0||roadType<0||hits.slice(left,right+1).some(x=>x.group===roadName&&hits.slice(left,right+1).some(y=>y.group===roadType&&Math.abs(y.start-x.start)<48));
        // A different district immediately attached to OSB/topic outweighs a more remote incidental district.
        let locationOk=true;
        if(f.district && (f.q || f.topic || f.company || f.neighborhood || f.roadName)){
          const position=hits.slice(left,right+1).filter(h=>groups[h.group].name==='district').map(h=>h.start);
          const subject=hits.slice(left,right+1).filter(h=>!['district','roadtype','applicant'].includes(groups[h.group].name)).map(h=>h.start);
          if(position.length && subject.length){
            const chosen=Math.min(...position.flatMap(p=>subject.map(q=>Math.abs(p-q))));
            const competitors=ALL_DISTRICTS.filter(d=>norm(d)!==norm(f.district));
            for(const other of competitors){
              for(const [p] of wordMatches(text,norm(other))){
                if(Math.min(...subject.map(q=>Math.abs(p-q))) + 15 < chosen){locationOk=false;break;}
              }
              if(!locationOk)break;
            }
          }
        }
        if(!boundary&&!roster&&roadOk&&locationOk){
          const choice={start:a.start,end:b.end,width,score:Math.round(1000/(20+width)),snippetStart:Math.max(0,a.start-100)};
          if(!best||choice.width<best.width)best=choice;
        }
      }
      if(--counts[hits[left].group]===0)have--;left++;
   }
 }
 return best;
}
function matchRecord(doc,f){
 const groups=makeGroups(f);
 if(!groups.length)return {matched:true,page:-1,score:0,evidence:'no-text-filter'};
 const pages=doc.pages||[],single=(groups.length===1);
 let best=null;
 pages.forEach((pg,i)=>{
   const found=nearestMatch(pg,groups,f);
   if(found&&(!best||found.width<best.width))best={...found,page:i};
 });
 // When only one filter is used a source filename/title is sufficient evidence.
 // For combinations, NEVER use metadata or tags as proof of related context.
 if(!best&&single){
   const h=norm(doc.title||'');
   if(occurrences(h,groups[0].alts).length)best={page:-1,start:0,end:0,score:1,width:9999,evidence:'title-only'};
 }
 return best?{matched:true,...best,groupCount:groups.length,evidence:best.evidence||'same-passage'}:{matched:false,groupCount:groups.length};
}
function isDecisionNumberQuery(q){return /^20\d\d\s*[-/.]\s*\d{1,4}$/.test(String(q||'').trim());}
return {norm,terms,topics,matchRecord,makeGroups,occurrences,isDecisionNumberQuery};
});
