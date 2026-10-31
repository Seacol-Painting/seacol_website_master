import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate as tick } from 'node:timers/promises';
import { createEstimateHandler, RATE_WINDOW_MS, CLAIM_LEASE_MS } from '../server/estimate-core.mjs';
import { createBlobStore } from '../server/blob-store.mjs';

class MemoryStore {
  entries = new Map();
  revision = 0;
  async read(pathname) { return this.entries.has(pathname) ? structuredClone(this.entries.get(pathname)) : null; }
  async create(pathname, value) {
    if (this.beforeCreate) await this.beforeCreate(pathname, value);
    if (this.entries.has(pathname)) return { created: false, entry: structuredClone(this.entries.get(pathname)) };
    const entry = { value: structuredClone(value), etag: `v${++this.revision}` };
    this.entries.set(pathname, entry);
    if (this.afterCreate) await this.afterCreate(pathname, value);
    return { created: true, entry: structuredClone(entry) };
  }
  async replace(pathname, value, etag) {
    if (this.beforeReplace) await this.beforeReplace(pathname, value);
    if (this.entries.get(pathname)?.etag !== etag) return null;
    const entry = { value: structuredClone(value), etag: `v${++this.revision}` };
    this.entries.set(pathname, entry);
    return structuredClone(entry);
  }
  count(prefix) { return [...this.entries.keys()].filter(key => key.startsWith(prefix)).length; }
}

function payload(overrides = {}) {
  return { submissionId: randomUUID(), name: 'Test Customer', email: 'test@example.com', phone: '+1 (206) 555-0100', city: 'Seattle', project: 'Interior Painting', property: 'Residential', details: 'Paint the living room.\nWalls and trim.', website: '', consent: true, ...overrides };
}
function request(value = payload(), { method = 'POST', origin = 'https://seacolpaintingllc.com', ip = '198.51.100.1', headers = {}, raw } = {}) {
  const allHeaders = new Headers({ 'content-type': 'application/json', ...headers });
  if (origin !== null) allHeaders.set('origin', origin);
  if (ip !== null) allHeaders.set('x-vercel-forwarded-for', ip);
  return new Request('https://seacolpaintingllc.com/api/estimate', {
    method, headers: allHeaders,
    ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { body: raw ?? JSON.stringify(value) } : {}),
  });
}
function harness(options = {}) {
  let clock = Date.UTC(2026, 9, 31, 12, 15);
  const store = options.store || new MemoryStore();
  const notices = [], logs = [];
  const env = { NODE_ENV: 'production', VERCEL_ENV: 'production', BLOB_READ_WRITE_TOKEN: 'test-storage-token', ESTIMATE_RATE_LIMIT_SECRET: 'test-only-'.repeat(6), VERCEL_URL: 'seacol-test.vercel.app', VERCEL_BRANCH_URL: 'seacol-git-test.vercel.app', ...options.env };
  const handler = createEstimateHandler({ storeFactory: () => store, env, now: () => clock, wait: tick, notify: async record => notices.push(record), logger: event => logs.push(event), ...options.dependencies });
  return { handler, store, env, notices, logs, advance: milliseconds => { clock += milliseconds; } };
}

test('201 is issued only after a private durable record exists; response contains no form data', async () => {
  const h = harness(), input = payload();
  const result = await h.handler(request(input));
  assert.equal(result.status, 201);
  const body = await result.json();
  assert.deepEqual(Object.keys(body).sort(), ['ok', 'reference']);
  assert.match(body.reference, /^SC-[A-Z0-9-]+$/);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow');
  const record = h.store.entries.get(`estimates/${input.submissionId}.json`).value;
  assert.equal(record.form.details, input.details);
  assert.equal(record.environment, 'production');
  assert.equal(record.source, 'website');
  assert.equal(record.reference, body.reference);
  assert.equal(h.notices.length, 1);
  assert.equal(h.store.count('rate-limits/'), 1);
  assert.ok(!JSON.stringify([...h.store.entries]).includes('198.51.100.1'));
});

test('identical retries return 200 and do not consume quota or send a second notification', async () => {
  const h = harness(), input = payload();
  await h.handler(request(input));
  const response = await h.handler(request(Object.fromEntries(Object.entries(input).reverse())));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).duplicate, true);
  assert.equal(h.store.count('estimates/'), 1);
  assert.equal(h.store.count('rate-limits/'), 1);
  assert.equal(h.notices.length, 1);
});

