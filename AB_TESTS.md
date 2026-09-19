# A/B Test Backlog — SwissNewbie

**Status**: Documented for implementation behind a feature-flag mechanism.  
No experiment infrastructure currently exists. Implement using a lightweight flag in `localStorage` or a URL parameter (`?exp=<name>-<variant>`) for manual QA, and a proper server-side or Vercel Edge Config flag for production rollout.

---

## Test 1: Voucher hero headline variant

**Page**: `/vouchers/` (and DE/FR equivalents)  
**Audience**: All visitors to the voucher hub  
**Hypothesis**: A benefit-led newcomer headline converts newcomers better; an annual-savings headline resonates more with residents, lifting engagement from returning visitors.

**Variants**:
- **Control (A)**: Current headline — "All Voucher Codes" + "Every exclusive deal SwissNewbie has negotiated for you"
- **Variant B (newcomer)**: "Set up Switzerland in one visit — save CHF 2,000+ with these referral deals"
- **Variant C (resident)**: "Annual Swiss savings check — telecom, insurance, 3a, transport"

**Primary metric**: Provider-confirmed activation rate (tracked via postback/offer ID)  
**Secondary metric**: CTA click-through to top provider (Sunrise or yallo)  
**Guardrails**: Provider-page bounce > 70%; displayed-benefit mismatch complaints; activation reversal rate  
**Stopping rule**: 95% confidence or 1,000 activations per variant, whichever comes first. Stop early if guardrail is breached.

---

## Test 2: Personalised telecom routing vs fixed Sunrise-first

**Page**: `/vouchers/` mobile section, `/mobile-internet/`  
**Audience**: All visitors  
**Hypothesis**: Two routing questions ("Do you already have Swiss mobile? / How long do you plan to stay?") help visitors self-select the right offer and reduce Sunrise Family Benefit mismatch (Family Benefit requires a qualifying existing subscription).

**Variants**:
- **Control (A)**: Fixed Sunrise-first layout as current
- **Variant B**: Two-question selector → if new to Switzerland → show Sunrise newcomer pricing first; if existing subscriber → show Family Benefit first; if budget-focused → show yallo first

**Primary metric**: Provider-confirmed activation  
**Secondary metric**: Activation reversal/cancellation (especially for Family Benefit — mismatch is a key reversal driver)  
**Guardrails**: Activation reversal > 15%; page abandonment after selector > 40%  
**Stopping rule**: 95% confidence or 500 activations per variant

---

## Test 3: Benefit-led CTA vs verified numeric benefit CTA

**Page**: All offer cards across `/vouchers/`, `/finance/`, `/mobile-internet/`  
**Audience**: All visitors  
**Hypothesis**: Named-action CTAs ("Check my Sunrise deal") drive more qualified clicks than generic benefit CTAs ("Get 50% off") because they set accurate expectations and reduce disappointment on the provider page.

**Variants**:
- **Control (A)**: Named-action CTAs as implemented (e.g. "Check my Sunrise deal →")
- **Variant B**: Numeric benefit CTAs where verified (e.g. "Get CHF 35 with Frankly →", "Get CHF 40 value with Smile →")

**Primary metric**: Provider-confirmed activation  
**Secondary metric**: Raw click-through rate (diagnostic only)  
**Guardrails**: Benefit mismatch complaints; activation reversal > 15%  
**Stopping rule**: 95% confidence or 300 activations per variant

---

## Test 4: One-line qualification vs two decision bullets

**Page**: All offer cards  
**Audience**: All visitors  
**Hypothesis**: Two short condition bullets help visitors self-qualify before clicking, reducing low-intent clicks and mismatch (especially for Sunrise Family Benefit and IBKR share vesting).

**Variants**:
- **Control (A)**: Current: 3 feature bullets + 1 vg-reward-note condition line
- **Variant B**: 2 decision bullets (e.g. "You already have a Swiss subscription ✓" / "You want to add a second plan ✓") replacing or supplementing feature bullets

**Primary metric**: Activation reversal rate (lower = win)  
**Secondary metric**: Click-through rate (expect lower in Variant B — that is acceptable if activation quality improves)  
**Guardrails**: Overall click volume down > 50% (too much friction)  
**Stopping rule**: 95% confidence on reversal rate with 200+ activations per variant

---

## Test 5: Worked 12/24-month telecom example — position

