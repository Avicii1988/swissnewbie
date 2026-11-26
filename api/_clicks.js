// Aggregated voucher-click counters (not a route: Vercel ignores files in api/ that
// start with an underscore). Used by api/voucher-notify.js (write) and
// api/click-stats.js (read). Only counts — no ua, e-mail, IP or page is stored.
//
// Storage: the same Upstash/Vercel KV REST store and env variables as
// api/community-stats.js (KV_REST_API_URL/_TOKEN or UPSTASH_REDIS_REST_URL/_TOKEN).
//
// Keys (no TTL, plain counters):
//   clicks:total
//   clicks:provider:<provider>        clicks:lang:<lang>        clicks:pl:<provider>:<lang>
//   clicks:day:<YYYY-MM-DD>           clicks:day:<day>:provider:<provider>
//   clicks:day:<day>:lang:<lang>
//   clicks:first_day                  (SET NX: earliest day with a click, for `since`)

// Same provider list as js/tracking.js. Anything else is counted as "other" so a
// client cannot create an unbounded number of keys; an empty value is "unknown".
export const PROVIDERS = ['interactive-brokers', 'sunrise', 'swisscom', 'salt', 'wingo', 'yallo', 'spusu', 'lidl-connect',
  'swica', 'css', 'ubs', 'frankly', 'neon', 'yuh', 'viac', 'wise', 'smile', 'mobility', 'manor'];
export const PROVIDER_BUCKETS = [...PROVIDERS, 'other', 'unknown'];
export const LANGS = ['en', 'de', 'fr'];
export const LANG_BUCKETS = [...LANGS, 'unknown'];
export const DAYS = 31;

export function normalizeProvider(v) {
  const p = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!p) return 'unknown';
  return PROVIDERS.includes(p) ? p : 'other';
}
export function normalizeLang(v) {
  const l = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!l) return 'unknown';
  return LANGS.includes(l) ? l : 'unknown';
}
export function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function kvConfig(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token, complete: !!(url && token) };
}

// Single command via the REST path, as in api/community-stats.js.
function makeCmd({ url, token }, doFetch) {
  return async (...args) => {
    const r = await doFetch(`${url}/${args.map((a) => encodeURIComponent(String(a))).join('/')}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) throw new Error(`kv_http_${r.status}`);
    const d = await r.json();
    if (d && d.error) throw new Error('kv_error');
    return d.result;
  };
}
// MGET with many keys: the command goes in the POST body (a GET path would get too long).
function makeMget({ url, token }, doFetch) {
  return async (keys) => {
    const r = await doFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['MGET', ...keys])
    });
    if (!r.ok) throw new Error(`kv_http_${r.status}`);
    const d = await r.json();
    if (!d || d.error || !Array.isArray(d.result)) throw new Error('kv_error');
    return d.result.map((x) => Number(x) || 0);
  };
}

export function clickKeys(provider, lang, day) {
  return ['clicks:total', `clicks:provider:${provider}`, `clicks:lang:${lang}`, `clicks:pl:${provider}:${lang}`,
    `clicks:day:${day}`, `clicks:day:${day}:provider:${provider}`, `clicks:day:${day}:lang:${lang}`];
}

// Fail-soft: never throws, never blocks the caller's main flow. Returns true if counted.
export async function countClick({ provider, lang }, { env = process.env, fetchImpl, now = Date.now } = {}) {
  try {
    const cfg = kvConfig(env);
    if (!cfg.complete) return false;
    const cmd = makeCmd(cfg, fetchImpl || fetch);
    const p = normalizeProvider(provider);
    const l = normalizeLang(lang);
    const day = utcDay(now());
    const results = await Promise.allSettled([
      ...clickKeys(p, l, day).map((k) => cmd('incr', k)),
      cmd('set', 'clicks:first_day', day, 'NX')
    ]);
    return results.every((r) => r.status === 'fulfilled');
  } catch (e) {
    return false;
  }
}

function nonZero(names, values) {
  const out = {};
  names.forEach((n, i) => { if (values[i]) out[n] = values[i]; });
  return out;
}

// Read-only aggregation. Throws 'not_configured' or a storage error; the endpoint maps both to 503.
export async function readClickStats({ env = process.env, fetchImpl, now = Date.now } = {}) {
  const cfg = kvConfig(env);
  if (!cfg.complete) throw new Error('not_configured');
  const doFetch = fetchImpl || fetch;
  const cmd = makeCmd(cfg, doFetch);
  const mget = makeMget(cfg, doFetch);

  const pairs = [];
  for (const p of PROVIDER_BUCKETS) for (const l of LANG_BUCKETS) pairs.push([p, l]);
  const today = now();
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) days.push(utcDay(today - i * 86400000));

  const keys = ['clicks:total',
    ...PROVIDER_BUCKETS.map((p) => `clicks:provider:${p}`),
    ...LANG_BUCKETS.map((l) => `clicks:lang:${l}`),
    ...pairs.map(([p, l]) => `clicks:pl:${p}:${l}`)];
  for (const d of days) {
    keys.push(`clicks:day:${d}`, ...PROVIDER_BUCKETS.map((p) => `clicks:day:${d}:provider:${p}`), ...LANG_BUCKETS.map((l) => `clicks:day:${d}:lang:${l}`));
  }
  const [values, firstDay] = await Promise.all([mget(keys), cmd('get', 'clicks:first_day')]);

  let i = 0;
  const take = (n) => { const v = values.slice(i, i + n); i += n; return v; };
  const total = take(1)[0];
  const perProvider = nonZero(PROVIDER_BUCKETS, take(PROVIDER_BUCKETS.length));
  const perLang = nonZero(LANG_BUCKETS, take(LANG_BUCKETS.length));
  const pairVals = take(pairs.length);
  const perProviderLang = {};
  pairs.forEach(([p, l], k) => { if (pairVals[k]) (perProviderLang[p] = perProviderLang[p] || {})[l] = pairVals[k]; });
  const dayRows = days.map((date) => ({
    date,
    total: take(1)[0],
    per_provider: nonZero(PROVIDER_BUCKETS, take(PROVIDER_BUCKETS.length)),
    per_lang: nonZero(LANG_BUCKETS, take(LANG_BUCKETS.length))
  }));

  return {
    since: typeof firstDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(firstDay) ? firstDay : null,
    totals: { total, per_provider: perProvider, per_lang: perLang, per_provider_lang: perProviderLang },
    days: dayRows.reverse() // newest first
  };
}