test('a reused UUID with different form information returns 409 without overwriting', async () => {
  const h = harness(), input = payload();
  await h.handler(request(input));
  const result = await h.handler(request({ ...input, details: 'Different work requested.' }));
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(h.store.entries.get(`estimates/${input.submissionId}.json`).value.form.details, input.details);
  assert.equal(h.store.count('rate-limits/'), 1);
});

test('GET and other unsupported methods are 405 and never access storage', async () => {
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    const h = harness();
    const result = await h.handler(request(undefined, { method, origin: null }));
    assert.equal(result.status, 405);
    assert.equal(result.headers.get('allow'), 'POST, OPTIONS');
    assert.equal(h.store.entries.size, 0);
  }
});

test('only exact production/deployment origins and development localhost are allowed', async () => {
  for (const origin of ['https://seacolpaintingllc.com', 'https://www.seacolpaintingllc.com', 'https://seacol-test.vercel.app', 'https://seacol-git-test.vercel.app']) {
    assert.equal((await harness().handler(request(undefined, { origin }))).status, 201, origin);
  }
  for (const origin of [null, 'null', 'https://evil.example', 'https://seacolpaintingllc.com.evil.example', 'https://other.vercel.app', 'http://localhost:3000', 'http://seacolpaintingllc.com']) {
    const h = harness();
    assert.equal((await h.handler(request(undefined, { origin }))).status, 403, String(origin));
    assert.equal(h.store.entries.size, 0);
  }
  assert.equal((await harness({ env: { NODE_ENV: 'development' } }).handler(request(undefined, { origin: 'http://localhost:3000', ip: null }))).status, 201);
});

test('preflight accepts only the same explicit origins', async () => {
  const h = harness();
  assert.equal((await h.handler(request(undefined, { method: 'OPTIONS' }))).status, 204);
  assert.equal((await h.handler(request(undefined, { method: 'OPTIONS', origin: 'https://evil.example' }))).status, 403);
  assert.equal(h.store.entries.size, 0);
});

test('JSON content type, well-formed input and the byte limit are enforced before storage', async () => {
  for (const [options, expected] of [
    [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ headers: { 'content-encoding': 'gzip' } }, 415],
    [{ raw: '{broken' }, 400],
    [{ raw: new Uint8Array([0xff]) }, 400],
    [{ headers: { 'content-length': '17000' } }, 413],
    [{ raw: 'x'.repeat(17000), headers: { 'content-length': '1' } }, 413],
    [{ headers: { 'content-length': '-1' } }, 400],
  ]) {
    const h = harness();
    assert.equal((await h.handler(request(payload(), options))).status, expected);
    assert.equal(h.store.entries.size, 0);
  }
});

test('field bounds, consent, UUID and exact service/property enums are enforced', async () => {
  for (const [field, value] of Object.entries({ name: 'x', city: 'x', details: 'x'.repeat(4001), email: 'invalid', phone: 'abc123', consent: false, submissionId: 'not-a-uuid', project: 'Cabinet painting', property: 'Other' })) {
    const h = harness();
    const result = await h.handler(request(payload({ [field]: value })));
    assert.equal(result.status, 422, field);
    assert.equal((await result.json()).code, 'INVALID_FIELDS');
    assert.equal(h.store.entries.size, 0);
  }
  assert.equal((await harness().handler(request(payload({ details: 'x'.repeat(4000), phone: '' })))).status, 201);
});

test('honeypot and unsupported fields are rejected without a false success', async () => {
  for (const overrides of [{ website: 'https://spam.example' }, { unexpected: 'field' }]) {
    const h = harness();
    const result = await h.handler(request(payload(overrides)));
    assert.equal(result.status, 400);
    assert.equal((await result.json()).ok, false);
    assert.equal(h.store.entries.size, 0);
  }
});

