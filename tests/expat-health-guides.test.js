// Checks for the three expat health insurance guides (EN/DE/FR).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.swissnewbie.ch';
const GUIDES = {
  en: { path: '/health-insurance-expats-switzerland/', title: 'Health insurance for expats in Switzerland (2027)' },
  de: { path: '/de/krankenkasse-expats-schweiz/', title: 'Krankenkasse für Expats in der Schweiz (2027)' },
  fr: { path: '/fr/assurance-maladie-expats-suisse/', title: 'Assurance maladie pour expatriés en Suisse (2027)' },
};
const SOURCES = [
  'https://www.bag.admin.ch/de/krankenversicherung-versicherungspflicht-fuer-in-der-schweiz-wohnhafte-versicherte',
  'https://www.bag.admin.ch/de/praemien-und-kosten-antworten-auf-haeufige-fragen',
  'https://www.bag.admin.ch/dam/de/sd-web/92VbSMPCd--v/PG27-FB-Versichererwechsel_DE.pdf',
  'https://www.priminfo.admin.ch/de/zahlen-und-fakten/wechsel',
  'https://www.priminfo.admin.ch',
];
const read = (p) => fs.readFileSync(path.join(ROOT, p.slice(1), 'index.html'), 'utf8');
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

for (const [lang, g] of Object.entries(GUIDES)) {
  test(`expat guide ${lang}: title, h1, language, canonical`, () => {
    const html = read(g.path);
    assert.match(html, new RegExp(`<html lang="${lang}">`));
    assert.strictEqual(text(html.match(/<title>([\s\S]*?)<\/title>/)[1]), g.title);
    assert.strictEqual(text(html.match(/<h1>([\s\S]*?)<\/h1>/)[1]), g.title);
    assert.match(html, new RegExp(`<link rel="canonical" href="${BASE}${g.path}">`));
    const desc = html.match(/<meta name="description" content="([^"]+)">/)[1];
    assert.ok(desc.length >= 100 && desc.length <= 170, `description length ${desc.length}`);
  });

  test(`expat guide ${lang}: seven H2 questions with answers, FAQPage matches`, () => {
    const html = read(g.path);
    const visible = [...html.matchAll(/<div class="guide-section" id="q\d">\s*<h2>([\s\S]*?)<\/h2>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g)]
      .map((m) => [text(m[1]), text(m[2])]);
    assert.strictEqual(visible.length, 7);
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    const faq = ld['@graph'].find((n) => n['@type'] === 'FAQPage');
    const fromLd = faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]);
    assert.deepStrictEqual(fromLd, visible);
  });

  test(`expat guide ${lang}: sources, review date, no provider promotion`, () => {
    const html = read(g.path);
    const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
    for (const s of SOURCES) assert.ok(main.includes(`href="${s}"`), `source ${s}`);
    // review date comes from scripts/review-date.json (see tests/review-date.test.js)
    assert.match(main, /(Last reviewed|Zuletzt überprüft|Dernière vérification)[^<]*(November|novembre) 2026/);
    assert.doesNotMatch(html, /swica/i);
    assert.doesNotMatch(main, /data-voucher|vg-card|class="vg-|bonus/i);
    assert.doesNotMatch(main, /15\. Dezember|15 December|15 décembre/);
    // only franchise, retention cap and nothing else in CHF
    const chf = [...text(main).matchAll(/CHF ([\d',.]+)/g)].map((m) => m[1].replace(/[',]/g, ''));
    for (const v of chf) assert.ok(['300', '0', '700', '350'].includes(v), `unexpected CHF amount ${v}`);
  });
}
