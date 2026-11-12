// hreflang / canonical consistency: the sitemap and every page's <head> must
// carry the same complete, reciprocal set of language alternates.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.swissnewbie.ch';
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');

const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
  loc: m[1].match(/<loc>([^<]+)<\/loc>/)[1],
  alts: Object.fromEntries([...m[1].matchAll(/hreflang="([^"]+)"\s+href="([^"]+)"/g)].map((x) => [x[1], x[2]])),
}));
const byLoc = Object.fromEntries(entries.map((e) => [e.loc, e]));
const fileFor = (url) => {
  const p = url.replace(BASE, '');
  return path.join(ROOT, p === '/' ? '' : p.slice(1), 'index.html');
};
const head = (url) => {
  const s = fs.readFileSync(fileFor(url), 'utf8');
  return s.slice(0, s.indexOf('<body') > 0 ? s.indexOf('<body') : 20000);
};

for (const e of entries) {
  test(`hreflang set is complete and reciprocal: ${e.loc}`, () => {
    assert.ok(e.alts.en, 'sitemap entry has an en alternate');
    assert.strictEqual(e.alts['x-default'], e.alts.en, 'x-default is the English page');
    assert.ok(Object.values(e.alts).includes(e.loc), 'the page lists itself');
    for (const href of Object.values(e.alts)) {
      assert.ok(href.endsWith('/'), `${href} keeps the trailing slash`);
      assert.ok(byLoc[href], `${href} is in the sitemap`);
      assert.deepStrictEqual(byLoc[href].alts, e.alts, `${href} carries the same set`);
    }
    const h = head(e.loc);
    assert.strictEqual((h.match(/<link rel="canonical" href="([^"]+)">/) || [])[1], e.loc, 'self-canonical');
    const htmlAlts = Object.fromEntries([...h.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((x) => [x[1], x[2]]));
    assert.deepStrictEqual(htmlAlts, e.alts, 'page <head> matches the sitemap');
  });
}
