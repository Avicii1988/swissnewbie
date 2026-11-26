// Vercel serverless function — sends email when a voucher code is clicked
// Setup: add RESEND_API_KEY to your Vercel environment variables
// Get a free API key at https://resend.com (100 emails/day free)
//
// Hardening (B1/B2/B5):
// - only same-site origins (api/_guard.js), per-IP rate limit in KV, fails closed
// - `code` must be one of the codes the site's own pages can send (ALLOWED_CODES)
// - every value is length-limited, stripped of control characters and HTML-escaped
// - the browser only ever gets { ok: true } / { ok: false }

import { isAllowedOrigin, setCors, getClientIp, checkIpRateLimit, readJsonBody } from './_guard.js';

const MAX_BODY_BYTES = 4 * 1024;
export const RATE_LIMIT_PER_HOUR = 60;
export const FIELD_LIMITS = { code: 60, page: 300, ts: 40, ua: 200 };
const SUBJECT_MAX = 100;
// Optional fields from /js/tracking.js; anything not matching the pattern is dropped.
const PROVIDER_RE = /^[a-z0-9-]{1,40}$/;
const LANGS = new Set(['en', 'de', 'fr']);

// Every value the site's pages can send as `code` (derived from the HTML):
// data-voucher-id attributes, copyCode() literals, and the fallback the click
// trackers build from a card name (name, whitespace -> "-", first 20 characters)
// for cards without a data-voucher-id.
export const ALLOWED_CODES = new Set([
  // data-voucher-id
  'CFSH8W', 'JAN533A2', 'css-quote-request', 'ibkr-investing-referral', 'manor-adtraction-referral',
  'mobility-carsharing-referral', 'refjf7c46', 'sunrise-internet-tv-referral', 'sunrise-mobile-family-referral',
  'swica-health-referral', 'ubs-banking-referral', 'wise-transfer-referral', 'yallo-internet-referral',
  'yallo-mobile-referral',
  // copyCode() literal without data-voucher-id
  'XXOJWZ',
  // card-name fallbacks
  'Interactive-Brokers', 'Interactive-Brokers-', 'Mobility-Car-Sharing', 'Smile-Car-Insurance', 'Smile-Insurance',
  'Sunrise-Internet-&-T', 'Sunrise-Mobile', 'Wise-(International-', 'Wise-(Transfers)', 'Wise-(Virements)',
  'Wise-(Überweisungen)', 'Yallo-Mobile', '🌐-Sunrise-Internet-', '🌐-Yallo-Internet', '💸-Wise-(Money-Trans',
  '💸-Wise-(Transfers)', '📈-Interactive-Broke', '📱-Yallo-Mobile', '🚗-Mobility-Car-Shar'
]);

function esc(v) {
  if (v === undefined || v === null || v === '') return '—';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Single-line text: control characters (incl. CR/LF) become spaces, then trimmed and cut.
export function cleanText(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, max);
}

export function buildVoucherEmail(raw) {
  const code = cleanText(raw && raw.code, FIELD_LIMITS.code);
  const page = cleanText(raw && raw.page, FIELD_LIMITS.page);
  const ts = cleanText(raw && raw.ts, FIELD_LIMITS.ts);
  const ua = cleanText(raw && raw.ua, FIELD_LIMITS.ua);
  const providerRaw = cleanText(raw && raw.provider, 40);
  const provider = PROVIDER_RE.test(providerRaw) ? providerRaw : '';
  const langRaw = cleanText(raw && raw.lang, 2);
  const lang = LANGS.has(langRaw) ? langRaw : '';
  const extra = (provider ? ` · ${provider}` : '') + (lang ? ` · ${lang.toUpperCase()}` : '');
  const subject = cleanText(`🏷️ ${code} clicked on SwissNewbie${extra}`, SUBJECT_MAX);
  const extraRows =
    (provider ? `\n        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Provider</td><td style="padding:6px 12px;">${esc(provider)}</td></tr>` : '') +
    (lang ? `\n        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Language</td><td style="padding:6px 12px;">${esc(lang)}</td></tr>` : '');
  const html = `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#D0021B;">🏷️ Voucher clicked: <strong>${esc(code)}</strong></h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Code</td><td style="padding:6px 12px;">${esc(code)}</td></tr>${extraRows}
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Page</td><td style="padding:6px 12px;">${esc(page)}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Time</td><td style="padding:6px 12px;">${esc(ts)}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Browser</td><td style="padding:6px 12px;font-size:11px;color:#666;">${esc(ua)}</td></tr>
      </table>
    </div>`;
  return { code, subject, html };
}

// Validates and sends. Returns { status, ok }. Never returns provider data or error text.
export async function handleVoucherNotify(body, { apiKey, fetchImpl } = {}) {
  const key = apiKey !== undefined ? apiKey : process.env.RESEND_API_KEY;
  const doFetch = fetchImpl || fetch;
  const { code, subject, html } = buildVoucherEmail(body || {});
  if (!ALLOWED_CODES.has(code)) return { status: 400, ok: false };
  if (!key) return { status: 200, ok: true }; // not configured: stay silent, as before

  try {
    const r = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'SwissNewbie <noreply@swissnewbie.ch>',
        to: ['jan.feusi@gmx.ch'],
        subject,
        html
      })
    });
    if (!r.ok) {
      console.error('voucher-notify: mail provider rejected the request, status', r.status);
      return { status: 502, ok: false };
    }
    return { status: 200, ok: true };
  } catch (e) {
    console.error('voucher-notify: mail request failed:', e && e.name);
    return { status: 502, ok: false };
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  setCors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!isAllowedOrigin(origin)) return res.status(403).json({ ok: false });

  const body = readJsonBody(req, MAX_BODY_BYTES);
  if (!body) return res.status(400).json({ ok: false });

  const limit = await checkIpRateLimit({ scope: 'vn', limit: RATE_LIMIT_PER_HOUR, clientIp: getClientIp(req) });
  if (limit === 'unavailable') return res.status(503).json({ ok: false });
  if (limit === 'limited') return res.status(429).json({ ok: false });

  const result = await handleVoucherNotify(body);
  return res.status(result.status).json({ ok: result.ok });
}
