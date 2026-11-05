// Regression tests for the Nov 2026 design package: unified footer, voucher
// navigation labels, SWICA price badge and homepage CTA classes.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Every content page listed in the sitemap (88 at the time of writing).
const PAGES = [...read('sitemap.xml').matchAll(/<loc>https:\/\/www\.swissnewbie\.ch\/([^<]*)<\/loc>/g)]
  .map((m) => (m[1] ? m[1] + 'index.html' : 'index.html'));
const langOf = (p) => (p.startsWith('de/') ? 'de' : p.startsWith('fr/') ? 'fr' : 'en');
const isHome = (p) => /^(de\/|fr\/)?index\.html$/.test(p);

const EXPECT = {
  en: { home: '/', q: '/?section=', vouchers: ['/vouchers/', '🏷️ Vouchers'],
    guides: ['/finance/', '/insurance/', '/health-insurance/', '/mobile-internet/', '/public-transport/', '/groceries/', '/guides/'] },
  de: { home: '/de/', q: '/de/?section=', vouchers: ['/de/vouchers/', '🏷️ Gutscheine'],
    guides: ['/de/finance/', '/de/insurance/', '/de/health-insurance/', '/de/mobile-internet/', '/de/public-transport/', '/de/groceries/', '/de/ratgeber/'] },
  fr: { home: '/fr/', q: '/fr/?section=', vouchers: ['/fr/vouchers/', '🏷️ Codes promo'],
    guides: ['/fr/finance/', '/fr/insurance/', '/fr/health-insurance/', '/fr/mobile-internet/', '/fr/public-transport/', '/fr/groceries/', '/fr/guides/'] },
};

