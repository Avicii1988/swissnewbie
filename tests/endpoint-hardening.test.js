// Mock-request tests for the hardened notify/stats endpoints (B1 B2 B4 B5).
// No network: global fetch is replaced by an in-memory KV plus a fake mail API,
// and any other URL fails the test.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import voucherHandler, { ALLOWED_CODES, RATE_LIMIT_PER_HOUR as VN_LIMIT, FIELD_LIMITS } from '../api/voucher-notify.js';
import registrationHandler, { RATE_LIMIT_PER_HOUR as RN_LIMIT } from '../api/registration-notify.js';
import statsHandler, { MAX_SAVING_AMOUNT, RATE_LIMITS } from '../api/community-stats.js';
import { isAllowedOrigin } from '../api/_guard.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KV = 'https://kv.test.invalid';
const MAIL = 'https://api.resend.com/emails';
const ENV_KEYS = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'CSS_LEAD_IP_HASH_SECRET', 'RESEND_API_KEY', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_BRANCH_URL'];

let store, mails, kvDown, mailStatus, savedEnv, savedFetch, savedError, logged;

beforeEach(() => {
  store = new Map(); mails = []; kvDown = false; mailStatus = 200; logged = [];
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { KV_REST_API_URL: KV, KV_REST_API_TOKEN: 'kv-test-token', CSS_LEAD_IP_HASH_SECRET: 'hash-test-secret',
    RESEND_API_KEY: 'mail-test-key', VERCEL_ENV: 'production' });
  savedFetch = globalThis.fetch;
  savedError = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  globalThis.fetch = async (url, opts = {}) => {
    if (url === MAIL) {
      mails.push(JSON.parse(opts.body));
      return { ok: mailStatus < 300, status: mailStatus, json: async () => ({ id: 'mail_1', message: 'provider detail' }) };
    }
    if (String(url).startsWith(KV + '/')) {
      if (kvDown) throw new Error('kv offline');
      const [cmd, ...args] = String(url).slice(KV.length + 1).split('/').map(decodeURIComponent);
      let result;
      if (cmd === 'ping') result = 'PONG';
      else if (cmd === 'incr') { result = (Number(store.get(args[0])) || 0) + 1; store.set(args[0], result); }
      else if (cmd === 'incrby') { result = (Number(store.get(args[0])) || 0) + Number(args[1]); store.set(args[0], result); }
      else if (cmd === 'get') result = store.has(args[0]) ? String(store.get(args[0])) : null;
      else if (cmd === 'expire') result = 1;
      else throw new Error('unexpected kv command ' + cmd);
      return { ok: true, status: 200, json: async () => ({ result }) };
    }
    throw new Error('unexpected network call to ' + url);
  };
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  console.error = savedError;
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
});

function mockRes() {
  return {
    statusCode: 0, headers: {}, payload: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; return this; },
    end() { return this; }
  };
}
async function call(handler, { method = 'POST', origin = 'https://www.swissnewbie.ch', body, ip = '203.0.113.7' } = {}) {
  const headers = { 'x-forwarded-for': ip };
  if (origin) headers.origin = origin;
  const req = { method, headers, body };
  const res = mockRes();
  await handler(req, res);
  return res;
}
const okVoucher = { code: 'swica-health-referral', page: 'https://www.swissnewbie.ch/de/health-insurance/', ts: '2026-11-19T10:00:00.000Z', ua: 'Mozilla/5.0' };

// ---------- origin allowlist (B2) ----------
test('origin allowlist: production domains only in production; preview and localhost only outside production', () => {
  assert.equal(isAllowedOrigin('https://www.swissnewbie.ch', { VERCEL_ENV: 'production' }), true);
  assert.equal(isAllowedOrigin('https://swissnewbie.ch', { VERCEL_ENV: 'production' }), true);
  assert.equal(isAllowedOrigin('https://evil.example', { VERCEL_ENV: 'production' }), false);
  assert.equal(isAllowedOrigin('https://swissnewbie.ch.evil.example', { VERCEL_ENV: 'production' }), false);
  assert.equal(isAllowedOrigin('http://www.swissnewbie.ch', { VERCEL_ENV: 'production' }), false);
  assert.equal(isAllowedOrigin(undefined, { VERCEL_ENV: 'production' }), false);
  const preview = { VERCEL_ENV: 'preview', VERCEL_URL: 'swissnewbie-abc123.vercel.app', VERCEL_BRANCH_URL: 'swissnewbie-git-main.vercel.app' };
  assert.equal(isAllowedOrigin('https://swissnewbie-abc123.vercel.app', preview), true);
  assert.equal(isAllowedOrigin('https://swissnewbie-git-main.vercel.app', preview), true);
  assert.equal(isAllowedOrigin('https://other-project.vercel.app', preview), false);
  assert.equal(isAllowedOrigin('https://swissnewbie-abc123.vercel.app', { ...preview, VERCEL_ENV: 'production' }), false);
  assert.equal(isAllowedOrigin('http://localhost:3000', { VERCEL_ENV: 'development' }), true);
  assert.equal(isAllowedOrigin('http://localhost:3000', { VERCEL_ENV: 'production' }), false);
});

