#!/usr/bin/env node
/**
 * Single source for the site's "last reviewed" date: scripts/review-date.json.
 *
 * Writes that date into the static HTML (so it is in the delivered page, not set by
 * client-side JS) and into sitemap.xml:
 *   - visible review/update labels ("Last reviewed: …", "Zuletzt überprüft: …",
 *     "Dernière vérification : …", hero badges "Updated …" etc.): month + year,
 *     in the language of the label
 *   - JSON-LD "dateModified" (added to the page's WebPage/FAQPage/Article node if missing)
 *   - every <lastmod> in sitemap.xml
 * "datePublished" is never touched. Version dates of legal texts (privacy policy,
 * referral policy) are left alone on purpose.
 *
 * Usage: edit scripts/review-date.json, then run  node scripts/apply-review-date.js
 * tests/review-date.test.js fails if any page drifts from the constant.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { reviewDate } = JSON.parse(fs.readFileSync(path.join(__dirname, 'review-date.json'), 'utf8'));
if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) throw new Error('reviewDate must be YYYY-MM-DD');
const [Y, M] = reviewDate.split('-').map(Number);

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
};
const ALL_MONTHS = [...new Set([].concat(...Object.values(MONTHS)))].join('|');
// label -> language of the month name that follows it
const LABELS = [
  ['Last reviewed', 'en'], ['Last updated', 'en'], ['Updated', 'en'],
  ['Zuletzt überprüft', 'de'], ['Zuletzt geprüft', 'de'], ['Aktualisiert', 'de'],
  ['Dernière vérification', 'fr'], ['Dernière révision', 'fr'], ['Mis à jour', 'fr'],
];
const LABEL_LANG = Object.fromEntries(LABELS);
// label, separator (":", spaces, an opening <strong>/<span>), optional day, month, year
const LABEL_RE = new RegExp(`(${LABELS.map(([l]) => l).join('|')})((?:\\s|:|&nbsp;|<(?:strong|span)[^>]{0,40}>){1,4})(?:\\d{1,2}\\.?\\s)?(${ALL_MONTHS})(\\s)(20\\d\\d)`, 'g');
// version dates of legal texts stay untouched: privacy, terms and disclaimer sections
// of the homepages (id="topic-privacy|terms|disclaimer") and the GDPR/DSG notice
const LEGAL_TOPICS = ['privacy', 'terms', 'disclaimer'];
function isLegalContext(s, idx) {
  if (/GDPR|DSG|RGPD|Affiliate Policy/i.test(s.slice(Math.max(0, idx - 160), idx))) return true;
  const topics = [...s.slice(0, idx).matchAll(/id="topic-([a-z-]+)"/g)];
  return topics.length > 0 && LEGAL_TOPICS.includes(topics[topics.length - 1][1]);
}

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', 'tests', 'api', 'scripts', 'assets', 'logos', 'js'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name === 'index.html') out.push(p);
  }
  return out;
}

function applyLabels(s, file) {
  if (/referral-policy/.test(file)) return s;
  return s.replace(LABEL_RE, (m, label, sep, _month, sp, _year, offset) => {
    if (isLegalContext(s, offset)) return m;
    return label + sep + MONTHS[LABEL_LANG[label]][M - 1] + sp + Y;
  });
}

function applyJsonLd(s) {
  return s.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (all, open, body, close) => {
    let b = body.replace(/("dateModified":\s*")[^"]*(")/g, `$1${reviewDate}$2`);
    if (!/"dateModified"/.test(b)) {
      // add to the page node: Article, else WebPage, else FAQPage
      for (const t of ['Article', 'WebPage', 'FAQPage']) {
        const re = new RegExp(`(\\n?([ \\t]*)"@type":\\s*"${t}",)`);
        const m = b.match(re);
        if (m) { b = b.replace(re, `$1\n${m[2]}"dateModified": "${reviewDate}",`); break; }
      }
    }
    JSON.parse(b); // never write invalid JSON-LD
    return open + b + close;
  });
}

// Hub/overview pages: every language shows the review line in the author box used on
// the EN topic hubs (inserted once if missing, then kept current by applyLabels).
const HUBS = [
  ['insurance', 'de/insurance', 'fr/insurance'], ['finance', 'de/finance', 'fr/finance'],
  ['mobile-internet', 'de/mobile-internet', 'fr/mobile-internet'], ['health-insurance', 'de/health-insurance', 'fr/health-insurance'],
  ['public-transport', 'de/public-transport', 'fr/public-transport'], ['groceries', 'de/groceries', 'fr/groceries'],
  ['vouchers', 'de/vouchers', 'fr/vouchers'], ['moving-to-switzerland', 'de/umzug-schweiz', 'fr/sinstaller-en-suisse'],
  ['living-in-switzerland', 'de/leben-in-der-schweiz', 'fr/vivre-en-suisse'], ['guides', 'de/ratgeber', 'fr/guides'],
];
const HUB_PAGES = HUBS.flat();
const AUTHOR = {
  en: ['Swiss Relocation Specialist · SwissNewbie', 'Last reviewed', 'Based on official Swiss sources'],
  de: ['Schweizer Relocation-Spezialistin · SwissNewbie', 'Zuletzt überprüft', 'Basierend auf offiziellen Schweizer Quellen'],
  fr: ['Spécialiste en relocation · SwissNewbie', 'Dernière vérification', 'Basé sur des sources officielles suisses'],
};
// identical to the rules on the EN topic hubs
const AUTHOR_CSS = '<style>.author-box{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin:0 auto 32px;max-width:860px;}@media(max-width:767px){.author-box{margin-left:4vw;margin-right:4vw;}}'
  + '.author-avatar{width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid var(--border);}.author-meta{display:flex;flex-direction:column;gap:2px;}'
  + '.author-name{font-weight:600;font-size:0.85rem;color:var(--ink);}.author-role{font-size:0.75rem;color:var(--muted);}'
  + '.author-reviewed{font-size:0.72rem;color:var(--muted);margin-top:3px;}.author-reviewed strong{color:var(--ink);}</style>\n';
const pageOf = (file) => path.relative(ROOT, path.dirname(file)).split(path.sep).join('/');
const langOf = (page) => (page.startsWith('de/') ? 'de' : page.startsWith('fr/') ? 'fr' : 'en');
const visibleLabels = (s) => [...s.matchAll(new RegExp(LABEL_RE.source, 'g'))].filter((m) => !isLegalContext(s, m.index));

function ensureHubLabel(s, file) {
  const page = pageOf(file);
  if (!HUB_PAGES.includes(page) || visibleLabels(s).length) return s;
  const lang = langOf(page);
  const [role, label, basis] = AUTHOR[lang];
  const sep = lang === 'fr' ? ' : ' : ': ';
  const box = '<div class="author-box">\n'
    + '  <svg class="author-avatar" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="24" fill="#e8e4de"/><text x="24" y="30" text-anchor="middle" font-size="16" font-weight="600" fill="#5a5550" font-family="system-ui,sans-serif">LK</text></svg>\n'
    + '  <div class="author-meta">\n    <div class="author-name">Lena Keller</div>\n'
    + `    <div class="author-role">${role}</div>\n`
    + `    <div class="author-reviewed">✓ ${label}${sep}<strong>${MONTHS[lang][M - 1]} ${Y}</strong> · ${basis}</div>\n`
    + '  </div>\n</div>\n';
  const hero = Math.max(s.indexOf('class="topic-hero"'), s.indexOf('class="hub-hero"'));
  const anchors = ['<div class="topic-body"', '<div class="hub-section"'].map((a) => s.indexOf(a, hero)).filter((i) => i > 0);
  if (hero < 0 || !anchors.length) throw new Error(`no insertion point for the review label: ${page}`);
  const at = Math.min(...anchors);
  let out = s.slice(0, at) + box + s.slice(at);
  if (!/\.author-box\{/.test(out)) out = out.replace('</head>', AUTHOR_CSS + '</head>');
  return out;
}

function run() {
  let changed = 0;
  for (const f of htmlFiles(ROOT)) {
    const before = fs.readFileSync(f, 'utf8');
    const after = applyJsonLd(applyLabels(ensureHubLabel(before, f), f));
    if (after !== before) { fs.writeFileSync(f, after); changed++; }
  }
  const smPath = path.join(ROOT, 'sitemap.xml');
  const sm = fs.readFileSync(smPath, 'utf8');
  const sm2 = sm.replace(/<lastmod>[^<]*<\/lastmod>/g, `<lastmod>${reviewDate}</lastmod>`);
  if (sm2 !== sm) { fs.writeFileSync(smPath, sm2); changed++; }
  console.log(`review date ${reviewDate}: ${changed} file(s) updated`);
}

if (require.main === module) run();

module.exports = { LABEL_RE, MONTHS, LABEL_LANG, reviewDate, isLegalContext, htmlFiles, ROOT, HUB_PAGES, visibleLabels };
