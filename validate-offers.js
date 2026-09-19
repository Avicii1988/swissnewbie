#!/usr/bin/env node
/**
 * Offer validation script for SwissNewbie
 *
 * Rules enforced:
 * 1. Numeric benefit requires benefitSourceUrl + benefitVerifiedAsOf
 * 2. Commercial offer requires disclosure text in all locales (stored in offers.json;
 *    rendered globally in footer + /referral-policy/ — NOT required per card)
 * 3. Stale or disabled offers must not have active CTA in HTML
 * 4. CHF 4,000+ family savings claim must have a maintained basketItems calculation
 *    in offers.json.familySavingsBasket with a calculatedDate within 365 days
 * 5. Global footer disclosure must be present in all locale pages
 *
 * Usage: node validate-offers.js [--html]
 *   --html  also scan HTML files for stale claims and missing footer disclosure
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

// Rule: familySavingsBasket must exist and be recent
const basket = data.familySavingsBasket;
if (!basket) {
  err('offers.json missing familySavingsBasket — CHF 4,000+ family claim has no documented calculation');
} else {
  if (!basket.basketItems || basket.basketItems.length === 0) {
    err('familySavingsBasket.basketItems is empty — calculation is undocumented');
  }
  if (!basket.calculatedDate) {
    err('familySavingsBasket.calculatedDate is missing');
  } else {
    const calcDate = new Date(basket.calculatedDate);
    const ageMs = Date.now() - calcDate.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > 365) {
      warn(`familySavingsBasket.calculatedDate is ${Math.round(ageDays)} days old — review the CHF 4,000+ family basket calculation`);
    }
  }
  if (!basket._twoYearTotal) {
    warn('familySavingsBasket._twoYearTotal missing — add the two-year figure that supports the headline');
  }
}

// Rule: globalDisclosurePolicy must be present with text in all locales
const gdp = data.globalDisclosurePolicy;
if (!gdp) {
  err('offers.json missing globalDisclosurePolicy');
} else {
  for (const locale of LOCALES) {
    if (!gdp.text?.[locale]) {
      err(`globalDisclosurePolicy.text.${locale} is missing`);
    }
  }
}

// Validate each offer
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

  // Rule 2: commercial offer must have disclosure text stored (for footer rendering)
  if (COMMERCIAL_RELATIONSHIPS.includes(offer.commercialRelationship)) {
    if (!offer.disclosure) {
      err(`[${id}] commercialRelationship=${offer.commercialRelationship} but no disclosure object (needed for footer/policy rendering)`);
    } else {
      for (const locale of LOCALES) {
        if (!offer.disclosure[locale]) {
          err(`[${id}] missing disclosure.${locale}`);
        }
      }
    }
  }

  // Rule 3: stale/disabled offer must not be rendered with an active CTA
  if (offer.claimStatus === 'stale' || offer.claimStatus === 'disabled') {
    err(`[${id}] claimStatus=${offer.claimStatus} — remove from all active placements before shipping`);
  }

  // Warnings
  if (!offer.lastReviewed) {
    warn(`[${id}] missing lastReviewed date`);
  }
  if (!offer.analyticsOfferId) {
    warn(`[${id}] missing analyticsOfferId`);
  }
}

// --- Scan HTML files ---
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
    { pattern: /\/private\/recommendation\.html/i, description: 'Old UBS URL (should be /services/private/recommend.html)' },
  ];

  // Footer global disclosure check: every page must contain referral-policy link
  // (proxy for the global disclosure being present)
  const FOOTER_DISCLOSURE_PROXY = /referral-policy/;

  function scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const rel = path.relative(__dirname, filePath);

    // Stale claims
    for (const { pattern, description } of STALE_PATTERNS) {
      if (pattern.test(content)) {
        err(`[HTML:${rel}] ${description}`);
      }
    }

    // Global footer disclosure: referral-policy link must be present
    if (!FOOTER_DISCLOSURE_PROXY.test(content)) {
      // Only check pages that have commercial links
      const hasCommercial = /aklam\.io|wise\.com\/invite|ibkr\.com\/referral|frankly\.ch|app\.smile|swica\.ch|onelink\.to\/neon|services\/private\/recommend|mobility\.ch/.test(content);
      if (hasCommercial) {
        warn(`[HTML:${rel}] has commercial links but no referral-policy footer link (global disclosure proxy)`);
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
