import { createHash, createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export const MAX_BODY_BYTES = 16 * 1024;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const CLAIM_LEASE_MS = 60 * 1000;
const PROJECTS = new Set(['Interior Painting', 'Exterior Painting', 'Cabinet Refinishing', 'Commercial Painting', 'Deck / Wood Restoration', 'Other']);
const PROPERTIES = new Set(['Residential', 'Commercial']);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const FIELDS = new Set(['submissionId', 'name', 'email', 'phone', 'city', 'project', 'property', 'details', 'website', 'consent']);

class HttpError extends Error {
  constructor(status, code, message, fields, retryAfter) {
    super(message);
    Object.assign(this, { status, code, fields, retryAfter });
  }
}

function response(status, body, origin, extra = {}) {
  const headers = {
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow', Vary: 'Origin', ...extra,
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return body === null ? new Response(null, { status, headers }) : Response.json(body, { status, headers });
}

function allowedOrigin(request, env) {
  const raw = request.headers.get('origin');
  const allowed = new Set(['https://seacolpaintingllc.com', 'https://www.seacolpaintingllc.com']);
  for (const value of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    if (!value) continue;
    try {
      const url = new URL(`https://${value}`);
      if (url.hostname.endsWith('.vercel.app') && !url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) allowed.add(url.origin);
    } catch { /* An invalid deployment URL does not expand the allowlist. */ }
  }
  if (allowed.has(raw)) return raw;
  if (['test', 'development'].includes(env.NODE_ENV) && raw) {
    try {
      const url = new URL(raw);
      if (url.origin === raw && ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return raw;
    } catch { /* Reject malformed origins below. */ }
  }
  throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'This request origin is not allowed.');
}

async function readPayload(request) {
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json' || !['identity', null].includes(request.headers.get('content-encoding'))) {
    throw new HttpError(415, 'JSON_REQUIRED', 'Send this request as JSON.');
  }
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) throw new HttpError(400, 'INVALID_REQUEST', 'The request could not be read.');
  if (Number(length) > MAX_BODY_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
  if (!request.body) throw new HttpError(400, 'INVALID_JSON', 'The request body is missing.');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
      }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'INVALID_JSON', 'The request could not be read as JSON.');
  } finally {
    reader.releaseLock();
  }
}

function validatePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !FIELDS.has(key))) {
    throw new HttpError(400, 'INVALID_REQUEST', 'The request contains unsupported fields.');
  }
  if (input.website !== undefined && (typeof input.website !== 'string' || input.website.trim())) {
    throw new HttpError(400, 'INVALID_SUBMISSION', 'The request could not be submitted.');
  }
  const fields = {};
  function text(key, min, max, multiline = false) {
    const raw = input[key] ?? (min === 0 ? '' : null);
    if (typeof raw !== 'string') { fields[key] = 'Enter a valid value.'; return ''; }
    const value = raw.trim().normalize('NFC');
    const controls = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    if (value.length < min || value.length > max || controls.test(value) || !value.isWellFormed()) fields[key] = `Enter ${min} to ${max} characters.`;
    return value;
  }
  const submissionId = typeof input.submissionId === 'string' ? input.submissionId.toLowerCase() : '';
  if (!UUID_V4.test(submissionId)) fields.submissionId = 'Refresh the form and try again.';
  const form = {
    name: text('name', 2, 100), email: text('email', 3, 254).toLowerCase(),
    phone: text('phone', 0, 40), city: text('city', 2, 100),
    project: text('project', 1, 60), property: text('property', 1, 30),
    details: text('details', 10, 4000, true), consent: input.consent === true,
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email)) fields.email = 'Enter a valid email address.';
  if (form.phone && (!/^[+\d().\-\s]+$/.test(form.phone) || !/^\d{7,15}$/.test(form.phone.replace(/\D/g, '')))) fields.phone = 'Enter a valid phone number.';
  if (!PROJECTS.has(form.project)) fields.project = 'Choose a listed service.';
  if (!PROPERTIES.has(form.property)) fields.property = 'Choose Residential or Commercial.';
  if (!form.consent) fields.consent = 'Consent is required to submit this request.';
  if (Object.keys(fields).length) throw new HttpError(422, 'INVALID_FIELDS', 'Please check the highlighted fields.', fields);
  return { submissionId, form };
}

