// Aggregated voucher-click counters (api/_clicks.js), counting in voucher-notify and
// the read-only /api/click-stats endpoint. No network: an in-memory Upstash mock
// answers both single commands (REST path) and MGET (POST body).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { countClick, readClickStats, normalizeProvider, normalizeLang, clickKeys, DAYS } from '../api/_clicks.js';
import voucherHandler, { handleVoucherNotify } from '../api/voucher-notify.js';
import clickStatsHandler from '../api/click-stats.js';

const KV = 'https://kv.test.invalid';
const MAIL = 'https://api.resend.com/emails';
const ENV_KEYS = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'CSS_LEAD_IP_HASH_SECRET', 'RESEND_API_KEY', 'VERCEL_ENV'];
const DAY = 86400000;
const T0 = Date.parse('2026-11-26T12:00:00Z');
let store, mails, mailStatus, kvDown, savedEnv, savedFetch, savedError;

function kvFetch(url, opts = {}) {
  if (kvDown) throw new Error('kv offline');
  let cmd, args;
  if (opts.method === 'POST') [cmd, ...args] = JSON.parse(opts.body);
  else [cmd, ...args] = String(url).slice(KV.length + 1).split('/').map(decodeURIComponent);
  cmd = cmd.toLowerCase();
  let result;
  if (cmd === 'ping') result = 'PONG';
  else if (cmd === 'incr') { result = (Number(store.get(args[0])) || 0) + 1; store.set(args[0], result); }
  else if (cmd === 'get') result = store.has(args[0]) ? String(store.get(args[0])) : null;
  else if (cmd === 'set') { if (args.includes('NX') && store.has(args[0])) result = null; else { store.set(args[0], args[1]); result = 'OK'; } }
  else if (cmd === 'mget') result = args.map((k) => (store.has(k) ? String(store.get(k)) : null));
  else if (cmd === 'expire') result = 1;
  else throw new Error('unexpected kv command ' + cmd);
  return { ok: true, status: 200, json: async () => ({ result }) };
}

