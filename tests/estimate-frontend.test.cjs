const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const siteSource = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
const estimateSource = fs.readFileSync(path.join(__dirname, '../estimate.js'), 'utf8');
const sample = {
  name: 'Cami QA', email: 'qa+estimate@example.com', phone: '206-555-0198',
  city: 'Seattle', project: 'Cabinet Refinishing', property: 'Residential',
  details: 'Kitchen & trim + café\nTwo rooms; "gold" accents?', website: '', consent: 'on',
};

function fixture({ valid = true, present = true } = {}) {
  const values = { ...sample };
  const requests = [];
  const events = [];
  const timers = new Map();
  const nodes = new Map();
  let document;
  let uuidCount = 0;
  let timerCount = 0;
  let resetCount = 0;

  function element(id) {
    const listeners = new Map();
    const node = {
      id, hidden: false, disabled: false, textContent: '', value: '', href: '',
      attrs: {}, dataset: {},
      classList: { contains: () => false, toggle() {} },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      emit(type, extra = {}) {
        const event = { target: node, defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; }, ...extra };
        return Promise.all((listeners.get(type) || []).map((listener) => listener(event)));
      },
      setAttribute(name, value) { node.attrs[name] = value; },
      focus() { document.activeElement = node; },
      select() { node.selected = true; },
      closest(selector) { return selector === `#${id}` ? node : null; },
    };
    return node;
  }

  for (const id of ['estimate-form', 'estimate-fields', 'estimate-submit', 'estimate-status',
    'estimate-another', 'request-options', 'copy-status', 'send-email', 'send-text',
    'request-preview', 'copy-request']) nodes.set(`#${id}`, element(id));
  const form = nodes.get('#estimate-form');
  const fields = nodes.get('#estimate-fields');
  const submit = nodes.get('#estimate-submit');
  const status = nodes.get('#estimate-status');
  const another = nodes.get('#estimate-another');
  const fallback = nodes.get('#request-options');
  submit.disabled = true;
  status.hidden = another.hidden = fallback.hidden = true;
  const inputs = new Map(Object.keys(values).map((name) => [name, element(name)]));
  form.reportValidity = () => valid;
  form.querySelector = (selector) => inputs.get(selector.match(/^\[name="([^\"]+)"\]$/)?.[1]) || null;
  form.reset = () => {
    resetCount += 1;
    for (const name of Object.keys(values)) values[name] = name === 'property' ? 'Residential' : '';
  };
  document = element('document');
  document.body = element('body');
  document.documentElement = {};
  document.head = { appendChild() {} };
  document.createElement = () => element('created');
  document.querySelector = (selector) => selector === '#estimate-form' && !present ? null : nodes.get(selector) || null;
  document.querySelectorAll = () => [];
  document.dispatchEvent = (event) => { events.push(event); return true; };
  const window = { innerWidth: 390, scrollY: 0, addEventListener() {} };

  class FormDataSnapshot {
    constructor(target) {
      assert.equal(target, form);
      // Browsers omit controls from a disabled fieldset. Capture a real snapshot
      // so a later edit cannot silently change an already pending request.
      this.data = new Map(fields.disabled ? [] : Object.entries(values));
    }
    get(name) { return this.data.get(name) ?? null; }
  }

  const context = vm.createContext({
    document, window, console, URL, AbortController, TypeError,
    FormData: FormDataSnapshot,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    crypto: { randomUUID() { uuidCount += 1; return `00000000-0000-4000-8000-${String(uuidCount).padStart(12, '0')}`; } },
    setTimeout(callback, delay) { const id = ++timerCount; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    navigator: { clipboard: { async writeText() {} } },
    fetch(url, options) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = {
        url, options, payload: JSON.parse(options.body),
        respond(statusCode, body, { invalidJSON = false } = {}) {
          resolve({ status: statusCode, ok: statusCode >= 200 && statusCode < 300,
            async json() { if (invalidJSON) throw new SyntaxError('Invalid JSON'); return body; } });
        },
        fail(error = new TypeError('Connection interrupted')) { reject(error); },
      };
      options.signal.addEventListener('abort', () => {
        const error = new Error('Request aborted'); error.name = 'AbortError'; reject(error);
      }, { once: true });
      requests.push(request);
      return promise;
    },
  });
  // Use the actual fallback encoder from script.js, not a mirrored test version.
  vm.runInContext(siteSource, context, { filename: 'script.js' });
  vm.runInContext(estimateSource, context, { filename: 'estimate.js' });
  return {
    values, requests, events, timers, document, form, fields, submit, status, another, fallback, nodes,
    send: () => form.emit('submit'),
    anotherRequest: () => another.emit('click'),
    async edit(name, value) { values[name] = value; await form.emit('input', { target: inputs.get(name) }); },
    expireTimeout() {
      assert.equal(timers.size, 1, 'Only one request timeout should be active');
      const timer = [...timers.values()][0];
      assert.equal(timer.delay, 35000);
      timer.callback();
    },
    get uuidCount() { return uuidCount; },
    get resetCount() { return resetCount; },
  };
}

