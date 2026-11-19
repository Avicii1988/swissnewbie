// Shared request guard for the public notify/stats endpoints (not a route:
// Vercel ignores files in api/ that start with an underscore).
//
// Same pattern as api/css-lead-notify.js:
// - origin allowlist (production domains; Vercel preview/local only outside production)
// - per-IP rate limit in KV: HMAC-hashed IP (CSS_LEAD_IP_HASH_SECRET), hourly bucket,
//   INCR + EXPIRE NX 3600
// - fails closed: if KV or the hash secret is missing, or KV does not answer a PING,
//   the request is rejected (like css-lead-notify's 503 storage_unavailable/not_configured).

import { makeKvClient, hashIp } from './css-lead-notify.js';

export const PROD_ORIGINS = ['https://www.swissnewbie.ch', 'https://swissnewbie.ch'];

function isProduction() {
  return process.env.VERCEL_ENV === 'production';
}

export function isAllowedOrigin(origin, env = process.env) {
  if (!origin || typeof origin !== 'string') return false;
  if (PROD_ORIGINS.includes(origin)) return true;
  if (env.VERCEL_ENV === 'production') return false;
  // Vercel preview deployments: only this deployment's own URLs.
  const previewHosts = [env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter(Boolean);
  if (previewHosts.some((h) => origin === `https://${h}`)) return true;
  // Local development (same rule as css-lead-notify).
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function setCors(res, origin, methods = 'POST, OPTIONS') {
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

export function guardConfig(env = process.env) {
  const kvUrl = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const kvToken = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const ipHashSecret = env.CSS_LEAD_IP_HASH_SECRET;
  return { kvUrl, kvToken, ipHashSecret, complete: !!(kvUrl && kvToken && ipHashSecret) };
}

// Returns 'ok' | 'limited' | 'unavailable'.
// `scope` keeps buckets apart per endpoint/action; `limit` is requests per IP per hour.
export async function checkIpRateLimit({ scope, limit, clientIp, kv, config, now }) {
  const cfg = config || guardConfig();
  if (!cfg.complete) return 'unavailable';
  const client = kv || makeKvClient(cfg.kvUrl, cfg.kvToken);
  if (!(await client.ping())) return 'unavailable';
  const nowMs = now ? now() : Date.now();
  const bucket = Math.floor(nowMs / 3600000);
  const key = `${scope}:rl:${hashIp(clientIp || 'unknown', cfg.ipHashSecret)}:${bucket}`;
  const count = await client.incr(key);
  if (count === null) return 'unavailable'; // KV error during the count itself: fail closed
  await client.expireNx(key, 3600);
  return count <= limit ? 'ok' : 'limited';
}

// Parses req.body (object or JSON string) with a byte limit. Returns the object or null.
export function readJsonBody(req, maxBytes) {
  let body = req.body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > maxBytes) return null;
    try { body = JSON.parse(body); } catch (e) { return null; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > maxBytes) return null;
  return body;
}
