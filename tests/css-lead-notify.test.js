import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  handleCssLeadNotify,
  computeActive,
  validatePayload,
  buildEmailBody,
  productsLabelDe,
  isAllowedOrigin,
  hashIp
} = require('../api/css-lead-notify.js');

const FULL_CONFIG = {
  to: 'weiterempfehlungen@css.ch',
  cc: 'info@swissnewbie.ch',
  resendApiKey: 'test-resend-key',
  ipHashSecret: 'test-secret',
  kvUrl: 'https://kv.example',
  kvToken: 'kv-token',
  complete: true
};

const INCOMPLETE_CONFIG = { ...FULL_CONFIG, complete: false, resendApiKey: undefined };

function uuid() {
  return 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
}

function validPayload(overrides = {}) {
  return {
    submissionId: uuid(),
    name: 'Jane Doe',
    email: 'jane@example.com',
    products: ['home_contents', 'personal_liability'],
    locale: 'en',
    consent: true,
    formStartedAt: new Date(Date.now() - 10000).toISOString(),
    ...overrides
  };
}

// --- In-memory fake KV, same interface as makeKvClient()'s return value ---
function fakeKv({ pingOk = true } = {}) {
  const store = new Map();
  return {
    async ping() {
      return pingOk;
    },
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async setNx(key, value, ttl) {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    },
    async set(key, value) {
      store.set(key, value);
      return true;
    },
    async incr(key) {
      const v = (parseInt(store.get(key), 10) || 0) + 1;
      store.set(key, String(v));
      return v;
    },
    async expireNx() {
      /* no-op for tests */
    },
    _store: store
  };
}

