// DE pilot "Krankenkassenprämien 2027": overview + 5 canton pages.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OV = '/de/krankenkassen-praemien-2027/';
const CANTONS = ['zuerich', 'genf', 'waadt', 'basel-stadt', 'bern'];
const PAGES = [OV, ...CANTONS.map((c) => `${OV}${c}/`)];
const ALLOWED_EXT = new Set([
  'https://www.bag.admin.ch/de/praemien-und-kosten-antworten-auf-haeufige-fragen',
  'https://www.bag.admin.ch/dam/de/sd-web/J6IJ1GWn3TP9/kantonale%20monatliche%20mittlere%20Pr%C3%A4mie%20pro%20Altersklasse_PG2027.pdf',
  'https://www.priminfo.admin.ch/de/praemien',
  'https://www.priminfo.admin.ch/de/versicherungen/verbilligung',
  'https://www.priminfo.admin.ch/de/downloads/aktuell',
]);
const read = (p) => fs.readFileSync(path.join(ROOT, p.slice(1), 'index.html'), 'utf8');
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const mainOf = (h) => h.slice(h.indexOf('<main>'), h.indexOf('</main>'));
const SWICA_CARD = (() => {
  const s = read('/de/health-insurance/');
  return s.match(/<div class="vg-card"><div class="vg-top">(?:(?!<div class="vg-card">)[\s\S])*?data-voucher-slot="inline-mid"[\s\S]*?<div class="vg-disclosure">Anzeige<\/div><\/div>/)[0];
})();

