// Shared community counter — backed by Vercel KV or Upstash Redis REST API
// Setup: add KV_REST_API_URL + KV_REST_API_TOKEN to Vercel env vars (from Vercel Storage → KV)
// Or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN if using Upstash directly

const SEED_VIEWS = 1248;
const SEED_SAVED = 22600;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(200).json({ views: SEED_VIEWS, saved: SEED_SAVED });
  }

  const kv = async (...cmd) => {
    const r = await fetch(`${url}/${cmd.map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const d = await r.json();
    return d.result;
  };

  try {
    if (req.method === 'GET') {
      const [views, saved] = await Promise.all([kv('get', 'sn:views'), kv('get', 'sn:saved')]);
      return res.status(200).json({ views: (parseInt(views) || 0) + SEED_VIEWS, saved: (parseInt(saved) || 0) + SEED_SAVED });
    }

    if (req.method === 'POST') {
      const { action, amount } = req.body || {};

      if (action === 'pageview') {
        const views = await kv('incr', 'sn:views');
        const saved = parseInt(await kv('get', 'sn:saved')) || 0;
        return res.status(200).json({ views: (parseInt(views) || 0) + SEED_VIEWS, saved: saved + SEED_SAVED });
      }

      if (action === 'saving' && amount > 0) {
        const saved = await kv('incrby', 'sn:saved', String(Math.floor(amount)));
        const views = parseInt(await kv('get', 'sn:views')) || 0;
        return res.status(200).json({ views: views + SEED_VIEWS, saved: (parseInt(saved) || 0) + SEED_SAVED });
      }

      return res.status(400).json({ error: 'invalid action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(200).json({ views: 0, saved: 0, error: e.message });
  }
}