test('five new submissions per IP/hour are allowed; duplicates are exempt and the next hour resets', async () => {
  const h = harness(), first = payload(), sixth = payload();
  for (const input of [first, ...Array.from({ length: 4 }, () => payload())]) assert.equal((await h.handler(request(input))).status, 201);
  const limited = await h.handler(request(sixth));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await h.handler(request(first))).status, 200);
  assert.equal(h.store.count('estimates/'), 5);
  assert.equal(h.store.count('rate-limits/'), 5);
  for (const [key, value] of h.store.entries) if (key.startsWith('rate-limits/')) assert.ok(Date.parse(value.value.expiresAt));
  h.advance(RATE_WINDOW_MS);
  assert.equal((await h.handler(request(sixth))).status, 201);
});

test('distributed slot claims allow no more than five simultaneous distinct submissions', async () => {
  const h = harness();
  const responses = await Promise.all(Array.from({ length: 12 }, () => h.handler(request())));
  assert.equal(responses.filter(result => result.status === 201).length, 5);
  assert.equal(responses.filter(result => result.status === 429).length, 7);
  assert.equal(h.store.count('estimates/'), 5);
  assert.equal(h.store.count('rate-limits/'), 5);
});

test('concurrent duplicates across different IPs save one record and reserve only one slot', async () => {
  const h = harness(), input = payload();
  const results = await Promise.all(Array.from({ length: 15 }, (_, index) => h.handler(request(input, { ip: `198.51.100.${index + 1}` }))));
  assert.equal(results.filter(result => result.status === 201).length, 1);
  assert.equal(results.filter(result => result.status === 200).length, 14);
  assert.equal(h.store.count('estimates/'), 1);
  assert.equal(h.store.count('rate-limits/'), 1);
  assert.equal(h.notices.length, 1);
});

test('concurrent conflicting payloads cannot overwrite the winning request', async () => {
  const h = harness(), input = payload();
  const results = await Promise.all([h.handler(request(input)), h.handler(request({ ...input, details: 'Another conflicting request.' }))]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(h.store.count('estimates/'), 1);
  assert.equal(h.store.count('rate-limits/'), 1);
});

test('storage outages fail closed and logs do not include provider errors or form details', async () => {
  const h = harness();
  h.store.read = async () => { throw new Error('Secret token and test@example.com'); };
  const result = await h.handler(request());
  assert.equal(result.status, 503);
  const text = await result.text();
  assert.ok(!text.includes('test@example.com'));
  assert.deepEqual(h.logs, ['estimate.storage_unavailable']);
});

test('missing storage/rate-limit configuration and missing trusted production IP fail closed', async () => {
  for (const env of [{ BLOB_READ_WRITE_TOKEN: '' }, { ESTIMATE_RATE_LIMIT_SECRET: '' }]) {
    const h = harness({ env });
    assert.equal((await h.handler(request())).status, 503);
    assert.equal(h.store.entries.size, 0);
  }
  const h = harness();
  assert.equal((await h.handler(request(undefined, { ip: null, headers: { 'x-forwarded-for': '198.51.100.9' } }))).status, 503);
  assert.equal(h.store.entries.size, 0);
});

test('a failed final write retries without charging a second slot', async () => {
  const h = harness(), input = payload();
  h.store.beforeCreate = async path => { if (path.startsWith('estimates/')) throw new Error('write unavailable'); };
  assert.equal((await h.handler(request(input))).status, 503);
  assert.equal(h.store.count('estimates/'), 0);
  assert.equal(h.store.count('rate-limits/'), 1);
  h.store.beforeCreate = null;
  assert.equal((await h.handler(request(input))).status, 201);
  assert.equal(h.store.count('rate-limits/'), 1);
});

test('an ambiguous successful PUT is confirmed by reading before any success is returned', async () => {
  const h = harness(), input = payload();
  h.store.afterCreate = async path => { if (path.startsWith('estimates/')) throw new Error('response disconnected after write'); };
  const result = await h.handler(request(input));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).duplicate, true);
  assert.equal(h.store.count('estimates/'), 1);
});

test('an in-flight request has no false receipt and its duplicate consumes no additional quota', async () => {
  const h = harness(), input = payload();
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  h.store.beforeCreate = async path => { if (path.startsWith('estimates/')) await blocked; };
  const original = h.handler(request(input));
  while (!h.store.count('rate-limits/')) await tick();
  const pending = await h.handler(request(input));
  assert.equal(pending.status, 503);
  assert.equal((await pending.json()).code, 'SUBMISSION_PENDING');
  assert.equal(h.store.count('estimates/'), 0);
  assert.equal(h.store.count('rate-limits/'), 1);
  release();
  assert.equal((await original).status, 201);
  assert.equal((await h.handler(request(input))).status, 200);
});

