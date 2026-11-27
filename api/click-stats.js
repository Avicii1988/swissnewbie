// Read-only aggregate of voucher clicks per provider and language (see api/_clicks.js).
// GET only; no write path. Contains counts only — no ua, e-mails, IPs or pages.
//
// Response (200):
//   { ok: true, since: "YYYY-MM-DD" | null,
//     totals: { total, per_provider: {..}, per_lang: {..}, per_provider_lang: { provider: { lang: n } } },
//     days: [ { date, total, per_provider: {..}, per_lang: {..} } x 31, newest first ] }
// Zero counts are left out of the maps. Missing or unreachable storage -> 503 { ok: false, error }.
//
// Access: only with the header "Authorization: Bearer <token>", compared in constant time
// against the env variable CLICK_STATS_TOKEN. A token in the URL/query is never accepted.
// Missing or wrong token -> 401 { ok: false, error: "unauthorized" }; if CLICK_STATS_TOKEN
// is not set, the endpoint stays closed (503). There is no fallback token.

import crypto from 'node:crypto';
import { getClientIp, checkIpRateLimit } from './_guard.js';
import { readClickStats, kvConfig } from './_clicks.js';

export const RATE_LIMIT_PER_HOUR = 60;
export const TOKEN_ENV = 'CLICK_STATS_TOKEN';

// true only for "Authorization: Bearer <token>" matching the configured token
export function isAuthorized(req, expected) {
  if (typeof expected !== 'string' || !expected) return false;
  const header = req && req.headers ? req.headers.authorization : undefined;
  if (typeof header !== 'string') return false;
  const m = header.match(/^Bearer ([^\s]+)$/);
  if (!m) return false;
  const given = Buffer.from(m[1], 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}

export default async function handler(req, res, { readImpl = readClickStats, limitImpl = checkIpRateLimit } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  // closed by default: no configured token -> nobody gets in
  const expected = process.env[TOKEN_ENV];
  if (!expected) return res.status(503).json({ ok: false, error: 'unauthorized' });
  if (!isAuthorized(req, expected)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  if (!kvConfig().complete) return res.status(503).json({ ok: false, error: 'storage_not_configured' });

  const limit = await limitImpl({ scope: 'cs', limit: RATE_LIMIT_PER_HOUR, clientIp: getClientIp(req) });
  if (limit === 'unavailable') return res.status(503).json({ ok: false, error: 'storage_unavailable' });
  if (limit === 'limited') return res.status(429).json({ ok: false, error: 'rate_limited' });

  try {
    const stats = await readImpl();
    return res.status(200).json({ ok: true, ...stats });
  } catch (e) {
    console.error('click-stats: read failed:', e && e.message === 'not_configured' ? 'not_configured' : 'storage_error');
    return res.status(503).json({ ok: false, error: 'storage_unavailable' });
  }
}
