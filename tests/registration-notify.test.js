import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRegistrationNotify } from '../api/registration-notify.js';

test('sends the notification with the expected fields when registering', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { json: async () => ({ id: 'email_123' }) };
  };

  const result = await handleRegistrationNotify(
    {
      name: 'Jane Doe',
      email: 'jane@example.com',
      ts: '2026-01-01T12:00:00.000Z',
      siteLang: 'en',
      browserLang: 'en-US',
      referrer: 'https://google.com',
      landingPage: 'https://swissnewbie.ch/',
      utm: { utm_source: 'newsletter' },
      ua: 'Mozilla/5.0',
      voucherClicks: ['SWICA']
    },
    { apiKey: 'test-key', fetchImpl }
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body.to, ['jan.feusi@gmx.ch']);
  assert.match(body.html, /Jane Doe/);
  assert.match(body.html, /jane@example\.com/);
  assert.match(body.html, /SWICA/);
  assert.match(body.html, /newsletter/);
});

test('never includes password or password hash fields anywhere in the output', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { json: async () => ({ id: 'email_123' }) };
  };

  const secret = 'super-secret-password-123';
  const hash = 'deadbeef1234passhash';

  const result = await handleRegistrationNotify(
    {
      name: 'Jane Doe',
      email: 'jane@example.com',
      pass: secret,
      password: secret,
      passHash: hash,
      regPassword: secret,
      nested: { passHash: hash, deeper: { password: secret } },
      voucherClicks: ['SWICA']
    },
    { apiKey: 'test-key', fetchImpl }
  );

  assert.equal(result.ok, true);
  const raw = calls[0].opts.body;
  assert.ok(!raw.includes(secret), 'raw password must never appear in the request body');
  assert.ok(!raw.includes(hash), 'password hash must never appear in the request body');
  assert.ok(!/pass/i.test(raw), 'no field or value containing "pass" may appear in the request body');
});

test('registration still succeeds (ok response) even when sending fails', async () => {
  const fetchImpl = async () => {
    throw new Error('network down');
  };

  const result = await handleRegistrationNotify(
    { name: 'Jane Doe', email: 'jane@example.com' },
    { apiKey: 'test-key', fetchImpl }
  );

  assert.equal(result.ok, false);
  assert.ok(!/pass/i.test(result.error || ''), 'error message must never mention password fields');
});

test('resolves ok without calling fetch when RESEND_API_KEY is not configured', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { json: async () => ({}) };
  };

  const result = await handleRegistrationNotify(
    { name: 'Jane Doe', email: 'jane@example.com' },
    { apiKey: '', fetchImpl }
  );

  assert.equal(result.ok, true);
  assert.equal(called, false);
});