beforeEach(() => {
  store = new Map(); mails = []; mailStatus = 200; kvDown = false;
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { KV_REST_API_URL: KV, KV_REST_API_TOKEN: 't', CSS_LEAD_IP_HASH_SECRET: 's', RESEND_API_KEY: 'k', VERCEL_ENV: 'production' });
  savedFetch = globalThis.fetch; savedError = console.error; console.error = () => {};
  globalThis.fetch = async (url, opts = {}) => {
    if (url === MAIL) { mails.push(JSON.parse(opts.body)); return { ok: mailStatus < 300, status: mailStatus, json: async () => ({ id: 'm' }) }; }
    if (String(url).startsWith(KV)) return kvFetch(url, opts);
    throw new Error('unexpected network call to ' + url);
  };
});
afterEach(() => {
  globalThis.fetch = savedFetch; console.error = savedError;
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

function mockRes() {
  return { statusCode: 0, headers: {}, payload: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; return this; }, end() { return this; } };
}
async function call(handler, { method = 'POST', body, origin = 'https://www.swissnewbie.ch', ip = '203.0.113.20' } = {}, extra) {
  const req = { method, headers: { origin, 'x-forwarded-for': ip }, body };
  const res = mockRes(); await handler(req, res, extra); return res;
}
const click = (o = {}) => ({ code: 'sunrise-mobile-family-referral', page: 'https://www.swissnewbie.ch/de/', ts: '2026-11-26T10:00:00.000Z', ua: 'Mozilla/5.0', provider: 'sunrise', lang: 'de', ...o });
const counters = () => Object.fromEntries([...store].filter(([k]) => k.startsWith('clicks:')));

// ---------- normalisation ----------
test('provider and language are normalised; unknown values cannot create new keys', () => {
  assert.equal(normalizeProvider('Sunrise'), 'sunrise');
  assert.equal(normalizeProvider('interactive-brokers'), 'interactive-brokers');
  assert.equal(normalizeProvider('random-' + 'x'.repeat(30)), 'other');
  assert.equal(normalizeProvider(''), 'unknown');
  assert.equal(normalizeProvider(undefined), 'unknown');
  assert.equal(normalizeLang('DE'), 'de');
  assert.equal(normalizeLang('it'), 'unknown');
  assert.equal(normalizeLang(''), 'unknown');
});

// ---------- counting ----------
test('countClick increments all seven counters and records the first day once', async () => {
  assert.equal(await countClick({ provider: 'sunrise', lang: 'de' }, { now: () => T0 - DAY }), true);
  assert.equal(await countClick({ provider: 'sunrise', lang: 'fr' }, { now: () => T0 }), true);
  const c = counters();
  for (const k of clickKeys('sunrise', 'de', '2026-11-25')) assert.ok(c[k] >= 1, k);
  assert.equal(c['clicks:total'], 2);
  assert.equal(c['clicks:provider:sunrise'], 2);
  assert.equal(c['clicks:lang:de'], 1);
  assert.equal(c['clicks:pl:sunrise:fr'], 1);
  assert.equal(c['clicks:day:2026-11-26'], 1);
  assert.equal(c['clicks:day:2026-11-26:provider:sunrise'], 1);
  assert.equal(c['clicks:day:2026-11-26:lang:fr'], 1);
  assert.equal(c['clicks:first_day'], '2026-11-25', 'SET NX keeps the earliest day');
});

test('voucher-notify counts after validation, also when no mail key is set or the mail fails', async () => {
  assert.equal((await call(voucherHandler, { body: click() })).statusCode, 200);
  mailStatus = 500;
  assert.equal((await call(voucherHandler, { body: click({ provider: '', lang: '' }) })).statusCode, 502);
  delete process.env.RESEND_API_KEY;
  assert.equal((await call(voucherHandler, { body: click({ provider: 'neon', lang: 'en' }) })).statusCode, 200);
  const c = counters();
  assert.equal(c['clicks:total'], 3);
  assert.equal(c['clicks:provider:sunrise'], 1);
  assert.equal(c['clicks:provider:unknown'], 1);
  assert.equal(c['clicks:lang:unknown'], 1);
  assert.equal(c['clicks:pl:neon:en'], 1);
  // stored keys and values are counts and dates only: nothing from ua/page/ts/ip
  const dump = JSON.stringify([...store]);
  for (const s of ['Mozilla', 'swissnewbie.ch/de', '203.0.113.20']) assert.ok(!dump.includes(s), s);
});

test('voucher-notify does not count invalid codes or foreign origins', async () => {
  assert.equal((await call(voucherHandler, { body: click({ code: 'free-money' }) })).statusCode, 400);
  assert.equal((await call(voucherHandler, { body: click(), origin: 'https://evil.example' })).statusCode, 403);
  assert.equal(counters()['clicks:total'], undefined);
});

test('counting is fail-soft: storage down or not configured never blocks the mail', async () => {
  const broken = async () => { throw new Error('kv offline'); };
  const r1 = await handleVoucherNotify(click(), { kvFetchImpl: broken });
  assert.deepEqual(r1, { status: 200, ok: true });
  assert.equal(mails.length, 1);
  const kvError = async () => ({ ok: false, status: 500, json: async () => ({}) });
  assert.deepEqual(await handleVoucherNotify(click(), { kvFetchImpl: kvError }), { status: 200, ok: true });
  delete process.env.KV_REST_API_URL;
  assert.equal(await countClick({ provider: 'sunrise', lang: 'de' }), false);
  assert.deepEqual(await handleVoucherNotify(click()), { status: 200, ok: true });
  assert.equal(mails.length, 3);
});

// ---------- read endpoint ----------
test('readClickStats aggregates totals, pairs and the last 31 days', async () => {
  // chronological, as in production (SET NX keeps the first day written, which is the earliest)
  const seq = [['swica', 'de', 40], ['bogus', '', 2], ['neon', 'en', 1], ['sunrise', 'de', 0], ['sunrise', 'de', 0], ['sunrise', 'fr', 0]];
  for (const [p, l, ago] of seq) await countClick({ provider: p, lang: l }, { now: () => T0 - ago * DAY });
  const s = await readClickStats({ now: () => T0 });
  assert.equal(s.since, '2026-10-17', 'earliest day ever counted, even outside the 31-day window');
  assert.equal(s.totals.total, 6);
  assert.deepEqual(s.totals.per_provider, { sunrise: 3, swica: 1, neon: 1, other: 1 });
  assert.deepEqual(s.totals.per_lang, { de: 3, fr: 1, en: 1, unknown: 1 });
  assert.deepEqual(s.totals.per_provider_lang, { sunrise: { de: 2, fr: 1 }, neon: { en: 1 }, swica: { de: 1 }, other: { unknown: 1 } });
  assert.equal(s.days.length, DAYS);
  assert.deepEqual(s.days[0], { date: '2026-11-26', total: 3, per_provider: { sunrise: 3 }, per_lang: { de: 2, fr: 1 } });
  assert.deepEqual(s.days[1], { date: '2026-11-25', total: 1, per_provider: { neon: 1 }, per_lang: { en: 1 } });
  assert.deepEqual(s.days[2].per_provider, { other: 1 });
  assert.equal(s.days[30].date, '2026-10-27');
  assert.ok(s.days.every((d) => d.date !== '2026-10-17'), 'only 31 days listed');
});

test('click-stats endpoint: GET returns the aggregate with no-store/noindex and no personal data', async () => {
  await call(voucherHandler, { body: click() });
  const r = await call(clickStatsHandler, { method: 'GET' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.payload.ok, true);
  assert.equal(r.payload.totals.total, 1);
  assert.deepEqual(r.payload.totals.per_provider_lang, { sunrise: { de: 1 } });
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-robots-tag'], 'noindex');
  assert.equal(r.headers['access-control-allow-origin'], undefined);
  assert.doesNotMatch(JSON.stringify(r.payload), /Mozilla|203\.0\.113|@|ua|page/);
});

test('click-stats endpoint: POST and OPTIONS are 405, nothing is written', async () => {
  for (const method of ['POST', 'OPTIONS', 'PUT', 'DELETE']) {
    const r = await call(clickStatsHandler, { method, body: { provider: 'sunrise' } });
    assert.equal(r.statusCode, 405, method);
    assert.equal(r.headers.allow, 'GET');
    assert.equal(r.headers['cache-control'], 'no-store');
  }
  assert.equal(store.size, 0);
});

test('click-stats endpoint: missing or unreachable storage is an honest 503, never ok:true', async () => {
  delete process.env.KV_REST_API_URL;
  const a = await call(clickStatsHandler, { method: 'GET' });
  assert.equal(a.statusCode, 503);
  assert.deepEqual(a.payload, { ok: false, error: 'storage_not_configured' });
  process.env.KV_REST_API_URL = KV;
  kvDown = true;
  const b = await call(clickStatsHandler, { method: 'GET' });
  assert.equal(b.statusCode, 503);
  assert.equal(b.payload.ok, false);
  kvDown = false;
  const c = await call(clickStatsHandler, { method: 'GET' }, { readImpl: async () => { throw new Error('kv_http_500'); } });
  assert.deepEqual(c.payload, { ok: false, error: 'storage_unavailable' });
});

test('click-stats endpoint: rate limited per IP', async () => {
  const r = await call(clickStatsHandler, { method: 'GET' }, { limitImpl: async () => 'limited' });
  assert.equal(r.statusCode, 429);
  assert.equal(r.payload.ok, false);
});
