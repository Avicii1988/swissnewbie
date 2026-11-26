// registration-notify validation + country, and the new pdf-guide-notify endpoint.
// No network: global fetch is replaced by an in-memory KV plus a fake mail API.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import registrationHandler, { validateRegistration, NOTIFY_TO } from '../api/registration-notify.js';
import pdfHandler, { RATE_LIMIT_PER_ADDRESS, PDF_URLS } from '../api/pdf-guide-notify.js';
import { countryFromRequest } from '../api/_guard.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const KV = 'https://kv.test.invalid';
const MAIL = 'https://api.resend.com/emails';
const ENV_KEYS = ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
  'CSS_LEAD_IP_HASH_SECRET', 'RESEND_API_KEY', 'VERCEL_ENV'];
let store, mails, mailStatus, savedEnv, savedFetch, savedError;

beforeEach(() => {
  store = new Map(); mails = []; mailStatus = 200;
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { KV_REST_API_URL: KV, KV_REST_API_TOKEN: 't', CSS_LEAD_IP_HASH_SECRET: 's', RESEND_API_KEY: 'k', VERCEL_ENV: 'production' });
  savedFetch = globalThis.fetch; savedError = console.error; console.error = () => {};
  globalThis.fetch = async (url, opts = {}) => {
    if (url === MAIL) { mails.push(JSON.parse(opts.body)); return { ok: mailStatus < 300, status: mailStatus, json: async () => ({ id: 'm' }) }; }
    if (String(url).startsWith(KV + '/')) {
      const [cmd, ...args] = String(url).slice(KV.length + 1).split('/').map(decodeURIComponent);
      let result;
      if (cmd === 'ping') result = 'PONG';
      else if (cmd === 'incr') { result = (Number(store.get(args[0])) || 0) + 1; store.set(args[0], result); }
      else if (cmd === 'expire') result = 1;
      else throw new Error('unexpected kv command ' + cmd);
      return { ok: true, status: 200, json: async () => ({ result }) };
    }
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
async function call(handler, { method = 'POST', body, headers = {}, ip = '203.0.113.9' } = {}) {
  const req = { method, headers: { origin: 'https://www.swissnewbie.ch', 'x-forwarded-for': ip, ...headers }, body };
  const res = mockRes(); await handler(req, res); return res;
}
const reg = { name: 'Jane Doe', email: 'jane@example.com', ts: '2026-11-26T10:00:00.000Z', browserLang: 'de-CH' };
const pdf = { email: 'Jane@Example.com', name: 'Jane', lang: 'de', browserLang: 'de-CH', referrer: 'https://google.com/',
  landingPage: 'https://www.swissnewbie.ch/de/', utm: { utm_source: 'newsletter', evil: 'x' }, ts: '2026-11-26T10:00:00.000Z', website: '' };

// ---------- registration-notify ----------
test('registration-notify: empty or incomplete POST is rejected with 400 and a field list, nothing sent', async () => {
  for (const [body, fields] of [[{}, ['invalid_name', 'invalid_email', 'invalid_ts']],
    [{ name: 'Jane', email: 'not-an-email', ts: '2026-11-26T10:00:00Z' }, ['invalid_email']],
    [{ name: 'Jane', email: 'jane@example.com', ts: 'yesterday' }, ['invalid_ts']]]) {
    const r = await call(registrationHandler, { body });
    assert.equal(r.statusCode, 400);
    assert.deepEqual(r.payload, { ok: false, error: 'validation_failed', fields });
  }
  assert.equal(mails.length, 0);
  assert.equal(store.size, 0, 'invalid requests do not reach the rate limiter');
  assert.deepEqual(validateRegistration(reg), { valid: true, errors: [] });
});

test('registration-notify: country from the Vercel geo header, fallback browser language', async () => {
  const r = await call(registrationHandler, { body: reg, headers: { 'x-vercel-ip-country': 'ch' } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(mails[0].to, NOTIFY_TO);
  assert.equal(mails[0].from, 'SwissNewbie <noreply@swissnewbie.ch>');
  assert.match(mails[0].html, /Country<\/td><td[^>]*>CH \(ip\)</);
  await call(registrationHandler, { body: { ...reg, browserLang: 'fr-BE' }, ip: '203.0.113.10' });
  assert.match(mails[1].html, /Country<\/td><td[^>]*>BE \(browser language\)</);
  assert.deepEqual(countryFromRequest({ headers: {} }, 'en'), { code: '', source: '' });
  assert.deepEqual(countryFromRequest({ headers: { 'x-vercel-ip-country': '<b>' } }, 'de-AT'), { code: 'AT', source: 'browser language' });
});

test('registration-notify: a mail provider rejection is reported as failure (502), not ok', async () => {
  mailStatus = 403;
  const r = await call(registrationHandler, { body: reg });
  assert.equal(r.statusCode, 502);
  assert.deepEqual(r.payload, { ok: false });
});

// ---------- pdf-guide-notify ----------
test('pdf-guide-notify: valid request mails the visitor the PDF link and the info mail', async () => {
  const r = await call(pdfHandler, { body: pdf, headers: { 'x-vercel-ip-country': 'DE' } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.payload, { ok: true });
  assert.equal(mails.length, 2);
  const [user, info] = mails;
  assert.deepEqual(user.to, ['jane@example.com']);
  assert.equal(user.from, 'SwissNewbie <noreply@swissnewbie.ch>');
  assert.match(user.subject, /Umzugscheckliste 2026/, 'visitor mail in the requested language');
  assert.ok(user.html.includes(PDF_URLS.de), 'German PDF for lang=de');
  for (const u of Object.values(PDF_URLS)) assert.ok(fs.existsSync(path.join(ROOT, new URL(u).pathname)), u + ' exists in the repo');
  assert.deepEqual(info.to, NOTIFY_TO);
  for (const re of [/jane@example\.com/, /Jane/, /Language<\/td><td[^>]*>de</, /DE \(ip\)/, /google\.com/, /newsletter/, /2026-11-26T10:00/]) assert.match(info.html, re);
  assert.doesNotMatch(info.html, /evil/, 'only known utm keys');
});

test('pdf-guide-notify: e-mail is required; invalid lang and name are rejected; nothing sent', async () => {
  for (const [body, fields] of [[{}, ['invalid_email']], [{ email: 'x@' }, ['invalid_email']],
    [{ email: 'jane@example.com', lang: 'it', name: 'x'.repeat(61) }, ['invalid_name', 'invalid_lang']]]) {
    const r = await call(pdfHandler, { body });
    assert.equal(r.statusCode, 400);
    assert.deepEqual(r.payload, { ok: false, error: 'validation_failed', fields });
  }
  assert.equal(mails.length, 0);
});

test('pdf-guide-notify: honeypot filled -> silent ok, nothing sent', async () => {
  const r = await call(pdfHandler, { body: { ...pdf, website: 'https://spam.example' } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.payload, { ok: true });
  assert.equal(mails.length, 0);
});

test('pdf-guide-notify: per-address limit even across IPs; foreign origin and GET rejected', async () => {
  for (let i = 0; i < RATE_LIMIT_PER_ADDRESS; i++) assert.equal((await call(pdfHandler, { body: pdf, ip: `198.51.100.${i}` })).statusCode, 200);
  assert.equal((await call(pdfHandler, { body: pdf, ip: '198.51.100.99' })).statusCode, 429);
  const bad = await call(pdfHandler, { body: pdf, headers: { origin: 'https://evil.example' } });
  assert.equal(bad.statusCode, 403);
  assert.equal((await call(pdfHandler, { method: 'GET' })).statusCode, 405);
  assert.equal((await call(pdfHandler, { method: 'OPTIONS' })).statusCode, 204);
});

test('pdf-guide-notify: honest failure when the visitor mail cannot be sent or no key is set', async () => {
  mailStatus = 500;
  const r = await call(pdfHandler, { body: pdf });
  assert.equal(r.statusCode, 502);
  assert.deepEqual(r.payload, { ok: false });
  mailStatus = 200; delete process.env.RESEND_API_KEY;
  const n = await call(pdfHandler, { body: pdf, ip: '203.0.113.11' });
  assert.equal(n.statusCode, 503);
  assert.deepEqual(n.payload, { ok: false });
});

test('pdf-guide-notify: HTML in name/referrer is escaped in both mails', async () => {
  await call(pdfHandler, { body: { ...pdf, name: '<img src=x>', referrer: '"><script>x</script>' } });
  for (const m of mails) assert.doesNotMatch(m.html, /<img src=x>|<script>/);
});