for (const [name, handler, body] of [
  ['voucher-notify', voucherHandler, okVoucher],
  ['registration-notify', registrationHandler, { name: 'Test User', ts: '2026-11-19T10:00:00.000Z' }],
  ['community-stats', statsHandler, { action: 'pageview' }],
]) {
  test(`${name}: allowed origin gets ACAO echo; foreign origin is rejected with 403 and no side effects`, async () => {
    const good = await call(handler, { body });
    assert.equal(good.statusCode, 200);
    assert.equal(good.payload.ok, true);
    assert.equal(good.headers['access-control-allow-origin'], 'https://www.swissnewbie.ch');
    const mailsBefore = mails.length, keysBefore = store.size;
    const bad = await call(handler, { origin: 'https://evil.example', body });
    assert.equal(bad.statusCode, 403);
    assert.deepEqual(bad.payload, { ok: false });
    assert.equal(bad.headers['access-control-allow-origin'], undefined, 'never "*" and never the foreign origin');
    assert.equal(mails.length, mailsBefore);
    assert.equal(store.size, keysBefore);
    const none = await call(handler, { origin: null, body });
    assert.equal(none.statusCode, 403);
  });

  test(`${name}: KV unreachable -> fails closed with 503 {ok:false}`, async () => {
    kvDown = true;
    const r = await call(handler, { body });
    assert.equal(r.statusCode, 503);
    assert.deepEqual(r.payload, { ok: false });
    assert.equal(mails.length, 0);
  });

  test(`${name}: KV or hash secret not configured -> fails closed`, async () => {
    delete process.env.CSS_LEAD_IP_HASH_SECRET;
    const r = await call(handler, { body });
    assert.equal(r.statusCode, 503);
    assert.deepEqual(r.payload, { ok: false });
  });
}

// ---------- rate limits (B2/B4) ----------
test('voucher-notify: rate limit per hashed IP, other IPs unaffected', async () => {
  for (let i = 0; i < VN_LIMIT; i++) assert.equal((await call(voucherHandler, { body: okVoucher })).statusCode, 200);
  const over = await call(voucherHandler, { body: okVoucher });
  assert.equal(over.statusCode, 429);
  assert.deepEqual(over.payload, { ok: false });
  assert.equal(mails.length, VN_LIMIT);
  assert.equal((await call(voucherHandler, { body: okVoucher, ip: '198.51.100.9' })).statusCode, 200);
  assert.ok([...store.keys()].every((k) => !k.includes('203.0.113.7')), 'raw IP never stored');
});

test('registration-notify: rate limit', async () => {
  const body = { name: 'Test User', ts: '2026-11-19T10:00:00.000Z' };
  for (let i = 0; i < RN_LIMIT; i++) assert.equal((await call(registrationHandler, { body })).statusCode, 200);
  assert.equal((await call(registrationHandler, { body })).statusCode, 429);
  assert.equal(mails.length, RN_LIMIT);
});

test('community-stats: pageview and saving limits are separate', async () => {
  for (let i = 0; i < RATE_LIMITS.saving; i++) assert.equal((await call(statsHandler, { body: { action: 'saving', amount: 40 } })).statusCode, 200);
  assert.equal((await call(statsHandler, { body: { action: 'saving', amount: 40 } })).statusCode, 429);
  assert.equal((await call(statsHandler, { body: { action: 'pageview' } })).statusCode, 200);
});

