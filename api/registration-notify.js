// Vercel serverless function — sends email when a new account is registered
// Setup: add RESEND_API_KEY to your Vercel environment variables
// Get a free API key at https://resend.com (100 emails/day free)

import { isAllowedOrigin, setCors, getClientIp, checkIpRateLimit, readJsonBody, countryFromRequest } from './_guard.js';

// Recipient of all internal info mails (also used by api/pdf-guide-notify.js).
export const NOTIFY_TO = ['jan.feusi@gmx.ch'];
export const NOTIFY_FROM = 'SwissNewbie <noreply@swissnewbie.ch>';

const FORBIDDEN_FIELD_PATTERN = /pass/i;
export const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

// Required fields: name, email, ts. Returns { valid, errors } like css-lead-notify.
export function validateRegistration(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { valid: false, errors: ['invalid_body'] };
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100) errors.push('invalid_name');
  if (typeof body.email !== 'string' || body.email.length > 254 || !EMAIL_RE.test(body.email.trim())) errors.push('invalid_email');
  if (typeof body.ts !== 'string' || body.ts.length > 40 || Number.isNaN(Date.parse(body.ts))) errors.push('invalid_ts');
  return { valid: errors.length === 0, errors };
}

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
  const { name, email, ts, siteLang, browserLang, referrer, landingPage, utm, ua, voucherClicks, country } = data;
  const countryText = country && country.code ? `${country.code} (${country.source})` : '';

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
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Country</td><td style="padding:6px 12px;">${esc(countryText)}</td></tr>
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

export async function handleRegistrationNotify(body, { apiKey, fetchImpl, country } = {}) {
  const key = apiKey !== undefined ? apiKey : process.env.RESEND_API_KEY;
  const doFetch = fetchImpl || fetch;
  const data = sanitize(body || {});
  // country comes from the request (geo header), never from the client body
  data.country = country || countryFromRequest(null, data.browserLang);

  if (!key) {
    return { ok: true, note: 'RESEND_API_KEY not set' };
  }

  const html = buildEmailHtml(data);

  try {
    const r = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: NOTIFY_TO,
        subject: `🆕 New registration on SwissNewbie: ${data.name || data.email || 'unknown'}`,
        html
      })
    });
    // Resend answers 4xx/5xx with a JSON error body: that is a failed send, not ok
    if (r.ok === false) {
      console.error('registration-notify: mail provider rejected the request, status', r.status);
      return { ok: false, error: 'mail_rejected' };
    }
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

  const { valid, errors } = validateRegistration(body);
  if (!valid) return res.status(400).json({ ok: false, error: 'validation_failed', fields: errors });

  const limit = await checkIpRateLimit({ scope: 'rn', limit: RATE_LIMIT_PER_HOUR, clientIp: getClientIp(req) });
  if (limit === 'unavailable') return res.status(503).json({ ok: false });
  if (limit === 'limited') return res.status(429).json({ ok: false });

  const result = await handleRegistrationNotify(body, { country: countryFromRequest(req, body.browserLang) });
  return res.status(result.ok ? 200 : 502).json({ ok: !!result.ok });
}