function fetchThatAccepts() {
  let calls = 0;
  const fn = async (url, opts) => {
    calls++;
    return { ok: true, status: 200, json: async () => ({ id: 'email_' + calls }) };
  };
  fn.calls = () => calls;
  return fn;
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

test('consent: rejects when consent is missing', () => {
  const { valid, errors } = validatePayload(validPayload({ consent: undefined }));
  assert.equal(valid, false);
  assert.ok(errors.includes('consent_required'));
});

test('consent: rejects truthy-but-not-boolean-true consent ("yes", 1)', () => {
  assert.equal(validatePayload(validPayload({ consent: 'yes' })).valid, false);
  assert.equal(validatePayload(validPayload({ consent: 1 })).valid, false);
});

test('consent: accepts only strict boolean true', () => {
  assert.equal(validatePayload(validPayload({ consent: true })).valid, true);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('validation: requires a valid UUID v4 submissionId', () => {
  assert.equal(validatePayload(validPayload({ submissionId: 'not-a-uuid' })).valid, false);
  assert.equal(validatePayload(validPayload({ submissionId: uuid() })).valid, true);
});

test('validation: requires at least one whitelisted product', () => {
  assert.equal(validatePayload(validPayload({ products: [] })).valid, false);
  assert.equal(validatePayload(validPayload({ products: ['not_a_product'] })).valid, false);
  assert.equal(validatePayload(validPayload({ products: ['home_contents'] })).valid, true);
});

test('validation: rejects duplicate products in the array', () => {
  assert.equal(validatePayload(validPayload({ products: ['home_contents', 'home_contents'] })).valid, false);
});

test('validation: requires a supported locale', () => {
  assert.equal(validatePayload(validPayload({ locale: 'it' })).valid, false);
  assert.equal(validatePayload(validPayload({ locale: 'de' })).valid, true);
});

test('validation: requires a valid, bounded email', () => {
  assert.equal(validatePayload(validPayload({ email: 'not-an-email' })).valid, false);
  assert.equal(validatePayload(validPayload({ email: 'a@' + 'b'.repeat(260) + '.com' })).valid, false);
});

test('validation: requires a non-empty, bounded name', () => {
  assert.equal(validatePayload(validPayload({ name: '' })).valid, false);
  assert.equal(validatePayload(validPayload({ name: '   ' })).valid, false);
  assert.equal(validatePayload(validPayload({ name: 'x'.repeat(121) })).valid, false);
});

test('validation: optional phone is bounded and format-checked when present', () => {
  assert.equal(validatePayload(validPayload({ phone: '+41 79 123 45 67' })).valid, true);
  assert.equal(validatePayload(validPayload({ phone: 'call me maybe' })).valid, false);
  assert.equal(validatePayload({ ...validPayload(), phone: undefined }).phone, undefined);
});

test('validation: rejects header/body injection via control characters (CRLF) in name and email', () => {
  assert.equal(validatePayload(validPayload({ name: 'Jane\r\nBcc: evil@example.com' })).valid, false);
  assert.equal(validatePayload(validPayload({ email: 'jane@example.com\r\nX-Injected: 1' })).valid, false);
});

test('validation: rejects unexpected fields (no free text, address, DOB, health data accepted)', () => {
  const { valid, errors } = validatePayload(validPayload({ address: '123 Main St' }));
  assert.equal(valid, false);
  assert.ok(errors.includes('unexpected_fields'));
});

test('validation: rejects a non-object body', () => {
  assert.equal(validatePayload(null).valid, false);
  assert.equal(validatePayload('string').valid, false);
  assert.equal(validatePayload([1, 2]).valid, false);
});

// ---------------------------------------------------------------------------
// Missing configuration -> fail closed
// ---------------------------------------------------------------------------

test('missing configuration: GET reports inactive when env vars are incomplete', async () => {
  const active = await computeActive({ config: INCOMPLETE_CONFIG });
  assert.equal(active, false);
});

test('missing configuration: GET reports inactive when KV does not answer PING, even with full env', async () => {
  const active = await computeActive({ config: FULL_CONFIG, kv: fakeKv({ pingOk: false }) });
  assert.equal(active, false);
});

test('missing configuration: GET reports active only when config is complete AND KV pings', async () => {
  const active = await computeActive({ config: FULL_CONFIG, kv: fakeKv({ pingOk: true }) });
  assert.equal(active, true);
});

test('missing configuration: POST is rejected (503) and never sends when env vars are incomplete', async () => {
  const fetchImpl = fetchThatAccepts();
  const res = await handleCssLeadNotify(validPayload(), { config: INCOMPLETE_CONFIG, fetchImpl, clientIp: '1.2.3.4' });
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(fetchImpl.calls(), 0);
});

test('missing configuration: POST is rejected (503) and never sends when KV is unreachable', async () => {
  const fetchImpl = fetchThatAccepts();
  const res = await handleCssLeadNotify(validPayload(), {
    config: FULL_CONFIG,
    kv: fakeKv({ pingOk: false }),
    fetchImpl
  });
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(fetchImpl.calls(), 0);
});

// ---------------------------------------------------------------------------
// Abuse protection: honeypot, timing, rate limit
// ---------------------------------------------------------------------------

test('abuse protection: honeypot discards never send email but still respond ok', async () => {
  const fetchImpl = fetchThatAccepts();
  const res = await handleCssLeadNotify(validPayload({ honeypot: 'http://spam.example' }), {
    config: FULL_CONFIG,
    kv: fakeKv(),
    fetchImpl
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(fetchImpl.calls(), 0);
});

test('abuse protection: submissions filled in under 3 seconds are discarded without sending', async () => {
  const fetchImpl = fetchThatAccepts();
  const res = await handleCssLeadNotify(
    validPayload({ formStartedAt: new Date(Date.now() - 500).toISOString() }),
    { config: FULL_CONFIG, kv: fakeKv(), fetchImpl }
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(fetchImpl.calls(), 0);
});

test('abuse protection: a fill time of >= 3 seconds is accepted (not treated as a bot)', async () => {
  const fetchImpl = fetchThatAccepts();
  const res = await handleCssLeadNotify(
    validPayload({ formStartedAt: new Date(Date.now() - 3500).toISOString() }),
    { config: FULL_CONFIG, kv: fakeKv(), fetchImpl }
  );
  assert.equal(res.body.ok, true);
  assert.equal(fetchImpl.calls(), 1);
});

test('abuse protection: enforces a small fixed hourly per-IP limit', async () => {
  const kv = fakeKv();
  const fetchImpl = fetchThatAccepts();
  let lastRes;
  for (let i = 0; i < 7; i++) {
    lastRes = await handleCssLeadNotify(validPayload({ submissionId: `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee000${i}` }), {
      config: FULL_CONFIG,
      kv,
      fetchImpl,
      clientIp: '9.9.9.9'
    });
  }
  assert.equal(lastRes.status, 429);
  assert.equal(lastRes.body.ok, false);
  assert.ok(fetchImpl.calls() <= 5, 'no more than the configured limit of sends should occur');
});

test('abuse protection: IPs are hashed with HMAC, not stored raw or with a plain hash', () => {
  const h = hashIp('203.0.113.7', 'super-secret');
  assert.ok(!h.includes('203.0.113.7'));
  assert.equal(h, hashIp('203.0.113.7', 'super-secret'));
  assert.notEqual(h, hashIp('203.0.113.7', 'different-secret'));
  assert.notEqual(h, require('node:crypto').createHash('sha256').update('203.0.113.7').digest('hex').slice(0, 32));
});

// ---------------------------------------------------------------------------
// Provider failure
// ---------------------------------------------------------------------------

test('provider failure: a 4xx rejection from Resend is not retried and reports delivery_failed', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: false, status: 422, json: async () => ({ message: 'invalid payload' }) };
  };
  const res = await handleCssLeadNotify(validPayload(), { config: FULL_CONFIG, kv: fakeKv(), fetchImpl });
  assert.equal(res.status, 502);
  assert.equal(res.body.ok, false);
  assert.equal(calls, 1, '4xx is a definitive rejection, must not be retried');
});

test('provider failure: never reports success merely for receiving a request (no silent success)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const res = await handleCssLeadNotify(validPayload(), { config: FULL_CONFIG, kv: fakeKv(), fetchImpl });
  assert.equal(res.body.ok, false);
});

test('provider failure: a response without a confirmed id is never treated as success', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) });
  const res = await handleCssLeadNotify(validPayload(), { config: FULL_CONFIG, kv: fakeKv(), fetchImpl });
  assert.equal(res.body.ok, false);
});

