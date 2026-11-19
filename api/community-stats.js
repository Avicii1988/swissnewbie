// Shared community counter — backed by Vercel KV or Upstash Redis REST API
// Setup: add KV_REST_API_URL + KV_REST_API_TOKEN to Vercel env vars (from Vercel Storage → KV)
// Or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN if using Upstash directly
//
// Hardening (B4/B5): same-site origins only, per-IP rate limits in KV (fail closed,
// see api/_guard.js), `amount` must be a whole number between 1 and MAX_SAVING_AMOUNT,
// and the browser gets { ok, views, saved } on success or { ok: false } — never error text.

import { isAllowedOrigin, setCors, getClientIp, checkIpRateLimit, readJsonBody } from './_guard.js';

const SEED_VIEWS = 1248;
const SEED_SAVED = 22600;
const MAX_BODY_BYTES = 1024;
// Largest single saving the site reports is CHF 40 (vouchers pages: CFSH8W 10,
// refjf7c46 35, JAN533A2 40). 200 leaves headroom and caps tampering per request.
export const MAX_SAVING_AMOUNT = 200;
export const RATE_LIMITS = { pageview: 120, saving: 20, read: 120 }; // per IP per hour

export function validAmount(amount) {
  return Number.isInteger(amount) && amount >= 1 && amount <= MAX_SAVING_AMOUNT;
}

function kvClient(url, token, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  return async (...cmd) => {
    const r = await doFetch(`${url}/${cmd.map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) throw new Error(`kv_http_${r.status}`);
    const d = await r.json();
    return d.result;
  };
}

// Core logic, dependency-injected for tests. Returns { status, body }.
export async function handleCommunityStats(method, body, { kv, limitCheck } = {}) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const cmd = kv || (url && token ? kvClient(url, token) : null);

  let scope;
  if (method === 'GET') scope = 'read';
  else if (body && body.action === 'pageview') scope = 'pageview';
  else if (body && body.action === 'saving') {
    if (!validAmount(body.amount)) return { status: 400, body: { ok: false } };
    scope = 'saving';
  } else return { status: 400, body: { ok: false } };

  const limit = await limitCheck(scope, RATE_LIMITS[scope]);
  if (limit === 'unavailable') return { status: 503, body: { ok: false } };
  if (limit === 'limited') return { status: 429, body: { ok: false } };
  if (!cmd) return { status: 503, body: { ok: false } };

  try {
    let views;
    let saved;
    if (scope === 'read') {
      [views, saved] = await Promise.all([cmd('get', 'sn:views'), cmd('get', 'sn:saved')]);
    } else if (scope === 'pageview') {
      views = await cmd('incr', 'sn:views');
      saved = await cmd('get', 'sn:saved');
    } else {
      saved = await cmd('incrby', 'sn:saved', String(body.amount));
      views = await cmd('get', 'sn:views');
    }
    return { status: 200, body: { ok: true, views: (parseInt(views) || 0) + SEED_VIEWS, saved: (parseInt(saved) || 0) + SEED_SAVED } };
  } catch (e) {
    console.error('community-stats: storage request failed:', e && e.name);
    return { status: 503, body: { ok: false } };
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  setCors(res, origin, 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!isAllowedOrigin(origin)) return res.status(403).json({ ok: false });

  let body = null;
  if (req.method === 'POST') {
    body = readJsonBody(req, MAX_BODY_BYTES);
    if (!body) return res.status(400).json({ ok: false });
  }
  const clientIp = getClientIp(req);
  const result = await handleCommunityStats(req.method, body, {
    limitCheck: (scope, limit) => checkIpRateLimit({ scope: `cs:${scope}`, limit, clientIp })
  });
  return res.status(result.status).json(result.body);
}