**Page**: `/mobile-internet/` and `/vouchers/` telecom section  
**Audience**: All visitors  
**Hypothesis**: Showing a worked cost comparison (monthly price × 12 months, minus referral credit) above the first CTA anchors the decision and increases conversion. Below the CTA it serves as a reassurance signal post-click.

**Variants**:
- **Control (A)**: No worked example (current)
- **Variant B**: Worked example ABOVE first CTA — labelled "Example: Sunrise Swiss Connect M (CHF 35/mo × 12 = CHF 420/yr, incl. Family Benefit saving)"
- **Variant C**: Worked example BELOW first CTA

**Primary metric**: Click-through on first CTA  
**Secondary metric**: Time on page (engagement signal)  
**Guardrails**: Worked example uses only current sourced plan data — update when Sunrise plan pricing changes  
**Stopping rule**: 95% confidence or 500 qualified visitors per variant

---

## Test 6: Disclosure label — concise inline vs accessible detail

**Page**: All offer cards  
**Audience**: All visitors  
**Hypothesis**: The relationship must remain clear in both variants. A visible label with "Referral link" text plus an accessible details element (expandable) may improve trust without cluttering the conversion surface.

**Variants**:
- **Control (A)**: Current: one-line `sn-disclosure` text beneath CTA ("Referral link — SwissNewbie may receive a reward after activation.")
- **Variant B**: Visible label chip "🔗 Referral link" + `<details>` element expanding to show full disclosure + link to `/referral-policy/`

**Primary metric**: Provider-confirmed activation (trust should not hurt conversion)  
**Secondary metric**: Referral policy page views (proxy for disclosure engagement)  
**Guardrails**: Activation rate down > 10% vs control; legal: the relationship must remain clear in BOTH variants, non-negotiable  
**Stopping rule**: 95% confidence or 500 activations per variant

---

## Test 7: Selected-offer sticky mobile CTA vs no sticky CTA

**Page**: `/vouchers/` and category guide pages (mobile)  
**Audience**: Mobile visitors only (viewport < 768px)  
**Hypothesis**: A sticky CTA that appears after a visitor has scrolled past a specific offer card (and only for that offer) shortens the path to click-through on mobile where scrolling back up is friction.

**Variants**:
- **Control (A)**: No sticky CTA (current)
- **Variant B**: Sticky CTA appears at bottom of viewport after visitor scrolls past the first offer card. Shows provider logo + benefit + CTA. Dismissable. Does NOT cover navigation, consent controls, or condition text. Disappears when visitor scrolls back above the card.

**Primary metric**: CTA click-through on mobile  
**Secondary metric**: Provider-confirmed activation  
**Guardrails**: Sticky CTA must not cover consent controls or navigation — automated test required before launch; scroll-back abandonment rate  
**Stopping rule**: 95% confidence or 300 mobile sessions per variant

---

## Analytics event spec (for all tests)

Every CTA click must fire an event through the existing `window.va` abstraction:

```js
window.va && window.va('event', {
  name: 'offer_cta_click',
  data: {
    offer_id: '<analyticsOfferId from offers.json>',
    provider: '<provider name>',
    category: '<category>',
    locale: '<en|de|fr>',
    source_page: location.pathname,
    placement: '<vouchers|finance|mobile-internet|...>',
    claim_version: '<benefitVerifiedAsOf>',
    destination_type: '<referral|affiliate|comparison>',
    experiment_id: '<test id or null>',
    variant: '<A|B|C or null>'
  }
})
```

**Do not include**: name, email, IP, user agent (beyond the existing voucher-notify.js usage), or any other PII.

**Server-side postback spec** (for provider-confirmed activations — to be built with each partner):

| Field | Type | Description |
|---|---|---|
| `offer_id` | string | Matches `analyticsOfferId` in offers.json |
| `provider` | string | Provider name |
| `activation_date` | ISO8601 | When provider confirmed activation |
| `reversal_date` | ISO8601 \| null | If activation was reversed/cancelled |
| `visitor_benefit` | string | Benefit actually delivered to visitor |
| `referrer_reward` | number | Amount earned by SwissNewbie |
| `currency` | string | CHF or USD |
| `status` | enum | `active`, `reversed`, `pending` |

This spec is not yet implemented. Implement as a Vercel serverless endpoint (`/api/activation-postback`) when the first partner provides a postback URL.
