// Vercel serverless function — CSS insurance quote-request lead forwarding.
//
// NOT ACTIVE by default. Activation requires ALL of:
//   CSS_LEAD_TO, CSS_LEAD_CC, RESEND_API_KEY, CSS_LEAD_IP_HASH_SECRET
//   KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL/TOKEN)
// ...and the KV store must actually answer a PING. If any piece is missing or
// unreachable, GET reports {active:false} and POST is rejected — this function
// must never silently "succeed" without a confirmed Resend acceptance.
//
// GET  -> { active: boolean }  (no other fields)
// POST -> { ok: boolean, ... } only after a confirmed Resend send, or an
//         honest rejection. Never logs contact data, request bodies or secrets.

import crypto from 'node:crypto';

export const PRODUCTS = ['home_contents', 'personal_liability', 'travel_annual', 'buildings'];
export const LOCALES = ['en', 'de', 'fr'];
const MAX_BODY_BYTES = 4 * 1024;
const RATE_LIMIT_PER_HOUR = 5;
const SUBMISSION_TTL_SECONDS = 24 * 60 * 60; // matches Resend's own 24h idempotency window
const MAX_SEND_ATTEMPTS = 3;
const MIN_FILL_SECONDS = 3;
const KV_PING_TIMEOUT_MS = 3000;

const PRODUCT_LABELS_DE = {
  home_contents: 'Hausratversicherung',
  personal_liability: 'Privathaftpflicht',
  travel_annual: 'Reiseversicherung (Jahresvertrag)',
  buildings: 'Gebäudeversicherung'
};

const PROD_ORIGINS = ['https://www.swissnewbie.ch', 'https://swissnewbie.ch'];

const SINGLE_LINE_UNSAFE_RE = /[\x00-\x1F\x7F]/; // control chars incl. CR/LF — blocks header/body injection
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const PHONE_RE = /^[0-9+()\-.\s]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isProduction() {
  return process.env.VERCEL_ENV === 'production';
}

