#!/usr/bin/env node
/**
 * Offer validation script for SwissNewbie
 *
 * Rules enforced:
 * 1. Numeric benefit requires benefitSourceUrl + benefitVerifiedAsOf
 * 2. Commercial offer (referral/affiliate/lead) requires disclosure text in all locales
 * 3. Stale or disabled offers must not have active CTA in HTML
 * 4. Every HTML offer card must have adjacent disclosure text
 *
 * Usage: node validate-offers.js [--html]
 *   --html  also scan HTML files for claim mismatches
 */

const fs = require('fs');
const path = require('path');

const OFFERS_FILE = path.join(__dirname, 'offers.json');
const LOCALES = ['en', 'de', 'fr'];
const NUMERIC_BENEFIT_TYPES = ['cash_bonus', 'cash_credit', 'fee_waiver', 'shares', 'points', 'points_cash_value', 'driving_credit'];
const COMMERCIAL_RELATIONSHIPS = ['referral', 'affiliate', 'lead'];

let errors = [];
let warnings = [];

function err(msg) { errors.push(`ERROR: ${msg}`); }
function warn(msg) { warnings.push(`WARN:  ${msg}`); }

// --- Validate offers.json ---
const raw = fs.readFileSync(OFFERS_FILE, 'utf8');
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  err(`offers.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

for (const offer of data.offers) {
  const id = offer.id || '(missing id)';

  // Rule 1: numeric benefit requires source URL + verified date
  if (NUMERIC_BENEFIT_TYPES.includes(offer.benefitType)) {
    if (!offer.benefitSourceUrl) {
      if (offer.claimStatus === 'verified' || offer.claimStatus === 'conditional') {
        err(`[${id}] benefitType=${offer.benefitType} but benefitSourceUrl is missing`);
      } else {
        warn(`[${id}] benefitType=${offer.benefitType} but benefitSourceUrl is missing (claimStatus=${offer.claimStatus})`);
      }
    }
    if (!offer.benefitVerifiedAsOf) {
      if (offer.claimStatus === 'verified' || offer.claimStatus === 'conditional') {
        err(`[${id}] benefitType=${offer.benefitType} but benefitVerifiedAsOf is missing`);
      } else {
        warn(`[${id}] benefitType=${offer.benefitType} but benefitVerifiedAsOf is missing (claimStatus=${offer.claimStatus})`);
      }
    }
  }

  // Rule 2: commercial offer requires disclosure text in all locales
  if (COMMERCIAL_RELATIONSHIPS.includes(offer.commercialRelationship)) {
    if (!offer.disclosure) {
      err(`[${id}] commercialRelationship=${offer.commercialRelationship} but no disclosure object`);
    } else {
      for (const locale of LOCALES) {
        if (!offer.disclosure[locale]) {
          err(`[${id}] missing disclosure.${locale}`);
        }
      }
    }
  }

  // Rule 3: stale/disabled offer must not have active CTA (check claimStatus)
  if (offer.claimStatus === 'stale' || offer.claimStatus === 'disabled') {
    err(`[${id}] claimStatus=${offer.claimStatus} — this offer must be removed from all active placements before shipping`);
  }

  // Rule 4: CTA text required
  if (LOCALES.some(l => !offer.ctaText?.[l])) {
    warn(`[${id}] missing ctaText for some locales`);
  }

  // Rule 5: lastReviewed required
  if (!offer.lastReviewed) {
    warn(`[${id}] missing lastReviewed date`);
  }

  // Rule 6: analyticsOfferId required
  if (!offer.analyticsOfferId) {
    warn(`[${id}] missing analyticsOfferId`);
  }
}

// --- Scan HTML files for known stale claims ---
const scanHtml = process.argv.includes('--html');
if (scanHtml) {
  const STALE_PATTERNS = [
    { pattern: /you and I both get CHF 10/i, description: 'Stale neon "you and I both get CHF 10" claim' },
    { pattern: /CHF 10 bonus for you/i, description: 'Stale neon CHF 10 claim (offer model ended 15 Jan 2024)' },
    { pattern: /Free transfer up to CHF 600/i, description: 'Stale Wise CHF 600 transfer claim' },
    { pattern: /Best deal for expats via SwissNewbie/i, description: 'Unsupported SWICA exclusivity claim' },
    { pattern: /Up to CHF 20 welcome credit/i, description: 'Unverified visitor CHF 20 Mobility claim' },
    { pattern: /swissnewbie\.com\/living-in-swiss\//i, description: 'Broken external URL (swissnewbie.com)' },
    { pattern: /No long-term contract required/i, description: 'Blanket yallo contract claim — needs plan-specific qualifier' },
    { pattern: /recommendation\.html/i, description: 'Old UBS URL (should be /services/private/recommend.html)' },
    { pattern: /save up to CHF 4,000/i, description: 'CHF 4,000 savings claim — check basket evidence in community-stats.js' },
  ];

  const DISCLOSURE_REQUIRED_PATTERNS = [
    /vg-link.*?href="https?:\/\/(aklam\.io|wise\.com\/invite|ibkr\.com\/referral|frankly\.ch|app\.smile|swica\.ch|onelink\.to\/neon|ubs\.com.*recommend|mobility\.ch)/i
  ];

  function scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const { pattern, description } of STALE_PATTERNS) {
      if (pattern.test(content)) {
        err(`[HTML:${path.relative(__dirname, filePath)}] ${description}`);
      }
    }
    // Check every commercial CTA has adjacent disclosure
    const cardBlocks = content.match(/<div class="vg-card"[^]*?<\/div>\s*<\/div>\s*<\/div>/gm) || [];
    for (const card of cardBlocks) {
      const hasCommercialLink = /href="https?:\/\/(aklam\.io|wise\.com\/invite|ibkr\.com\/referral|frankly\.ch|app\.smile|swica\.ch|onelink\.to\/neon|ubs\.com.*recommend|mobility\.ch)/.test(card);
      if (hasCommercialLink && !/Referral link|Empfehlungslink|Lien de parrainage|sn-disclosure/.test(card)) {
        warn(`[HTML:${path.relative(__dirname, filePath)}] commercial CTA card without adjacent disclosure text`);
      }
    }
  }

  function walkHtml(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walkHtml(path.join(dir, entry.name));
      } else if (entry.name === 'index.html') {
        scanFile(path.join(dir, entry.name));
      }
    }
  }
  walkHtml(__dirname);
}

// --- Report ---
const allMessages = [...errors, ...warnings];
if (allMessages.length === 0) {
  console.log('✅ offer validation passed — no errors or warnings');
} else {
  for (const m of allMessages) console.log(m);
  console.log('');
  console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
}

process.exit(errors.length > 0 ? 1 : 0);