function assertRecoverable(f) {
  assert.equal(f.status.dataset.state, 'error');
  assert.equal(f.fields.hidden, false);
  assert.equal(f.fields.disabled, false);
  assert.equal(f.submit.hidden, false);
  assert.equal(f.submit.disabled, false);
  assert.equal(f.form.attrs['aria-busy'], 'false');
  assert.equal(f.fallback.hidden, false);
  assert.equal(f.events.length, 0);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.values, sample, 'Unacknowledged requests must retain the form data');
}

test('missing form is harmless and invalid form never starts a request', async () => {
  const absent = fixture({ present: false });
  assert.equal(absent.requests.length, 0);
  const f = fixture({ valid: false });
  assert.equal(f.submit.disabled, false, 'JavaScript enables the initially disabled button');
  await f.send();
  assert.equal(f.requests.length, 0);
  assert.equal(f.uuidCount, 0);
  assert.equal(f.timers.size, 0);
});

test('a double submit while pending sends one request and locks the fields', async () => {
  const f = fixture();
  const first = f.send();
  await f.send();
  assert.equal(f.requests.length, 1);
  assert.equal(f.uuidCount, 1);
  assert.equal(f.submit.disabled, true);
  assert.equal(f.fields.disabled, true);
  assert.equal(f.form.attrs['aria-busy'], 'true');
  assert.equal(f.status.dataset.state, 'pending');
  assert.equal(f.requests[0].url, '/api/estimate');
  assert.equal(f.requests[0].options.method, 'POST');
  assert.equal(f.requests[0].options.credentials, 'same-origin');
  assert.deepEqual(f.requests[0].payload, { ...sample, consent: true, submissionId: f.requests[0].payload.submissionId });
  f.requests[0].fail();
  await first;
  assertRecoverable(f);
});

for (const mode of ['network failure', 'timeout']) {
  test(`${mode} preserves details and retries with the same idempotency UUID`, async () => {
    const f = fixture();
    const first = f.send();
    if (mode === 'timeout') f.expireTimeout(); else f.requests[0].fail();
    await first;
    assertRecoverable(f);
    assert.match(f.status.textContent, /couldn.t confirm receipt/i);
    const retry = f.send();
    assert.equal(f.requests.length, 2);
    assert.deepEqual(f.requests[1].payload, f.requests[0].payload);
    assert.equal(f.uuidCount, 1);
    assert.equal(f.fallback.hidden, true, 'Retry clears stale direct-contact links');
    f.requests[1].respond(201, { ok: true, reference: 'SC-20261031-RETRY' });
    await retry;
    assert.equal(f.status.dataset.state, 'success');
    assert.equal(f.events.length, 1);
  });
}

test('HTTP success alone or a missing/malformed acknowledgement never reports receipt', async (t) => {
  const cases = [
    ['ok=false', 200, { ok: false, reference: 'SC-VALID' }],
    ['missing ok', 200, { reference: 'SC-VALID' }],
    ['string ok', 200, { ok: 'true', reference: 'SC-VALID' }],
    ['missing reference', 200, { ok: true }],
    ['empty reference', 201, { ok: true, reference: '' }],
    ['wrong reference prefix', 200, { ok: true, reference: 'OTHER-123' }],
    ['array reference is not a valid string acknowledgement', 200, { ok: true, reference: ['SC-VALID'] }],
    ['lowercase reference', 200, { ok: true, reference: 'sc-invalid' }],
    ['HTML in reference', 200, { ok: true, reference: 'SC-123<script>' }],
    ['HTTP failure with optimistic body', 500, { ok: true, reference: 'SC-VALID' }],
    ['invalid JSON', 200, null, { invalidJSON: true }],
  ];
  for (const [name, statusCode, body, options] of cases) {
    await t.test(name, async () => {
      const f = fixture(); const pending = f.send();
      f.requests[0].respond(statusCode, body, options); await pending;
      assertRecoverable(f);
      assert.equal(f.another.hidden, true);
      assert.doesNotMatch(f.status.textContent, /request has been received/i);
    });
  }
});