for (const p of PAGES) {
  test(`${p}: DE, self-canonical, EN/FR alternates, only allowed external links`, () => {
    const h = read(p);
    assert.match(h, /<html lang="de">/);
    assert.match(h, new RegExp(`<link rel="canonical" href="https://www.swissnewbie.ch${p.replace(/\//g, '\\/')}">`));
    assert.deepStrictEqual([...h.matchAll(/hreflang="([^"]+)"/g)].map((m) => m[1]), ['en', 'de', 'fr', 'x-default']);
    assert.doesNotMatch(h, /sunrise|ibkr|interactive brokers|aklam/i);
    const body = h.slice(h.indexOf('<body'));
    for (const m of body.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
      const u = m[1];
      if (u.startsWith('https://www.swissnewbie.ch')) continue;
      assert.ok(ALLOWED_EXT.has(u) || u === 'https://www.swica.ch/swissnewbie', `external link ${u}`);
    }
    for (const m of mainOf(h).matchAll(/<a href="(https?:\/\/[^"]+)"([^>]*)>/g)) assert.match(m[2], /target="_blank"/, m[1]);
  });

  test(`${p}: FAQPage JSON-LD mirrors the visible FAQ, no other schema`, () => {
    const h = read(p);
    const lds = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.strictEqual(lds.length, 1);
    assert.strictEqual(lds[0]['@type'], 'FAQPage');
    const visible = [...h.matchAll(/<div class="faq-q"[^>]*>([\s\S]*?) <span class="faq-chevron">▾<\/span><\/div>\s*<div class="faq-a"><p>([\s\S]*?)<\/p><\/div>/g)].map((m) => [text(m[1]), text(m[2])]);
    assert.deepStrictEqual(lds[0].mainEntity.map((q) => [q.name, q.acceptedAnswer.text]), visible);
    assert.strictEqual(visible.length, p === OV ? 3 : 5);
  });

  test(`${p}: every premium table carries the rounding/source note`, () => {
    const m = mainOf(read(p));
    const tables = (m.match(/<table/g) || []).length;
    assert.ok(tables >= 1);
    assert.strictEqual((m.match(/Alle Zahlen gerundet\. Quelle:/g) || []).length, tables);
  });
}

test('overview links to all canton pages and the DE health insurance guide, no affiliate card', () => {
  const m = mainOf(read(OV));
  for (const c of CANTONS) assert.ok(m.includes(`href="${OV}${c}/"`), c);
  assert.ok(m.includes('href="/de/health-insurance/"'));
  assert.doesNotMatch(m, /vg-card|data-voucher|swica/i);
  for (const [k, v, d] of [['zuerich', '477', '5.7'], ['genf', '611', '4.3'], ['waadt', '544', '3.2'], ['basel-stadt', '571', '4.5'], ['bern', '494', '5.0']]) {
    assert.ok(m.includes(`<a href="${OV}${k}/">CHF ${v}</a>`) && m.includes(`+${d} %`), k);
  }
  assert.match(m, /CHF 488<\/td><td data-label="Veränderung">\+4\.9 %/);
  assert.doesNotMatch(m, /CHF \d+\.\d/, 'whole francs only');
});

for (const c of CANTONS) {
  test(`${c}: exactly one unchanged SWICA card after "Fristen", link to overview`, () => {
    const m = mainOf(read(`${OV}${c}/`));
    assert.strictEqual(m.split(SWICA_CARD).length - 1, 1, 'identical SWICA card exactly once');
    assert.strictEqual((m.match(/swica\.ch\/swissnewbie/g) || []).length, 1);
    const fr = m.indexOf('id="fristen"'), card = m.indexOf(SWICA_CARD), cmp = m.indexOf('id="vergleichen"');
    assert.ok(fr > 0 && fr < card && card < cmp, 'card between Fristen and Prämien vergleichen');
    assert.ok(m.includes(`href="${OV}"`));
  });
}

test('existing DE health insurance guide links to the overview', () => {
  assert.ok(read('/de/health-insurance/').includes(`href="${OV}"`));
});

// EN/FR versions (Nov 2026): same pages, same figures, only the language changes.
const LANG_PAGES = {
  en: { ov: '/health-insurance-premiums-2027/', cantons: ['zurich', 'geneva', 'vaud', 'basel-city', 'bern'], hi: '/health-insurance/', ad: 'Ad' },
  fr: { ov: '/fr/primes-maladie-2027/', cantons: ['zurich', 'geneve', 'vaud', 'bale-ville', 'berne'], hi: '/fr/health-insurance/', ad: 'Annonce' },
};
const numbers = (h) => {
  const m = mainOf(h).replace(/<div class="vg-card">[\s\S]*?<div class="vg-disclosure">[^<]*<\/div><\/div>/g, '');
  return (text(m).match(/\d+(?:\.\d+)?/g) || []).sort();
};
for (const [lang, cfg] of Object.entries(LANG_PAGES)) {
  const card = (() => {
    const s = read(cfg.hi);
    return s.match(new RegExp(`<div class="vg-card"><div class="vg-top">(?:(?!<div class="vg-card">)[\\s\\S])*?data-voucher-slot="inline-mid"[\\s\\S]*?<div class="vg-disclosure">${cfg.ad}<\\/div><\\/div>`))[0];
  })();
  const list = [[cfg.ov, OV], ...cfg.cantons.map((c, i) => [`${cfg.ov}${c}/`, `${OV}${CANTONS[i]}/`])];
  for (const [p, de] of list) {
    test(`${p}: ${lang}, self-canonical, full hreflang set, title with 2027, only allowed external links`, () => {
      const h = read(p);
      assert.match(h, new RegExp(`<html lang="${lang}">`));
      assert.match(h, new RegExp(`<link rel="canonical" href="https://www.swissnewbie.ch${p.replace(/\//g, '\\/')}">`));
      assert.match(h, /<title>[^<]*2027[^<]*<\/title>/);
      if (lang === 'en') assert.match(h, /<title>[^<]*for Expats<\/title>/);
      assert.ok(h.includes(`hreflang="de" href="https://www.swissnewbie.ch${de}"`), 'links the DE original');
      const body = h.slice(h.indexOf('<body'));
      for (const m of body.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
        const u = m[1];
        if (u.startsWith('https://www.swissnewbie.ch')) continue;
        assert.ok(ALLOWED_EXT.has(u) || u === 'https://www.swica.ch/swissnewbie', `external link ${u}`);
      }
      assert.doesNotMatch(mainOf(h), /href="\/de\//, 'no links back into the German pages from the content');
    });
    test(`${p}: same figures as ${de}; FAQPage mirrors the visible FAQ`, () => {
      const h = read(p);
      assert.deepStrictEqual(numbers(h), numbers(read(de)));
      const ld = JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      assert.strictEqual(ld['@type'], 'FAQPage');
      const visible = [...h.matchAll(/<div class="faq-q"[^>]*>([\s\S]*?) <span class="faq-chevron">▾<\/span><\/div>\s*<div class="faq-a"><p>([\s\S]*?)<\/p><\/div>/g)].map((m) => [text(m[1]), text(m[2])]);
      assert.deepStrictEqual(ld.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]), visible);
      assert.match(mainOf(h), lang === 'en' ? /All figures rounded\. Source:/ : /Tous les chiffres sont arrondis\. Source :/);
      if (p !== cfg.ov) assert.strictEqual(mainOf(h).split(card).length - 1, 1, 'SWICA card in the page language exactly once');
      if (lang === 'fr') assert.doesNotMatch(text(mainOf(h)), /\b(tu|ton|ta|tes|toi)\b/, 'FR uses vous');
    });
  }
}