export function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (PROD_ORIGINS.includes(origin)) return true;
  if (!isProduction() && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

export function getConfig() {
  const to = process.env.CSS_LEAD_TO;
  const cc = process.env.CSS_LEAD_CC;
  const resendApiKey = process.env.RESEND_API_KEY;
  const ipHashSecret = process.env.CSS_LEAD_IP_HASH_SECRET;
  const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const complete = !!(to && cc && resendApiKey && ipHashSecret && kvUrl && kvToken);
  return { to, cc, resendApiKey, ipHashSecret, kvUrl, kvToken, complete };
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// Thin wrapper over the Upstash/Vercel KV REST "single command" API, matching the
// style already used in api/community-stats.js. Every method fails closed (returns
// a falsy/empty result) on any error — callers must treat that as "unavailable".
export function makeKvClient(url, token, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  async function cmd(...args) {
    if (!url || !token) throw new Error('kv_not_configured');
    const path = args.map((a) => encodeURIComponent(String(a))).join('/');
    const r = await doFetch(`${url}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`kv_http_${r.status}`);
    const d = await r.json();
    if (d && d.error) throw new Error('kv_error');
    return d.result;
  }
  return {
    async ping() {
      try {
        const res = await withTimeout(cmd('ping'), KV_PING_TIMEOUT_MS);
        return res === 'PONG';
      } catch (e) {
        return false;
      }
    },
    async get(key) {
      try {
        return await cmd('get', key);
      } catch (e) {
        return null;
      }
    },
    async setNx(key, value, ttlSeconds) {
      try {
        return (await cmd('set', key, value, 'NX', 'EX', String(ttlSeconds))) === 'OK';
      } catch (e) {
        return false;
      }
    },
    async set(key, value, ttlSeconds) {
      try {
        return (await cmd('set', key, value, 'EX', String(ttlSeconds))) === 'OK';
      } catch (e) {
        return false;
      }
    },
    async incr(key) {
      try {
        return Number(await cmd('incr', key));
      } catch (e) {
        return null;
      }
    },
    async expireNx(key, ttlSeconds) {
      try {
        await cmd('expire', key, String(ttlSeconds), 'NX');
      } catch (e) {
        /* best-effort TTL backstop; INCR already succeeded */
      }
    }
  };
}

export function hashIp(ip, secret) {
  return crypto.createHmac('sha256', secret).update(String(ip)).digest('hex').slice(0, 32);
}

function hashPayload(body) {
  const normalized = JSON.stringify({
    name: body.name,
    email: body.email,
    phone: body.phone || null,
    products: [...body.products].sort(),
    locale: body.locale,
    consent: body.consent
  });
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function validatePayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { valid: false, errors: ['invalid_body'] };

  const allowedKeys = ['submissionId', 'name', 'email', 'phone', 'products', 'locale', 'consent', 'honeypot', 'formStartedAt'];
  if (Object.keys(body).some((k) => !allowedKeys.includes(k))) errors.push('unexpected_fields');

  if (typeof body.submissionId !== 'string' || !UUID_RE.test(body.submissionId)) errors.push('invalid_submission_id');

  if (
    typeof body.name !== 'string' ||
    SINGLE_LINE_UNSAFE_RE.test(body.name) ||
    body.name.trim().length < 1 ||
    body.name.length > 120
  ) {
    errors.push('invalid_name');
  }

  if (
    typeof body.email !== 'string' ||
    SINGLE_LINE_UNSAFE_RE.test(body.email) ||
    body.email.length > 254 ||
    !EMAIL_RE.test(body.email)
  ) {
    errors.push('invalid_email');
  }

  if (body.phone !== undefined) {
    if (typeof body.phone !== 'string' || SINGLE_LINE_UNSAFE_RE.test(body.phone) || !PHONE_RE.test(body.phone)) {
      errors.push('invalid_phone');
    }
  }

  if (!Array.isArray(body.products) || body.products.length < 1 || body.products.length > PRODUCTS.length) {
    errors.push('invalid_products');
  } else {
    const uniq = new Set(body.products);
    if (uniq.size !== body.products.length || ![...uniq].every((p) => PRODUCTS.includes(p))) {
      errors.push('invalid_products');
    }
  }

  if (typeof body.locale !== 'string' || !LOCALES.includes(body.locale)) errors.push('invalid_locale');
  if (body.consent !== true) errors.push('consent_required');
  if (body.honeypot !== undefined && typeof body.honeypot !== 'string') errors.push('invalid_honeypot');
  if (body.formStartedAt !== undefined && typeof body.formStartedAt !== 'string') errors.push('invalid_timing');

  return { valid: errors.length === 0, errors };
}

export function buildEmailBody({ name, email, phone, productsLabel }) {
  const lines = [
    'Guten Tag',
    '',
    'Diese Person wünscht eine unverbindliche CSS-Offerte:',
    '',
    `Name: ${name}`,
    `E-Mail: ${email}`
  ];
  if (phone) lines.push(`Telefon: ${phone}`);
  lines.push(`Interesse: ${productsLabel}`);
  lines.push('');
  lines.push('Die Person hat der Weitergabe dieser Angaben an CSS ausdrücklich zugestimmt. Über die Antwort-Funktion erreichen Sie sie direkt.');
  lines.push('');
  lines.push('Bitte ordnen Sie diese Weiterempfehlung Jan, SwissNewbie.ch (jan.feusi@gmx.ch), zu.');
  lines.push('');
  lines.push('Vielen Dank.');
  lines.push('');
  lines.push('Freundliche Grüsse');
  lines.push('Jan, SwissNewbie.ch');
  return lines.join('\n');
}

export function productsLabelDe(products) {
  return products.map((p) => PRODUCT_LABELS_DE[p] || p).join(', ');
}

// Sends via Resend with the given Idempotency-Key. On a 4xx (definitive rejection,
// e.g. invalid recipient) it does not retry. On a 5xx or network/timeout error the
// outcome is ambiguous (Resend may have accepted it despite the bad response), so
// it retries once more with the SAME Idempotency-Key: Resend's documented 24h
// idempotency window guarantees that a retry never produces a second email — it
// either returns the original accepted response or a fresh attempt.
export async function sendCssLeadEmail({ name, email, phone, products, apiKey, to, cc, idempotencyKey, fetchImpl, maxAttempts = 2 }) {
  const doFetch = fetchImpl || fetch;
  const productsLabel = productsLabelDe(products);
  const payload = {
    from: 'SwissNewbie <noreply@swissnewbie.ch>',
    to: [to],
    cc: [cc],
    reply_to: email,
    subject: `Neue Offertanfrage über SwissNewbie.ch: ${productsLabel}`,
    text: buildEmailBody({ name, email, phone, productsLabel })
  };

  let lastError = 'unknown';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });
      let data = null;
      try {
        data = await r.json();
      } catch (e) {
        data = null;
      }
      if (r.ok && data && typeof data.id === 'string' && data.id.length > 0) {
        return { confirmed: true, id: data.id };
      }
      if (r.status >= 400 && r.status < 500) {
        return { confirmed: false, error: 'rejected' };
      }
      lastError = `http_${r.status}`;
    } catch (e) {
      lastError = 'network_error';
    }
  }
  return { confirmed: false, error: lastError };
}

async function checkRateLimit(kv, ipHash) {
  const bucket = Math.floor(Date.now() / 3600000);
  const key = `cssl:rl:${ipHash}:${bucket}`;
  const count = await kv.incr(key);
  if (count === null) return false; // KV error during the count itself: fail closed
  await kv.expireNx(key, 3600);
  return count <= RATE_LIMIT_PER_HOUR;
}

// Atomically claims a submissionId so two concurrent/duplicate requests for the
// same id can never both send. Returns what the caller should do next.
async function claimSubmission(kv, submissionId, payloadHash) {
  const key = `cssl:sub:${submissionId}`;
  const claimed = await kv.setNx(key, JSON.stringify({ state: 'pending', payloadHash, attempts: 1, ts: Date.now() }), SUBMISSION_TTL_SECONDS);
  if (claimed) return { action: 'send', attempts: 1 };

  const existingRaw = await kv.get(key);
  let existing = null;
  try {
    existing = existingRaw ? JSON.parse(existingRaw) : null;
  } catch (e) {
    existing = null;
  }
  if (!existing) return { action: 'reject', reason: 'conflict' };
  if (existing.payloadHash !== payloadHash) return { action: 'reject', reason: 'payload_mismatch' };
  if (existing.state === 'sent') return { action: 'already_sent' };
  if (existing.state === 'pending') return { action: 'reject', reason: 'in_progress' };
  if (existing.state === 'failed') {
    const attempts = (existing.attempts || 0) + 1;
    if (attempts > MAX_SEND_ATTEMPTS) return { action: 'reject', reason: 'too_many_attempts' };
    await kv.set(key, JSON.stringify({ state: 'pending', payloadHash, attempts, ts: Date.now() }), SUBMISSION_TTL_SECONDS);
    return { action: 'send', attempts };
  }
  return { action: 'reject', reason: 'conflict' };
}

async function finalizeSubmission(kv, submissionId, payloadHash, state, attempts) {
  const key = `cssl:sub:${submissionId}`;
  await kv.set(key, JSON.stringify({ state, payloadHash, attempts, ts: Date.now() }), SUBMISSION_TTL_SECONDS);
}

export async function computeActive({ config, kv } = {}) {
  const cfg = config || getConfig();
  if (!cfg.complete) return false;
  const client = kv || makeKvClient(cfg.kvUrl, cfg.kvToken);
  return client.ping();
}

// Core POST handler, fully dependency-injected for network-free testing.
export async function handleCssLeadNotify(rawBody, options = {}) {
  const config = options.config || getConfig();
  const fetchImpl = options.fetchImpl;
  const clientIp = options.clientIp || 'unknown';

  if (rawBody && rawBody.honeypot) {
    return { status: 200, body: { ok: true } };
  }
  if (rawBody && typeof rawBody.formStartedAt === 'string') {
    const started = Date.parse(rawBody.formStartedAt);
    if (!Number.isNaN(started) && Date.now() - started < MIN_FILL_SECONDS * 1000) {
      return { status: 200, body: { ok: true } };
    }
  }

  const { valid, errors } = validatePayload(rawBody);
  if (!valid) {
    return { status: 400, body: { ok: false, error: 'validation_failed', fields: errors } };
  }

  if (!config.complete) {
    return { status: 503, body: { ok: false, error: 'not_configured' } };
  }

  const kv = options.kv || makeKvClient(config.kvUrl, config.kvToken, fetchImpl);
  const kvOk = await kv.ping();
  if (!kvOk) {
    return { status: 503, body: { ok: false, error: 'storage_unavailable' } };
  }

  const ipHash = hashIp(clientIp, config.ipHashSecret);
  const withinLimit = await checkRateLimit(kv, ipHash);
  if (!withinLimit) {
    return { status: 429, body: { ok: false, error: 'rate_limited' } };
  }

  const payloadHash = hashPayload(rawBody);
  const claim = await claimSubmission(kv, rawBody.submissionId, payloadHash);

  if (claim.action === 'already_sent') {
    return { status: 200, body: { ok: true } };
  }
  if (claim.action === 'reject') {
    if (claim.reason === 'payload_mismatch') return { status: 409, body: { ok: false, error: 'submission_id_reused' } };
    if (claim.reason === 'in_progress') return { status: 409, body: { ok: false, error: 'already_processing' } };
    if (claim.reason === 'too_many_attempts') return { status: 409, body: { ok: false, error: 'too_many_attempts' } };
    return { status: 409, body: { ok: false, error: 'conflict' } };
  }

  const name = rawBody.name.trim();
  const email = rawBody.email.trim();
  const phone = rawBody.phone ? rawBody.phone.trim() : undefined;

  const result = await sendCssLeadEmail({
    name,
    email,
    phone,
    products: rawBody.products,
    apiKey: config.resendApiKey,
    to: config.to,
    cc: config.cc,
    idempotencyKey: `css-lead:${rawBody.submissionId}`,
    fetchImpl
  });

  if (result.confirmed) {
    await finalizeSubmission(kv, rawBody.submissionId, payloadHash, 'sent', claim.attempts);
    return { status: 200, body: { ok: true } };
  }

  await finalizeSubmission(kv, rawBody.submissionId, payloadHash, 'failed', claim.attempts);
  return { status: 502, body: { ok: false, error: 'delivery_failed' } };
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function setCorsForOrigin(res, origin) {
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsForOrigin(res, req.headers.origin);
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    // Low-sensitivity boolean; no origin restriction so the activation badge
    // can be checked from any same-site context without CORS friction.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    const active = await computeActive();
    return res.status(200).json({ active });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  setCorsForOrigin(res, req.headers.origin);
  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).json({ ok: false, error: 'forbidden_origin' });
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength && contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: 'payload_too_large' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      return res.status(413).json({ ok: false, error: 'payload_too_large' });
    }
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'invalid_json' });
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: 'payload_too_large' });
  }

  const result = await handleCssLeadNotify(body, { clientIp: getClientIp(req) });
  return res.status(result.status).json(result.body);
}
