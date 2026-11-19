// Vercel serverless function — sends email when a new account is registered
// Setup: add RESEND_API_KEY to your Vercel environment variables
// Get a free API key at https://resend.com (100 emails/day free)

import { isAllowedOrigin, setCors, getClientIp, checkIpRateLimit, readJsonBody } from './_guard.js';

const FORBIDDEN_FIELD_PATTERN = /pass/i;

// Recursively strips any key matching /pass/i at any depth, so a password
// or password hash can never reach the email, a log, or an error payload.
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const clean = {};
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_FIELD_PATTERN.test(key)) continue;
      clean[key] = sanitize(value[key]);
    }
    return clean;
  }
  return value;
}

function esc(v) {
  if (v === undefined || v === null || v === '') return '—';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function buildEmailHtml(data) {
  const { name, email, ts, siteLang, browserLang, referrer, landingPage, utm, ua, voucherClicks } = data;

  const utmRows = utm && typeof utm === 'object'
    ? Object.keys(utm)
        .filter((k) => utm[k])
        .map((k) => `<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">${esc(k)}</td><td style="padding:6px 12px;">${esc(utm[k])}</td></tr>`)
        .join('')
    : '';

  const voucherText = Array.isArray(voucherClicks) && voucherClicks.length ? voucherClicks.join(', ') : 'none';

  return `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#0070F3;">🆕 New registration: <strong>${esc(name)}</strong></h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Name</td><td style="padding:6px 12px;">${esc(name)}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Email</td><td style="padding:6px 12px;">${esc(email)}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Site language</td><td style="padding:6px 12px;">${esc(siteLang)}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Browser language</td><td style="padding:6px 12px;">${esc(browserLang)}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Time</td><td style="padding:6px 12px;">${esc(ts)}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Referrer</td><td style="padding:6px 12px;">${esc(referrer)}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Landing page</td><td style="padding:6px 12px;">${esc(landingPage)}</td></tr>
        ${utmRows}
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Prior voucher clicks</td><td style="padding:6px 12px;">${esc(voucherText)}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Browser</td><td style="padding:6px 12px;font-size:11px;color:#666;">${esc(ua)}</td></tr>
      </table>
    </div>`;
}

export async function handleRegistrationNotify(body, { apiKey, fetchImpl } = {}) {
  const key = apiKey !== undefined ? apiKey : process.env.RESEND_API_KEY;
  const doFetch = fetchImpl || fetch;
  const data = sanitize(body || {});

  if (!key) {
    return { ok: true, note: 'RESEND_API_KEY not set' };
  }

  const html = buildEmailHtml(data);

  try {
    const r = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'SwissNewbie <noreply@swissnewbie.ch>',
        to: ['jan.feusi@gmx.ch'],
        subject: `🆕 New registration on SwissNewbie: ${data.name || data.email || 'unknown'}`,
        html
      })
    });
    const resData = await r.json();
    return { ok: true, data: resData };
  } catch (e) {
    console.error('registration-notify: mail request failed:', e && e.name);
    return { ok: false, error: e.message };
  }
}

// Hardening (B2/B5): same-site origins only, per-IP rate limit in KV (fails closed),
// and the browser only ever gets { ok: true } / { ok: false } — never provider data
// or error text (those stay inside handleRegistrationNotify for tests/logs).
const MAX_BODY_BYTES = 8 * 1024;
export const RATE_LIMIT_PER_HOUR = 5;

export default async function handler(req, res) {
  const origin = req.headers.origin;
  setCors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!isAllowedOrigin(origin)) return res.status(403).json({ ok: false });

  const body = readJsonBody(req, MAX_BODY_BYTES);
  if (!body) return res.status(400).json({ ok: false });

  const limit = await checkIpRateLimit({ scope: 'rn', limit: RATE_LIMIT_PER_HOUR, clientIp: getClientIp(req) });
  if (limit === 'unavailable') return res.status(503).json({ ok: false });
  if (limit === 'limited') return res.status(429).json({ ok: false });

  const result = await handleRegistrationNotify(body);
  return res.status(result.ok ? 200 : 502).json({ ok: !!result.ok });
}