test('a crashed owner is recoverable after its lease without overwriting or double quota', async () => {
  const h = harness(), input = payload();
  h.store.beforeCreate = async path => { if (path.startsWith('estimates/')) throw new Error('crash'); };
  h.store.beforeReplace = async () => { throw new Error('cleanup unavailable'); };
  assert.equal((await h.handler(request(input))).status, 503);
  h.store.beforeCreate = h.store.beforeReplace = null;
  h.advance(CLAIM_LEASE_MS + 1);
  assert.equal((await h.handler(request(input))).status, 201);
  assert.equal(h.store.count('rate-limits/'), 1);
});

test('preview records and limits remain separate even when the store and UUID are shared', async () => {
  const store = new MemoryStore(), input = payload();
  const production = harness({ store }), preview = harness({ store, env: { VERCEL_ENV: 'preview' } });
  assert.equal((await production.handler(request(input))).status, 201);
  assert.equal((await preview.handler(request(input))).status, 201);
  assert.equal(store.entries.get(`preview/estimates/${input.submissionId}.json`).value.environment, 'preview');
  assert.equal(store.count('estimates/'), 1);
  assert.equal(store.count('preview/estimates/'), 1);
  assert.equal(store.count('rate-limits/'), 1);
  assert.equal(store.count('preview/rate-limits/'), 1);
});

test('notification failure never changes a confirmed durable 201 and never leaks error content', async () => {
  const h = harness({ dependencies: { notify: async () => { throw new Error('email provider secret'); } } });
  const result = await h.handler(request());
  assert.equal(result.status, 201);
  assert.deepEqual(h.logs, ['estimate.notification_failed']);
  assert.ok(!JSON.stringify(await result.json()).includes('email'));
});

test('Blob adapter uses private uncached reads, atomic create and ETag-guarded recovery', async () => {
  const calls = [];
  const database = new Map();
  class Precondition extends Error {}
  const sdk = {
    BlobPreconditionFailedError: Precondition,
    async get(path, options) {
      calls.push(['get', options]);
      if (!database.has(path)) return null;
      const value = database.get(path);
      const body = JSON.stringify(value);
      return { statusCode: 200, stream: new Response(body).body, blob: { etag: '"v1"', size: Buffer.byteLength(body) } };
    },
    async put(path, body, options) {
      calls.push(['put', options]);
      if (options.ifMatch === '"stale"') throw new Precondition();
      if (database.has(path) && !options.allowOverwrite) throw new Error('generic exists error');
      database.set(path, JSON.parse(body));
      return { etag: '"v1"' };
    },
  };
  const adapter = createBlobStore({ sdk, env: { BLOB_READ_WRITE_TOKEN: 'test-only-token' } });
  assert.equal((await adapter.create('estimates/test.json', { saved: true })).created, true);
  assert.equal((await adapter.create('estimates/test.json', { saved: false })).created, false);
  assert.equal((await adapter.read('estimates/test.json')).value.saved, true);
  assert.equal(await adapter.replace('estimates/test.json', {}, '"stale"'), null);
  for (const [operation, options] of calls) {
    assert.equal(options.access, 'private');
    if (operation === 'get') assert.equal(options.useCache, false);
    if (operation === 'put') assert.equal(options.addRandomSuffix, false);
  }
  const createOptions = calls.find(([operation]) => operation === 'put')[1];
  assert.equal(createOptions.allowOverwrite, false);
  assert.ok(calls.some(([operation, options]) => operation === 'put' && options.ifMatch === '"stale"'));
});

test('a Blob write failure without a confirmed object is never reported as an existing object', async () => {
  const sdk = { get: async () => null, put: async () => { throw new Error('offline'); } };
  const adapter = createBlobStore({ sdk, env: { BLOB_READ_WRITE_TOKEN: 'test-only-token' } });
  await assert.rejects(adapter.create('estimates/test.json', {}), /offline/);
});