test('a durable 201 acknowledgement hides fields, shows its reference and emits no personal details', async () => {
  const f = fixture(); const pending = f.send();
  f.requests[0].respond(201, { ok: true, reference: 'SC-20261031-ACCEPTED' }); await pending;
  assert.equal(f.status.dataset.state, 'success');
  assert.match(f.status.textContent, /SC-20261031-ACCEPTED/);
  assert.equal(f.fields.hidden, true);
  assert.equal(f.submit.hidden, true);
  assert.equal(f.submit.disabled, true);
  assert.equal(f.another.hidden, false);
  assert.equal(f.fallback.hidden, true);
  assert.equal(f.document.activeElement, f.status);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].type, 'seacol:estimate-success');
  assert.deepEqual(JSON.parse(JSON.stringify(f.events[0].detail)), { project: sample.project });
  const event = JSON.stringify(f.events[0]);
  for (const name of ['name', 'email', 'phone', 'city', 'details']) assert.equal(event.includes(sample[name]), false, `${name} must not be emitted to analytics`);
  assert.equal(event.includes(f.requests[0].payload.submissionId), false);
  await f.send();
  assert.equal(f.requests.length, 1, 'Accepted request stays locked until explicitly reset');
  assert.equal(f.timers.size, 0);
});

test('an acknowledged duplicate shows success without counting a second conversion', async () => {
  const f = fixture(); const pending = f.send();
  f.requests[0].respond(200, { ok: true, reference: 'SC-20261031-EXISTING', duplicate: true }); await pending;
  assert.equal(f.status.dataset.state, 'success');
  assert.match(f.status.textContent, /SC-20261031-EXISTING/);
  assert.equal(f.fields.hidden, true);
  assert.equal(f.events.length, 0);
});

test('changing the payload after a failed attempt creates a new UUID', async () => {
  const f = fixture(); const first = f.send();
  f.requests[0].fail(); await first;
  await f.edit('details', 'A different project: exterior siding and trim.');
  assert.equal(f.fallback.hidden, true);
  assert.equal(f.nodes.get('#request-preview').value, '');
  const retry = f.send();
  assert.notEqual(f.requests[1].payload.submissionId, f.requests[0].payload.submissionId);
  assert.equal(f.uuidCount, 2);
  assert.equal(f.requests[1].payload.details, f.values.details);
  f.requests[1].respond(201, { ok: true, reference: 'SC-20261031-CHANGED' }); await retry;
  assert.equal(f.status.dataset.state, 'success');
});

test('direct-contact fallback encodes all details without corrupting ampersands, plus signs or accents', async () => {
  const f = fixture(); const pending = f.send(); f.requests[0].fail(); await pending;
  const email = new URL(f.nodes.get('#send-email').href);
  const sms = new URL(f.nodes.get('#send-text').href);
  const preview = f.nodes.get('#request-preview').value;
  assert.equal(email.protocol, 'mailto:');
  assert.equal(email.pathname, 'info@seacolpaintingllc.com');
  assert.equal(email.searchParams.get('subject'), `Estimate request - ${sample.project}`);
  assert.equal(email.searchParams.get('body'), preview);
  assert.equal(sms.protocol, 'sms:');
  assert.equal(sms.pathname, '+12065732474');
  assert.equal(sms.searchParams.get('body'), preview);
  assert.deepEqual([...email.searchParams.keys()], ['subject', 'body']);
  assert.deepEqual([...sms.searchParams.keys()], ['body']);
  for (const name of ['name', 'email', 'phone', 'city', 'project', 'property', 'details']) assert.ok(preview.includes(sample[name]));
});

test('sending another request resets the UI, data and UUID even for identical new details', async () => {
  const f = fixture(); const first = f.send();
  f.requests[0].respond(201, { ok: true, reference: 'SC-20261031-FIRST' }); await first;
  await f.anotherRequest();
  assert.equal(f.resetCount, 1);
  assert.equal(f.fields.hidden, false);
  assert.equal(f.fields.disabled, false);
  assert.equal(f.submit.hidden, false);
  assert.equal(f.submit.disabled, false);
  assert.equal(f.another.hidden, true);
  assert.equal(f.status.hidden, true);
  assert.equal(f.fallback.hidden, true);
  assert.equal(f.nodes.get('#request-preview').value, '');
  assert.equal(f.nodes.get('#send-email').href, 'mailto:info@seacolpaintingllc.com');
  assert.equal(f.nodes.get('#send-text').href, 'sms:+12065732474');
  assert.equal(f.values.name, '');
  assert.equal(f.values.consent, '');
  assert.equal(f.document.activeElement.id, 'name');
  Object.assign(f.values, sample);
  const second = f.send();
  assert.equal(f.requests.length, 2);
  assert.notEqual(f.requests[1].payload.submissionId, f.requests[0].payload.submissionId);
  f.requests[1].respond(201, { ok: true, reference: 'SC-20261031-SECOND' }); await second;
  assert.equal(f.events.length, 2);
  assert.equal(f.timers.size, 0);
});
