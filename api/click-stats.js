// Read-only aggregate of voucher clicks per provider and language (see api/_clicks.js).
// GET only; no write path. Contains counts only — no ua, e-mails, IPs or pages.
//
// Response (200):
//   { ok: true, since: "YYYY-MM-DD" | null,
//     totals: { total, per_provider: {..}, per_lang: {..}, per_provider_lang: { provider: { lang: n } } },
//     days: [ { date, total, per_provider: {..}, per_lang: {..} } x 31, newest first ] }
// Zero counts are left out of the maps. Missing or unreachable storage -> 503 { ok: false, error }.

import { getClientIp, checkIpRateLimit } from './_guard.js';
import { readClickStats, kvConfig } from './_clicks.js';

export const RATE_LIMIT_PER_HOUR = 60;

export default async function handler(req, res, { readImpl = readClickStats, limitImpl = checkIpRateLimit } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
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