function rateContext(request, env, now) {
  // Vercel overwrites this header with the client IP. Never trust an arbitrary
  // X-Forwarded-For value in production or persist the raw address.
  let ip = request.headers.get('x-vercel-forwarded-for')?.trim();
  if (['test', 'development'].includes(env.NODE_ENV) && !ip) ip = '127.0.0.1';
  if (!ip || !isIP(ip)) throw new Error('Trusted client address unavailable');
  // Canonicalize IPv6 spellings so equivalent forms cannot create extra buckets.
  if (isIP(ip) === 6) ip = new URL(`http://[${ip}]/`).hostname.toLowerCase();
  const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  return {
    windowStart, expiresAt: windowStart + RATE_WINDOW_MS,
    digest: createHmac('sha256', env.ESTIMATE_RATE_LIMIT_SECRET).update(`estimate-rate:v1\0${windowStart}\0${ip}`).digest('hex'),
  };
}

function existingResult(entry, submissionId, payloadHash, origin) {
  if (!entry) return null;
  const record = entry.value;
  if (record?.schemaVersion !== 1 || record.submissionId !== submissionId || record.source !== 'website' ||
      typeof record.reference !== 'string' || !/^SC-[A-Z0-9-]+$/.test(record.reference) || !HASH.test(record.payloadHash || '')) throw new Error('Invalid saved estimate');
  if (record.payloadHash !== payloadHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This submission ID was already used for different information.');
  return response(200, { ok: true, reference: record.reference, duplicate: true }, origin);
}

function validateClaim(entry, payloadHash) {
  const claim = entry?.value;
  if (claim?.schemaVersion !== 1 || !HASH.test(claim.payloadHash || '') || typeof claim.owner !== 'string' ||
      !Number.isFinite(claim.leaseUntil) || !HASH.test(claim.rate?.digest || '') || !Number.isFinite(claim.rate?.windowStart) || !Number.isFinite(claim.rate?.expiresAt)) throw new Error('Invalid submission claim');
  if (claim.payloadHash !== payloadHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This submission ID was already used for different information.');
  return claim;
}

export function createEstimateHandler({ storeFactory, env = process.env, now = Date.now, uuid = randomUUID, wait = delay, notify = async () => {}, logger = event => console.error(event) } = {}) {
  return async function handleEstimate(request) {
    if (!['POST', 'OPTIONS'].includes(request.method)) return response(405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Use POST to submit an estimate request.' }, null, { Allow: 'POST, OPTIONS' });
    let origin, store, claimEntry, claimPath, savedPath, submissionId, payloadHash;
    let finalWriteAttempted = false;
    const signal = AbortSignal.timeout(20000);
    const log = event => { try { logger(event); } catch { /* Logging must not change a result. */ } };
    try {
      origin = allowedOrigin(request, env);
      if (request.method === 'OPTIONS') return response(204, null, origin, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
      const validated = validatePayload(await readPayload(request));
      ({ submissionId } = validated);
      if (!env.BLOB_READ_WRITE_TOKEN || typeof env.ESTIMATE_RATE_LIMIT_SECRET !== 'string' || env.ESTIMATE_RATE_LIMIT_SECRET.length < 32) throw new Error('Submission storage is not configured');
      store = await storeFactory();
      payloadHash = createHash('sha256').update(JSON.stringify(validated.form)).digest('hex');
      const environment = ['production', 'preview', 'development'].includes(env.VERCEL_ENV) ? env.VERCEL_ENV : 'development';
      const namespace = environment === 'production' ? '' : `${environment}/`;
      savedPath = `${namespace}estimates/${submissionId}.json`;
      const previous = existingResult(await store.read(savedPath, { signal }), submissionId, payloadHash, origin);
      if (previous) return previous;

      const timestamp = now();
      const owner = uuid();
      const currentRate = rateContext(request, env, timestamp);
      claimPath = `${namespace}estimate-claims/${submissionId}.json`;
      const proposal = { schemaVersion: 1, payloadHash, owner, state: 'pending', createdAt: new Date(timestamp).toISOString(), leaseUntil: timestamp + CLAIM_LEASE_MS, rate: currentRate };
      const creation = await store.create(claimPath, proposal, { signal });
      let candidate = creation.entry;
      for (let attempt = 0; attempt < 9; attempt += 1) {
        const claim = validateClaim(candidate, payloadHash);
        if (claim.owner === owner) { claimEntry = candidate; break; }
        const completed = existingResult(await store.read(savedPath, { signal }), submissionId, payloadHash, origin);
        if (completed) return completed;
        if (claim.state === 'rate_limited' && claim.leaseUntil > now()) throw new HttpError(429, 'RATE_LIMIT', 'Too many requests. Please try again later.', undefined, Math.max(1, Math.ceil((claim.leaseUntil - now()) / 1000)));
        if (claim.leaseUntil <= now()) {
          const replacement = { ...proposal, rate: claim.rate.expiresAt > now() ? claim.rate : currentRate, leaseUntil: now() + CLAIM_LEASE_MS };
          const replaced = await store.replace(claimPath, replacement, candidate.etag, { signal });
          if (replaced) { claimEntry = replaced; break; }
        }
        if (attempt < 8) { await wait(150); candidate = await store.read(claimPath, { signal }); }
      }
      if (!claimEntry) throw new HttpError(503, 'SUBMISSION_PENDING', 'This request is still being processed. Please retry with the same information.', undefined, 3);

      const rate = claimEntry.value.rate;
      let permitted = false;
      for (let slot = 1; slot <= 5; slot += 1) {
        const pathname = `${namespace}rate-limits/estimates/${rate.windowStart}/${rate.digest}/${slot}.json`;
        const reservation = await store.create(pathname, { schemaVersion: 1, submissionId, payloadHash, createdAt: new Date(now()).toISOString(), expiresAt: new Date(rate.expiresAt).toISOString() }, { signal });
        if (reservation.created || (reservation.entry.value.submissionId === submissionId && reservation.entry.value.payloadHash === payloadHash)) { permitted = true; break; }
      }
      if (!permitted) {
        await store.replace(claimPath, { ...claimEntry.value, state: 'rate_limited', leaseUntil: rate.expiresAt }, claimEntry.etag, { signal });
        throw new HttpError(429, 'RATE_LIMIT', 'Too many requests. Please try again later.', undefined, Math.max(1, Math.ceil((rate.expiresAt - now()) / 1000)));
      }

      const record = {
        schemaVersion: 1, submissionId, reference: `SC-${submissionId.replaceAll('-', '').toUpperCase()}`,
        createdAt: new Date(now()).toISOString(), source: 'website', status: 'new', environment, payloadHash,
        form: validated.form,
      };
      finalWriteAttempted = true;
      const saved = await store.create(savedPath, record, { signal });
      if (!saved.created) return existingResult(saved.entry, submissionId, payloadHash, origin);
      // Delivery is optional; the receipt means only that the private record was saved.
      try { await notify(record); } catch { log('estimate.notification_failed'); }
      return response(201, { ok: true, reference: record.reference }, origin);
    } catch (error) {
      if (error instanceof HttpError) {
        return response(error.status, { ok: false, error: error.message, code: error.code, ...(error.fields ? { fields: error.fields } : {}) }, origin, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
      }
      // A disconnected client can leave an ambiguous successful PUT. Confirm it
      // with an uncached read before deciding whether to ask for a retry.
      if (finalWriteAttempted && store) {
        try {
          const recovered = existingResult(await store.read(savedPath, { signal: AbortSignal.timeout(2000) }), submissionId, payloadHash, origin);
          if (recovered) return recovered;
        } catch { /* No verified record means no success response. */ }
      }
      if (claimEntry && store) {
        try { await store.replace(claimPath, { ...claimEntry.value, state: 'retryable', leaseUntil: now() }, claimEntry.etag, { signal: AbortSignal.timeout(2000) }); } catch { /* An unreleased claim expires after its bounded lease. */ }
      }
      log('estimate.storage_unavailable');
      return response(503, { ok: false, code: 'STORAGE_UNAVAILABLE', error: 'Your request could not be saved. Please retry or contact SEACOL directly.' }, origin, { 'Retry-After': '3' });
    }
  };
}
