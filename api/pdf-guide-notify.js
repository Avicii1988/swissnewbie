// Vercel serverless function — PDF checklist download.
// On a valid request it (a) mails the visitor the download link to the checklist PDF and
// (b) sends the internal info mail (same recipient as registration-notify).
// Setup: RESEND_API_KEY (sender domain swissnewbie.ch must be verified in Resend),
// plus KV + CSS_LEAD_IP_HASH_SECRET for the rate limits (api/_guard.js, fails closed).
//
// Hardening, same pattern as voucher-notify / registration-notify:
// - same-site origins only, per-IP rate limit, plus a per-address limit so the
//   endpoint cannot be used to flood a third party's inbox
// - honeypot field `website`: filled -> silently ok, nothing is sent
// - every value is length-limited, stripped of control characters and HTML-escaped
// - the browser only ever gets { ok } (plus the field list on validation errors)

import { isAllowedOrigin, setCors, getClientIp, checkIpRateLimit, readJsonBody, countryFromRequest } from './_guard.js';
import { NOTIFY_TO, NOTIFY_FROM, EMAIL_RE } from './registration-notify.js';

const MAX_BODY_BYTES = 4 * 1024;
export const RATE_LIMIT_PER_HOUR = 5;          // per IP
export const RATE_LIMIT_PER_ADDRESS = 2;       // per e-mail address and hour
// Static assets built by scripts/build-checklist-pdf.js
export const PDF_URLS = {
  en: 'https://www.swissnewbie.ch/assets/swissnewbie-checklist-2026.pdf',
  de: 'https://www.swissnewbie.ch/assets/swissnewbie-checklist-2026-de.pdf',
  fr: 'https://www.swissnewbie.ch/assets/swissnewbie-checklist-2026-fr.pdf'
};
const LANGS = ['en', 'de', 'fr'];
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

function esc(v) {
  if (v === undefined || v === null || v === '') return '—';
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, max);
}

export function validatePdfRequest(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { valid: false, errors: ['invalid_body'] };
  if (typeof body.email !== 'string' || body.email.length > 254 || !EMAIL_RE.test(body.email.trim())) errors.push('invalid_email');
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 60)) errors.push('invalid_name');
  if (body.lang !== undefined && !LANGS.includes(body.lang)) errors.push('invalid_lang');
  return { valid: errors.length === 0, errors };
}

// Normalised, length-limited copy of everything the mails use.
export function normalizePdfRequest(body, country) {
  const utm = {};
  if (body.utm && typeof body.utm === 'object' && !Array.isArray(body.utm)) {
    for (const k of UTM_KEYS) { const v = clean(body.utm[k], 100); if (v) utm[k] = v; }
  }
  return {
    email: clean(body.email, 254).toLowerCase(),
    name: clean(body.name, 60),
    lang: LANGS.includes(body.lang) ? body.lang : 'en',
    browserLang: clean(body.browserLang, 35),
    referrer: clean(body.referrer, 300),
    landingPage: clean(body.landingPage, 300),
    ts: clean(body.ts, 40) || new Date().toISOString(),
    utm,
    country: country && country.code ? `${country.code} (${country.source})` : ''
  };
}

const USER_MAIL = {
  en: { subject: 'Your 2026 Switzerland Relocation Checklist (PDF)', hi: 'Hi', intro: 'here is your free 2026 Switzerland Relocation Checklist from SwissNewbie.', btn: 'Download the PDF', note: 'Print it out and tick off each step as you go. If the button does not work, copy this link into your browser:', bye: 'Good luck with your move!', team: 'The SwissNewbie team', why: 'You are receiving this e-mail because this address was entered on swissnewbie.ch to request the checklist. We will not send you anything else.' },
  de: { subject: 'Deine Schweiz-Umzugscheckliste 2026 (PDF)', hi: 'Hallo', intro: 'hier ist deine kostenlose Schweiz-Umzugscheckliste 2026 von SwissNewbie.', btn: 'PDF herunterladen', note: 'Druck sie aus und hak jeden Schritt ab. Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:', bye: 'Viel Erfolg beim Umzug!', team: 'Das SwissNewbie-Team', why: 'Du erhältst diese E-Mail, weil diese Adresse auf swissnewbie.ch für die Checkliste angegeben wurde. Wir schicken dir sonst nichts.' },
  fr: { subject: 'Votre checklist de déménagement en Suisse 2026 (PDF)', hi: 'Bonjour', intro: 'voici votre checklist gratuite de déménagement en Suisse 2026 de SwissNewbie.', btn: 'Télécharger le PDF', note: 'Imprimez-la et cochez chaque étape au fur et à mesure. Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :', bye: 'Bon déménagement !', team: "L'équipe SwissNewbie", why: 'Vous recevez cet e-mail parce que cette adresse a été saisie sur swissnewbie.ch pour demander la checklist. Nous ne vous enverrons rien d’autre.' }
};

