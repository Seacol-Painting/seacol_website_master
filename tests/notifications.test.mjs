import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier } from '../server/notify.mjs';

const record = { environment: 'production', submissionId: '912b4b16-3f27-4a44-8862-a34ae244ee1c', reference: 'SC-912B4B16',
  createdAt: '2026-10-31T00:00:00.000Z', form: { name: 'Synthetic test', email: 'test@example.com',
    phone: '', city: 'Seattle', project: 'Interior Painting', property: 'Residential',
    details: 'Testing an estimate, not a customer request.', consent: true } };
const env = { RESEND_API_KEY: 'synthetic-test-only', ESTIMATE_NOTIFICATION_FROM: 'requests@seacolpaintingllc.com' };

test('preview and development cannot send owner notifications or alter production metadata', async () => {
  const notify = createNotifier({ env, fetcher: () => { throw new Error('Must not send'); },
    saveStatus: () => { throw new Error('Must not write'); } });
  for (const environment of ['preview', 'development', undefined]) {
    assert.equal((await notify({ ...record, environment })).status, 'not_production');
  }
});

test('notification stays disabled until both provider and sender are configured', async () => {
  for (const partial of [{}, { RESEND_API_KEY: 'test' }, { ESTIMATE_NOTIFICATION_FROM: env.ESTIMATE_NOTIFICATION_FROM }]) {
    const notify = createNotifier({ env: partial, fetcher: () => { throw new Error('Must not send'); } });
    assert.deepEqual(await notify(record), { status: 'not_configured' });
  }
});
test('invalid sender configuration cannot send to a different domain', async () => {
  const notify = createNotifier({ env: { ...env, ESTIMATE_NOTIFICATION_FROM: 'other@example.com' },
    fetcher: () => { throw new Error('Must not send'); } });
  assert.equal((await notify(record)).status, 'invalid_configuration');
});
test('notification uses fixed owner, customer reply-to, plain text and a stable provider idempotency key', async () => {
  let saved;
  const notify = createNotifier({ env, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.to, ['info@seacolpaintingllc.com']);
    assert.equal(body.reply_to, record.form.email);
    assert.equal(body.html, undefined);
    assert.match(body.text, /Synthetic test/);
    assert.equal(options.headers['Idempotency-Key'], `seacol-estimate/${record.submissionId}`);
    return Response.json({ id: 'synthetic-provider-id' });
  }, saveStatus: async (...args) => { saved = args; } });
  assert.equal((await notify(record)).status, 'accepted');
  assert.equal(saved[2].access, 'private');
  assert.equal(JSON.parse(saved[1]).providerId, 'synthetic-provider-id');
  assert(!saved[1].includes(record.form.email), 'Status metadata has no customer contact details');
});
test('provider failure and status storage failure do not reject the durable estimate', async () => {
  for (const fetcher of [async () => { throw new Error('timeout'); },
    async () => Response.json({ error: 'sensitive provider error' }, { status: 503 }),
    async () => Response.json({})]) {
    const notify = createNotifier({ env, fetcher, saveStatus: async () => { throw new Error('storage unavailable'); } });
    assert.equal((await notify(record)).status, 'failed');
  }
});