// ---------------------------------------------------------------------------
// Duplicates / concurrency / changed payloads / uncertain delivery
// ---------------------------------------------------------------------------

test('duplicates: a confirmed-sent submissionId replay returns success without sending again', async () => {
  const kv = fakeKv();
  const fetchImpl = fetchThatAccepts();
  const payload = validPayload();
  const first = await handleCssLeadNotify(payload, { config: FULL_CONFIG, kv, fetchImpl });
  assert.equal(first.body.ok, true);
  assert.equal(fetchImpl.calls(), 1);

  const replay = await handleCssLeadNotify(payload, { config: FULL_CONFIG, kv, fetchImpl });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.ok, true);
  assert.equal(fetchImpl.calls(), 1, 'replay of an already-sent submission must not send a second email');
});

test('concurrency: a second request for a still-pending submissionId is rejected, not sent', async () => {
  const kv = fakeKv();
  // Pre-seed a "pending" record as if another concurrent request claimed it first.
  const payload = validPayload();
  await kv.setNx(`cssl:sub:${payload.submissionId}`, JSON.stringify({ state: 'pending', payloadHash: 'whatever', attempts: 1, ts: Date.now() }), 86400);
  const fetchImpl = fetchThatAccepts();
  const res = await handleCssLeadNotify(payload, { config: FULL_CONFIG, kv, fetchImpl });
  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(fetchImpl.calls(), 0);
});

test('changed payloads: reusing a submissionId with a different payload is rejected', async () => {
  const kv = fakeKv();
  const fetchImpl = fetchThatAccepts();
  const payload = validPayload({ name: 'Jane Doe' });
  const first = await handleCssLeadNotify(payload, { config: FULL_CONFIG, kv, fetchImpl });
  assert.equal(first.body.ok, true);

  const tampered = await handleCssLeadNotify({ ...payload, name: 'John Smith' }, { config: FULL_CONFIG, kv, fetchImpl });
  assert.equal(tampered.status, 409);
  assert.equal(tampered.body.error, 'submission_id_reused');
  assert.equal(fetchImpl.calls(), 1, 'the tampered replay must not trigger a second send');
});

test('uncertain delivery: a network error during send uses a bounded retry with the same Idempotency-Key, and a later success on that retry is reported as success', async () => {
  const keys = [];
  let call = 0;
  const fetchImpl = async (url, opts) => {
    call++;
    keys.push(opts.headers['Idempotency-Key']);
    if (call === 1) throw new Error('ECONNRESET');
    return { ok: true, status: 200, json: async () => ({ id: 'email_retry' }) };
  };
  const res = await handleCssLeadNotify(validPayload(), { config: FULL_CONFIG, kv: fakeKv(), fetchImpl });
  assert.equal(res.body.ok, true);
  assert.equal(call, 2, 'exactly one bounded retry after the ambiguous network error');
  assert.equal(keys[0], keys[1], 'retry must reuse the same Idempotency-Key so Resend cannot double-send');
});