// ---------- B1: malicious input ----------
test('voucher-notify: HTML and line breaks are escaped / removed, subject is clean', async () => {
  const r = await call(voucherHandler, { body: {
    code: 'swica-health-referral',
    page: 'https://www.swissnewbie.ch/<script>alert(1)</script>\r\nBcc: x@evil.example',
    ts: '<img src=x onerror=alert(1)>',
    ua: '"><a href="https://evil.example">click</a>\n' + 'A'.repeat(1000)
  } });
  assert.equal(r.statusCode, 200);
  const m = mails[0];
  assert.doesNotMatch(m.html, /<script|<img|<a href="https:\/\/evil/);
  assert.match(m.html, /&lt;script&gt;/);
  assert.doesNotMatch(m.html, /\r|Bcc: x@evil\.example\n/);
  assert.doesNotMatch(m.subject, /[\r\n]/);
  assert.ok(m.subject.length <= 100);
  assert.ok(!m.html.includes('A'.repeat(FIELD_LIMITS.ua + 1)), 'ua length-limited');
});

test('voucher-notify: oversized body is rejected without sending', async () => {
  const r = await call(voucherHandler, { body: { ...okVoucher, ua: 'A'.repeat(5000) } });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(r.payload, { ok: false });
  assert.equal(mails.length, 0);
});

test('voucher-notify: codes outside the allowlist are rejected without sending', async () => {
  for (const code of ['<b>x</b>', 'free-money', 'swica-health-referral\nX', '', 'A'.repeat(500)]) {
    const r = await call(voucherHandler, { body: { ...okVoucher, code } });
    assert.equal(r.statusCode, 400, code);
    assert.deepEqual(r.payload, { ok: false });
  }
  assert.equal(mails.length, 0);
});

test('voucher-notify: allowlist covers every code the site pages can send', () => {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', 'api', 'tests'].includes(e.name)) continue;
    const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.html')) files.push(p);
  } })(ROOT);
  const blockEnd = (s, start) => { const re = /<div\b|<\/div>/g; re.lastIndex = start; let d = 0, m;
    while ((m = re.exec(s))) { if (m[0] === '</div>') { d--; if (d === 0) return re.lastIndex; } else d++; } return s.length; };
  const dec = (t) => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const sent = new Set();
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/data-voucher-id="([^"]+)"/g)) sent.add(m[1]);
    for (const m of s.matchAll(/copyCode\(this,\s*'([^']+)'\)/g)) sent.add(m[1]);
    for (const m of s.matchAll(/<div class="(?:vg-card|voucher-strip)[^"]*"/g)) {
      const blk = s.slice(m.index, blockEnd(s, m.index));
      if (/data-voucher-id=/.test(blk) || !/class="(vg-link|vs-link)"|class="vg-actions"/.test(blk)) continue;
      const nm = blk.match(/<div class="(?:vg-name|vs-name)">([\s\S]*?)<\/div>/);
      if (nm) sent.add(dec(nm[1]).trim().replace(/\s+/g, '-').slice(0, 20));
    }
  }
  const missing = [...sent].filter((c) => !ALLOWED_CODES.has(c));
  assert.deepEqual(missing, []);
});

// ---------- B4: amount validation ----------
test('community-stats: only whole positive amounts up to the cap', async () => {
  for (const amount of [0, -5, 1.5, '40', MAX_SAVING_AMOUNT + 1, 1e9, null]) {
    const r = await call(statsHandler, { body: { action: 'saving', amount } });
    assert.equal(r.statusCode, 400, String(amount));
    assert.deepEqual(r.payload, { ok: false });
  }
  const ok = await call(statsHandler, { body: { action: 'saving', amount: MAX_SAVING_AMOUNT } });
  assert.equal(ok.statusCode, 200);
  assert.equal(store.get('sn:saved'), MAX_SAVING_AMOUNT);
  assert.equal(typeof ok.payload.views, 'number');
  assert.equal(typeof ok.payload.saved, 'number');
});

// ---------- B5: no provider data or error text to the browser ----------
test('voucher-notify and registration-notify return only {ok} — never provider data or error text', async () => {
  const v = await call(voucherHandler, { body: okVoucher });
  assert.deepEqual(v.payload, { ok: true });
  const r = await call(registrationHandler, { body: { name: 'Test User' } });
  assert.deepEqual(r.payload, { ok: true });
  mailStatus = 500;
  const vf = await call(voucherHandler, { body: okVoucher });
  assert.deepEqual(vf.payload, { ok: false });
  const mock = globalThis.fetch; // in-memory mock, never the real fetch
  globalThis.fetch = async (url, opts) => { if (url === MAIL) throw new Error('secret-ish provider failure'); return mock(url, opts); };
  const rf = await call(registrationHandler, { body: { name: 'Test User' } });
  assert.equal(rf.statusCode, 502);
  assert.deepEqual(rf.payload, { ok: false });
  assert.ok(logged.every((l) => !l.includes('secret-ish')), 'error text not logged');
  assert.ok(!JSON.stringify([v, r, vf, rf].map((x) => x.payload)).includes('provider'));
});

test('community-stats: storage error returns {ok:false} only', async () => {
  // limit check passes, then the counter command fails
  globalThis.fetch = (orig => async (url, opts) => {
    if (String(url).includes('/incr/sn%3Aviews') || String(url).includes('/incr/sn:views')) throw new Error('boom detail');
    return orig(url, opts);
  })(globalThis.fetch);
  const r = await call(statsHandler, { body: { action: 'pageview' } });
  assert.equal(r.statusCode, 503);
  assert.deepEqual(r.payload, { ok: false });
  assert.ok(logged.every((l) => !l.includes('boom detail')), 'no error text in logs either');
});
