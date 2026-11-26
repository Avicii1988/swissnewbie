// Shared click + language tracking for all pages (EN/DE/FR).
// - page_language: one Vercel Analytics event per page view with the page language
// - voucher_click: same triggers as the former inline snippet (data-voucher-id clicks,
//   incl. the copyCode path, and .vg-link clicks on cards without data-voucher-id),
//   enriched with lang, provider and offer
// - /api/voucher-notify: still called for external links, payload plus lang + provider
// - localStorage sn_voucher_clicks: daily per-code click counts, unchanged
(function(){
  var path=location.pathname;
  var lang=path.indexOf('/de/')===0?'de':path.indexOf('/fr/')===0?'fr':'en';

  // lowercase, accents and special characters removed, spaces to hyphens
  function normalize(s){
    if(!s)return '';
    s=String(s).toLowerCase();
    try{s=s.normalize('NFD').replace(/[̀-ͯ]/g,'');}catch(e){}
    return s.replace(/&/g,' ').replace(/[^a-z0-9\s-]/g,' ').trim().replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
  }
  // known providers, matched against card name + voucher id
  var PROVIDERS=[
    ['interactive-brokers',/interactive[\s-]*brokers|\bibkr\b/],['sunrise',/\bsunrise\b/],['swisscom',/\bswisscom\b/],
    ['salt',/\bsalt\b/],['wingo',/\bwingo\b/],['yallo',/\byallo\b/],['spusu',/\bspusu\b/],['lidl-connect',/\blidl[\s-]*connect\b/],
    ['swica',/\bswica\b/],['css',/\bcss\b/],['ubs',/\bubs\b/],['frankly',/\bfrankly\b/],['neon',/\bneon\b/],['yuh',/\byuh\b/],
    ['viac',/\bviac\b/],['wise',/\bwise\b/],['smile',/\bsmile\b/],['mobility',/\bmobility\b/],['manor',/\bmanor\b/]
  ];
  function cardOf(el){return el&&el.closest?el.closest('.vg-card,.dc-card,.voucher-strip'):null;}
  function txt(el){return el?el.textContent.replace(/\s+/g,' ').trim():'';}
  function cardName(card){return card?txt(card.querySelector('.vg-name,.vs-name,.dc-benefit')):'';}
  function providerOf(el){
    var card=cardOf(el),name=cardName(card);
    var id=el&&el.getAttribute?(el.getAttribute('data-voucher-id')||''):'';
    if(!id&&card){var v=card.querySelector('[data-voucher-id]');id=v?v.getAttribute('data-voucher-id'):'';}
    var hay=(name+' '+id).toLowerCase();
    for(var i=0;i<PROVIDERS.length;i++){if(PROVIDERS[i][1].test(hay))return PROVIDERS[i][0];}
    return normalize(name)||normalize(id);
  }
  // voucher code if the card has one, otherwise the offer text, '' if none
  function offerOf(el){
    var card=cardOf(el);if(!card)return '';
    var codeEls=card.querySelectorAll('[onclick*="copyCode"]');
    for(var i=0;i<codeEls.length;i++){var m=/copyCode\(\s*this\s*,\s*'([^']+)'/.exec(codeEls[i].getAttribute('onclick')||'');if(m)return m[1];}
    var c=card.querySelector('.vg-code,.vs-code');
    if(c){var t=txt(c);if(t&&t.indexOf('✓')!==0)return t.slice(0,100);}
    // dc-card: .dc-benefit is the offer, unless it is just the provider name (then .dc-condition)
    var ben=card.querySelector('.dc-benefit');
    if(ben){var b=txt(ben);return (normalize(b)===providerOf(el)?txt(card.querySelector('.dc-condition')):b).slice(0,100);}
    return txt(card.querySelector('.vg-reward,.vs-saving')).slice(0,100);
  }
  window.snTracking={lang:lang,providerOf:providerOf,offerOf:offerOf};

  try{window.va&&window.va('event',{name:'page_language',data:{lang:lang,page:path}});}catch(e){}

  // Pages that still carry their own inline voucher tracker (homepages) keep it;
  // registering a second listener there would double-count every click.
  var scripts=document.querySelectorAll('script:not([src])');
  for(var s=0;s<scripts.length;s++){
    var t=scripts[s].textContent;
    if(t.indexOf('sn_voucher_clicks')>-1&&t.indexOf("addEventListener('click'")>-1)return;
  }

  var KEY='sn_voucher_clicks';
  function getC(){try{return JSON.parse(localStorage.getItem(KEY)||'{}');}catch(e){return{};}}
  function slotOf(el){try{var c=el&&(el.closest?el.closest('[data-voucher-slot]'):null);if(!c){var card=el&&(el.closest?el.closest('.vg-card,.dc-card'):null);c=card?card.querySelector('[data-voucher-slot]'):null;}if(c)return c.getAttribute('data-voucher-slot');var all=[].slice.call(document.querySelectorAll('[data-voucher-id]'));var i=all.indexOf(el);if(i<0){var card2=el&&(el.closest?el.closest('.vg-card,.dc-card'):null);var idel=card2?card2.querySelector('[data-voucher-id]'):null;i=idel?all.indexOf(idel):-1;}if(i>=0)return 'idx:'+(i+1)+'/'+all.length;}catch(e){}return '';}
  function cssqIsExternal(href){if(!href)return false;try{var u=new URL(href,location.href);var h=u.hostname.replace(/^www\./,'');return h!=='swissnewbie.ch';}catch(e){return false;}}
  function notify(code,provider,slot){
    try{fetch('/api/voucher-notify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code,page:location.href,slot:slot,ts:new Date().toISOString(),ua:navigator.userAgent.slice(0,120),lang:lang,provider:provider})}).catch(function(){});}catch(er){}
  }
  function vaClick(code,provider,offer,slot){
    try{window.va&&window.va('event',{name:'voucher_click',data:{code:code,provider:provider,offer:offer,page:location.pathname,slot:slot,lang:lang}});}catch(e){}
  }
  document.addEventListener('click',function(e){
    var el=e.target.closest('[data-voucher-id]');
    if(!el){var lnk=e.target.closest('.vg-link,.vg-actions a,.vs-link,.vs-actions a');if(lnk){var card=lnk.closest('.vg-card,.voucher-strip');if(card){el=card.querySelector('[data-voucher-id]');if(!el){var nm=card.querySelector('.vg-name,.vs-name');if(nm){var fcode=nm.textContent.trim().replace(/\s+/g,'-').slice(0,20),fprov=providerOf(lnk);if(cssqIsExternal(lnk&&lnk.href))notify(fcode,fprov,slotOf(lnk));vaClick(fcode,fprov,offerOf(lnk),slotOf(lnk));return;}}}}}
    if(!el)return;
    var code=el.getAttribute('data-voucher-id'),today=new Date().toISOString().slice(0,10);
    var d=getC();if(!d[today])d[today]={};d[today][code]=(d[today][code]||0)+1;
    try{localStorage.setItem(KEY,JSON.stringify(d));}catch(e){}
    var provider=providerOf(el);
    var __h=(typeof lnk!=='undefined'&&lnk)?lnk.href:(el.tagName==='A'?el.href:null);if(cssqIsExternal(__h))notify(code,provider,slotOf(el));
    vaClick(code,provider,offerOf(el),slotOf(el));
  },true);
})();