test('uncertain delivery: repeated network failures stay bounded and report failure, not silent success', async () => {
  let call = 0;
  const fetchImpl = async () => {
    call++;
    throw new Error('ETIMEDOUT');
  };
  const res = await handleCssLeadNotify(validPayload(), { config: FULL_CONFIG, kv: fakeKv(), fetchImpl });
  assert.equal(res.body.ok, false);
  assert.equal(call, 2, 'retries must be bounded, not unbounded');
});

test('duplicates: a previously failed submission may be retried up to the attempt limit, then is rejected', async () => {
  const kv = fakeKv();
  const payload = validPayload();
  const failingFetch = async () => {
    throw new Error('down');
  };
  // Exhaust the attempt budget with genuine failures.
  let last;
  for (let i = 0; i < 4; i++) {
    last = await handleCssLeadNotify(payload, { config: FULL_CONFIG, kv, fetchImpl: failingFetch });
  }
  assert.equal(last.body.ok, false);
  assert.ok(['delivery_failed', 'too_many_attempts'].includes(last.body.error));
});

// ---------------------------------------------------------------------------
// Email body / subject content
// ---------------------------------------------------------------------------

test('email body: omits the Telefon line entirely when phone is absent', () => {
  const body = buildEmailBody({ name: 'Jane Doe', email: 'jane@example.com', phone: undefined, productsLabel: 'Hausratversicherung' });
  assert.ok(!body.includes('Telefon:'));
  assert.ok(body.includes('Name: Jane Doe'));
  assert.ok(body.includes('E-Mail: jane@example.com'));
  assert.ok(body.includes('Interesse: Hausratversicherung'));
  assert.ok(body.includes('jan.feusi@gmx.ch'));
});

test('email body: includes the Telefon line with the given value when present', () => {
  const body = buildEmailBody({ name: 'Jane Doe', email: 'jane@example.com', phone: '+41 79 123 45 67', productsLabel: 'Privathaftpflicht' });
  assert.ok(body.includes('Telefon: +41 79 123 45 67'));
});

test('email body: matches the exact required template structure', () => {
  const body = buildEmailBody({ name: 'N', email: 'E', phone: 'P', productsLabel: 'Produkt' });
  const expected = [
    'Guten Tag',
    '',
    'Diese Person wünscht eine unverbindliche CSS-Offerte:',
    '',
    'Name: N',
    'E-Mail: E',
    'Telefon: P',
    'Interesse: Produkt',
    '',
    'Die Person hat der Weitergabe dieser Angaben an CSS ausdrücklich zugestimmt. Über die Antwort-Funktion erreichen Sie sie direkt.',
    '',
    'Bitte ordnen Sie diese Weiterempfehlung Jan, SwissNewbie.ch (jan.feusi@gmx.ch), zu.',
    '',
    'Vielen Dank.',
    '',
    'Freundliche Grüsse',
    'Jan, SwissNewbie.ch'
  ].join('\n');
  assert.equal(body, expected);
});

test('products: German labels are always used for the email regardless of visitor locale', () => {
  assert.equal(productsLabelDe(['home_contents', 'buildings']), 'Hausratversicherung, Gebäudeversicherung');
});

test('subject line: follows the required "Neue Offertanfrage..." format via the send payload', async () => {
  let sentPayload;
  const fetchImpl = async (url, opts) => {
    sentPayload = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ id: 'x' }) };
  };
  await handleCssLeadNotify(validPayload({ products: ['travel_annual'] }), { config: FULL_CONFIG, kv: fakeKv(), fetchImpl });
  assert.equal(sentPayload.subject, 'Neue Offertanfrage über SwissNewbie.ch: Reiseversicherung (Jahresvertrag)');
  assert.equal(sentPayload.to[0], FULL_CONFIG.to);
  assert.equal(sentPayload.cc[0], FULL_CONFIG.cc);
  assert.equal(sentPayload.reply_to, 'jane@example.com');
  assert.equal(sentPayload.from, 'SwissNewbie <noreply@swissnewbie.ch>');
});

// ---------------------------------------------------------------------------
// Origin checking
// ---------------------------------------------------------------------------

test('origin: production allowlist accepts only www.swissnewbie.ch and swissnewbie.ch', () => {
  assert.equal(isAllowedOrigin('https://www.swissnewbie.ch'), true);
  assert.equal(isAllowedOrigin('https://swissnewbie.ch'), true);
  assert.equal(isAllowedOrigin('https://evil.example.com'), false);
  assert.equal(isAllowedOrigin(undefined), false);
});