export function buildUserMail(d) {
  const t = USER_MAIL[d.lang] || USER_MAIL.en;
  const PDF_URL = PDF_URLS[d.lang] || PDF_URLS.en;
  const greet = d.name ? `${t.hi} ${esc(d.name)},` : `${t.hi},`;
  const html = `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#1a1a1a;padding:18px 24px;border-radius:10px 10px 0 0;"><span style="font-size:20px;font-weight:700;color:#fff;">🐄 Swiss<span style="color:#ff4d5e;">Newbie</span></span></div>
      <div style="border:1px solid #e5e2dc;border-top:none;border-radius:0 0 10px 10px;padding:24px;">
        <p style="margin:0 0 12px;">${greet}</p>
        <p style="margin:0 0 20px;">${esc(t.intro)}</p>
        <p style="margin:0 0 20px;"><a href="${PDF_URL}" style="display:inline-block;background:#D0021B;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:6px;">${esc(t.btn)} →</a></p>
        <p style="margin:0 0 6px;font-size:13px;color:#555;">${esc(t.note)}</p>
        <p style="margin:0 0 20px;font-size:13px;word-break:break-all;"><a href="${PDF_URL}" style="color:#D0021B;">${PDF_URL}</a></p>
        <p style="margin:0;">${esc(t.bye)}<br>${esc(t.team)}</p>
        <p style="margin:20px 0 0;font-size:11px;color:#888;">${esc(t.why)}</p>
      </div>
    </div>`;
  return { subject: t.subject, html };
}

export function buildInfoMail(d) {
  const row = (k, v) => `<tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">${esc(k)}</td><td style="padding:6px 12px;">${esc(v)}</td></tr>`;
  const utmRows = Object.keys(d.utm).map((k) => row(k, d.utm[k])).join('');
  const html = `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#D0021B;">📄 PDF checklist requested: <strong>${esc(d.email)}</strong></h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        ${row('Email', d.email)}${row('Name', d.name)}${row('Language', d.lang)}${row('Country', d.country)}
        ${row('Browser language', d.browserLang)}${row('Referrer', d.referrer)}${row('Landing page', d.landingPage)}
        ${utmRows}${row('Time', d.ts)}
      </table>
    </div>`;
  return { subject: clean(`📄 PDF checklist download on SwissNewbie: ${d.email}`, 120), html };
}

async function sendMail(doFetch, key, to, { subject, html }) {
  try {
    const r = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: NOTIFY_FROM, to, subject, html })
    });
    if (!r.ok) { console.error('pdf-guide-notify: mail provider rejected the request, status', r.status); return false; }
    return true;
  } catch (e) {
    console.error('pdf-guide-notify: mail request failed:', e && e.name);
    return false;
  }
}

// Sends both mails. Returns { status, ok }. Success means the visitor's mail was accepted.
export async function handlePdfGuideNotify(data, { apiKey, fetchImpl } = {}) {
  const key = apiKey !== undefined ? apiKey : process.env.RESEND_API_KEY;
  const doFetch = fetchImpl || fetch;
  // without a mail key the visitor would get nothing: say so instead of claiming success
  if (!key) { console.error('pdf-guide-notify: RESEND_API_KEY not set'); return { status: 503, ok: false }; }
  const userOk = await sendMail(doFetch, key, [data.email], buildUserMail(data));
  await sendMail(doFetch, key, NOTIFY_TO, buildInfoMail(data)); // info mail: best effort, never blocks the visitor
  return userOk ? { status: 200, ok: true } : { status: 502, ok: false };
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  setCors(res, origin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!isAllowedOrigin(origin)) return res.status(403).json({ ok: false });

  const body = readJsonBody(req, MAX_BODY_BYTES);
  if (!body) return res.status(400).json({ ok: false });
  if (body.website) return res.status(200).json({ ok: true }); // honeypot: bots get a silent success

  const { valid, errors } = validatePdfRequest(body);
  if (!valid) return res.status(400).json({ ok: false, error: 'validation_failed', fields: errors });

  const ipLimit = await checkIpRateLimit({ scope: 'pdf', limit: RATE_LIMIT_PER_HOUR, clientIp: getClientIp(req) });
  if (ipLimit === 'unavailable') return res.status(503).json({ ok: false });
  if (ipLimit === 'limited') return res.status(429).json({ ok: false });
  // per-address limit (the address is hashed like an IP, never stored in clear)
  const addrLimit = await checkIpRateLimit({ scope: 'pdf-addr', limit: RATE_LIMIT_PER_ADDRESS, clientIp: body.email.trim().toLowerCase() });
  if (addrLimit === 'unavailable') return res.status(503).json({ ok: false });
  if (addrLimit === 'limited') return res.status(429).json({ ok: false });

  const data = normalizePdfRequest(body, countryFromRequest(req, body.browserLang));
  const result = await handlePdfGuideNotify(data);
  return res.status(result.status).json({ ok: result.ok });
}
