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

function run() {
  let changed = 0;
  for (const f of htmlFiles(ROOT)) {
    const before = fs.readFileSync(f, 'utf8');
    const after = applyJsonLd(applyLabels(before, f));
    if (after !== before) { fs.writeFileSync(f, after); changed++; }
  }
  const smPath = path.join(ROOT, 'sitemap.xml');
  const sm = fs.readFileSync(smPath, 'utf8');
  const sm2 = sm.replace(/<lastmod>[^<]*<\/lastmod>/g, `<lastmod>${reviewDate}</lastmod>`);
  if (sm2 !== sm) { fs.writeFileSync(smPath, sm2); changed++; }
  console.log(`review date ${reviewDate}: ${changed} file(s) updated`);
}

if (require.main === module) run();

module.exports = { LABEL_RE, MONTHS, LABEL_LANG, reviewDate, isLegalContext, htmlFiles, ROOT };