const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const exists = (href) => {
  const p = href.split(/[?#]/)[0];
  return fs.existsSync(path.join(ROOT, p, 'index.html'));
};

test('sitemap lists the expected set of content pages', () => {
  assert.ok(PAGES.length >= 88, `only ${PAGES.length} sitemap pages`);
  for (const p of PAGES) assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} missing`);
});

for (const page of PAGES) {
  test(`footer is the shared structure: ${page}`, () => {
    const html = read(page);
    const lang = langOf(page);
    const e = EXPECT[lang];
    const footers = html.match(/<footer\b[\s\S]*?<\/footer>/g) || [];
    assert.strictEqual(footers.length, 1, 'exactly one <footer>');
    const f = footers[0];
    assert.match(f, /^<footer class="site-footer"/);
    assert.strictEqual((f.match(/class="footer-col"/g) || []).length, 2, 'brand + 2 link columns');
    assert.match(f, /class="footer-brand"/);
    assert.match(f, /class="footer-bottom"/);
    assert.match(f, new RegExp(`<a href="${e.home.replace(/\//g, '\\/')}" class="logo">`), 'logo links to the language homepage');
    const cols = f.split('class="footer-col"');
    assert.deepStrictEqual(hrefs(cols[1]), e.guides, 'guide column');
    const service = hrefs(cols[2].split('class="footer-bottom"')[0]);
    assert.deepStrictEqual(service, [e.vouchers[0], ...['community', 'contact', 'privacy'].map((s) => e.q + s),
      '/referral-policy/', e.q + 'disclaimer', e.q + 'terms'], 'service column');
    for (const h of hrefs(f)) assert.ok(exists(h), `${h} has no page`);
    if (!isHome(page)) assert.doesNotMatch(f, /openTopic|closeTopic|onclick/, 'no topic calls off the homepage');
    assert.doesNotMatch(f, /Last updated|Zuletzt aktualisiert|Letzte Aktualisierung|Dernière mise à jour|sn-footer-date/, 'no auto-dated "last updated" line');
    if (lang !== 'en') assert.doesNotMatch(f, /October|November|T&amp;C|All rights reserved/, 'no English labels');
    assert.doesNotMatch(f, /style="/, 'no inline styles in the footer');
    assert.match(html, /<script src="\/js\/footer\.js" defer><\/script>/);
  });

  test(`no script fakes a current-month date: ${page}`, () => {
    assert.doesNotMatch(read(page), /getElementById\('sn-footer-date'\)/);
  });

  test(`voucher navigation is named consistently: ${page}`, () => {
    const html = read(page);
    const [href, label] = EXPECT[langOf(page)].vouchers;
    for (const m of html.matchAll(/<a [^>]*class="[^"]*(?:nav-deals-btn|mnd-deals-btn|topic-topbar-deals)[^"]*"[^>]*>([^<]*)<\/a>/g)) {
      assert.match(m[0], new RegExp(`href="${href.replace(/\//g, '\\/')}"`), 'language voucher target');
      assert.strictEqual(m[1], label);
    }
  });
}

test('homepage topic-overlay footers use the shared structure', () => {
  for (const page of ['index.html', 'de/index.html', 'fr/index.html']) {
    const html = read(page);
    assert.strictEqual((html.match(/class="topic-footer-inner site-footer"/g) || []).length, 12, page);
    assert.doesNotMatch(html, /class="topic-footer-inner" style=/, page);
  }
});

test('SWICA price badge is Mid / Mittel / Moyen; other insurers unchanged', () => {
  const want = { 'health-insurance/index.html': 'Mid', 'de/health-insurance/index.html': 'Mittel',
    'fr/health-insurance/index.html': 'Moyen', 'index.html': 'Mid', 'de/index.html': 'Mid', 'fr/index.html': 'Mid' };
  for (const [page, label] of Object.entries(want)) {
    const html = read(page);
    const row = html.match(/<div class="pt-name">SWICA ⭐<\/div><\/td><td[^>]*>[^<]*<\/td><td[^>]*><span class="pt-badge ([a-z]+)">([^<]*)<\/span>/);
    assert.ok(row, `SWICA row in ${page}`);
    assert.deepStrictEqual([row[1], row[2]], ['blue', label], page);
    assert.doesNotMatch(html, /Mid-high|Mittel-hoch|Moyen-élevé/, page);
    assert.match(html, /<div class="pt-name">Assura<\/div><\/td><td[^>]*>[^<]*<\/td><td[^>]*><span class="pt-badge green">/, `Assura unchanged in ${page}`);
  }
});

test('homepage hero: voucher link is primary, checklist is secondary', () => {
  for (const [page, href] of [['index.html', '/vouchers/'], ['de/index.html', '/de/vouchers/'], ['fr/index.html', '/fr/vouchers/']]) {
    const ctas = read(page).match(/<div class="hero-ctas">([\s\S]*?)<\/div>/)[1];
    assert.match(ctas, new RegExp(`<a href="${href.replace(/\//g, '\\/')}" class="hero-cta"`), page);
    assert.match(ctas, /<a href="#" class="hero-cta-sec"[^>]*onclick="document\.getElementById\('checklist-start'\)/, page);
  }
});

test('voucher card fine print has a readable colour rule everywhere', () => {
  for (const f of ['style.css', 'index.html', 'de/index.html', 'fr/index.html']) {
    assert.match(read(f), /\.vg-card \.vg-reward-note\{font-size:0\.8125rem;line-height:1\.5;color:rgba\(247,245,240,0\.88\)/, f);
  }
});

test('SWICA no. 1 note on the switch pages keeps source and year', () => {
  for (const page of ['health-insurance-switch/index.html', 'de/health-insurance-switch/index.html', 'fr/health-insurance-switch/index.html']) {
    const html = read(page);
    const note = html.match(/<div class="vg-reward-note vg-award-note">([\s\S]*?)<\/div>/);
    assert.ok(note, page);
    assert.match(note[1], /<strong>/);
    assert.match(note[1], /comparis\.ch\/krankenkassen\/beste-krankenkasse/);
    assert.match(note[1], /2026/);
  }
});

test('Google verification file stays a bare verification file', () => {
  const v = read('googleb6ec3009929acab9.html');
  assert.doesNotMatch(v, /<footer|footer\.js/);
});
