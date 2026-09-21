# Content Review — SwissNewbie Expansion (September 2026)

**Branch:** `claude/add-voucher-box-feature-eJxLV`  
**Last updated:** 2026-09-21

---

## What was changed

### Homepage audience split (all 3 locales)

All three homepages (`index.html`, `de/index.html`, `fr/index.html`) received:

- **4-dropdown desktop navigation** replacing the old 3-item nav:
  - Moving / Umziehen / S'installer
  - Living & Saving / Leben & Sparen / Vivre & Économiser
  - Guides / Ratgeber / Guides
  - Deals / Angebote / Offres (button style)
- **Mobile nav drawer** updated with the new section structure
- **Audience-split section** added above the existing checklist — two equal path cards:
  - EN: "I'm moving to Switzerland" → `/moving-to-switzerland/`  /  "I already live in Switzerland" → `/living-in-switzerland/`
  - DE: "Ich ziehe in die Schweiz" → `/de/umzug-schweiz/`  /  "Ich lebe bereits in der Schweiz" → `/de/leben-in-der-schweiz/`
  - FR: "Je m'installe en Suisse" → `/fr/sinstaller-en-suisse/`  /  "Je vis déjà en Suisse" → `/fr/vivre-en-suisse/`

### Navigation on all inner pages

All EN, DE, FR inner pages (finance, groceries, health-insurance, insurance, mobile-internet, public-transport, vouchers) had their desktop nav and mobile drawer updated to match the new 4-item structure.

### New pages created (33 total across 3 locales)

#### Hub pages (3 × 3 = 9)
| Slug | EN | DE | FR |
|------|----|----|-----|
| Newcomer Hub | `/moving-to-switzerland/` | `/de/umzug-schweiz/` | `/fr/sinstaller-en-suisse/` |
| Resident Hub | `/living-in-switzerland/` | `/de/leben-in-der-schweiz/` | `/fr/vivre-en-suisse/` |
| Guides index | `/guides/` | `/de/ratgeber/` | `/fr/guides/` |

#### Editorial guide pages (8 topics × 3 = 24)
| Topic | EN | DE | FR |
|-------|----|----|-----|
| eSIM | `/esim-switzerland/` | `/de/esim-schweiz/` | `/fr/esim-suisse/` |
| Mobile plans | `/mobile-plan-switzerland/` | `/de/mobilplan-schweiz/` | `/fr/forfait-mobile-suisse/` |
| First 90 days | `/first-90-days-switzerland/` | `/de/erste-90-tage-schweiz/` | `/fr/premiers-90-jours-suisse/` |
| Legal help | `/legal-help-switzerland/` | `/de/rechtliche-hilfe-schweiz/` | `/fr/aide-juridique-suisse/` |
| Legal protection insurance | `/legal-protection-insurance-switzerland/` | `/de/rechtsschutz-schweiz/` | `/fr/assurance-protection-juridique-suisse/` |
| Annual savings check | `/annual-savings-check-switzerland/` | `/de/jaehrlicher-sparcheck-schweiz/` | `/fr/bilan-epargne-annuel-suisse/` |
| Switch provider | `/switch-mobile-internet-switzerland/` | `/de/anbieter-wechseln-schweiz/` | `/fr/changer-operateur-suisse/` |
| Newcomer-or-resident orientation | `/newcomer-or-resident-guide/` | `/de/neuankoemmling-oder-einwohner/` | `/fr/nouveau-venu-ou-resident/` |

---

## Editorial constraints applied

The following constraints from the master brief were applied throughout:

| Constraint | Applied |
|------------|---------|
| No invented affiliate links, prices, referral codes | ✓ All links go to real Swiss public resources (priminfo.admin.ch, comparis.ch, BAKOM, SBB, etc.) |
| No invented partner names or testimonials | ✓ No named partners appear on any new page |
| No invented savings amounts | ✓ No CHF figures claimed on guide or resident pages |
| CHF 4,000+ claim only on newcomer/deals pages | ✓ Claim not used on any of the new pages in this batch |
| Legal pages: visible disclaimer | ✓ `editorial-disclaimer` div appears twice on all three legal protection pages and twice on all three legal help pages |
| Legal pages: "not legal advice" wording | ✓ Exact wording: "General information only — not legal advice" (EN), "Allgemeine Informationen — keine Rechtsberatung" (DE), "Informations générales uniquement — pas de conseil juridique" (FR) |

---

## Technical checks

- All new pages use `<body class="standalone">` with `/style.css`
- All new pages include `hreflang` alternates (en / de / fr / x-default)
- All new pages include Schema.org JSON-LD (`@graph` with Organization + WebPage + BreadcrumbList)
- All new pages include breadcrumb bar
- All new pages include `og:locale` matching the page language
- Desktop nav on new pages includes correct `class="active"` on current page link
- Mobile drawer language row uses `mnd-lang-active` on current locale button
- Footer date script uses locale-correct month names

---

## Files updated

- `index.html` — EN homepage
- `de/index.html` — DE homepage
- `fr/index.html` — FR homepage
- `*/finance/index.html`, `*/groceries/index.html`, `*/health-insurance/index.html`, `*/insurance/index.html`, `*/mobile-internet/index.html`, `*/public-transport/index.html`, `*/vouchers/index.html` (EN + DE + FR)
- `sitemap.xml` — all 33 new URLs added with hreflang
- `partner-opportunities.json` — 3 new placeholder categories added (all `"status": "disabled"`)

---

## What was NOT done

- No commits or pushes (per brief: "keine Commits/Pushes, falls ich das nicht separat verlangt habe")
- No active affiliate links, partner CTAs, or referral codes on any page
- No changes to `robots.txt` (existing rules assumed adequate)
- The `validate-offers.js --html` regression check has not been run — run before pushing

---

## Pre-push checklist

- [ ] Run `node validate-offers.js --html` — check for regressions
- [ ] Visual spot-check: homepage audience split cards on all 3 locales
- [ ] Visual spot-check: desktop nav dropdowns open/close correctly
- [ ] Visual spot-check: mobile drawer sections on a new guide page
- [ ] Confirm legal disclaimer appears on all 6 legal protection / legal help pages
- [ ] Confirm hreflang tags on a new guide page point to correct counterparts
- [ ] Sitemap: confirm no duplicate `<loc>` values
