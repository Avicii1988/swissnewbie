// Every review/update date on the site comes from scripts/review-date.json
// (written into the static HTML by scripts/apply-review-date.js).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LABEL_RE, MONTHS, LABEL_LANG, reviewDate, isLegalContext, htmlFiles, ROOT } = require('../scripts/apply-review-date.js');
const [Y, M] = reviewDate.split('-').map(Number);
const pages = htmlFiles(ROOT);
const rel = (f) => path.relative(ROOT, f);

test('the central constant is a valid date and has been applied (script is idempotent)', () => {
  assert.match(reviewDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(reviewDate)));
  assert.ok(pages.length > 100);
});

test('visible review/update labels show the constant month in the label language', () => {
  const wrong = [];
  for (const f of pages) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(new RegExp(LABEL_RE.source, 'g'))) {
      if (/referral-policy/.test(f) || isLegalContext(s, m.index)) continue;
      const shown = m[0].replace(/<[^>]+>/g, '');
      const want = `${MONTHS[LABEL_LANG[m[1]]][M - 1]} ${Y}`;
      if (!shown.endsWith(want) || /\d{1,2}\.?\s\D+\s\d{4}$/.test(shown)) wrong.push(`${rel(f)}: ${shown}`);
    }
  }
  assert.deepStrictEqual(wrong, []);
});

test('JSON-LD dateModified equals the constant on every page that has JSON-LD; datePublished untouched', () => {
  const wrong = [];
  for (const f of pages) {
    const s = fs.readFileSync(f, 'utf8');
    const blocks = [...s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((b) => b[1]);
    if (!blocks.length) continue;
    const vals = blocks.flatMap((b) => [...b.matchAll(/"dateModified":\s*"([^"]*)"/g)].map((x) => x[1]));
    if (!vals.length) wrong.push(`${rel(f)}: missing dateModified`);
    for (const v of vals) if (v !== reviewDate) wrong.push(`${rel(f)}: ${v}`);
    for (const b of blocks) JSON.parse(b);
  }
  assert.deepStrictEqual(wrong, []);
});

test('sitemap lastmod equals the constant for every URL', () => {
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const urls = (sm.match(/<url>/g) || []).length;
  const lastmods = [...sm.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map((m) => m[1]);
  assert.strictEqual(lastmods.length, urls, 'one lastmod per URL');
  assert.deepStrictEqual([...new Set(lastmods)], [reviewDate]);
});

test('every hub/overview page shows exactly one review label, in all three languages', () => {
  const { HUB_PAGES, visibleLabels } = require('../scripts/apply-review-date.js');
  const wrong = [];
  for (const p of HUB_PAGES) {
    const n = visibleLabels(fs.readFileSync(path.join(ROOT, p, 'index.html'), 'utf8')).length;
    if (n !== 1) wrong.push(`${p}: ${n}`);
  }
  assert.strictEqual(HUB_PAGES.length, 30);
  assert.deepStrictEqual(wrong, []);
});
