const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../analytics.js'), 'utf8');

function target(matches = []) {
  const handlers = new Map();
  return {
    addEventListener(type, fn, options = {}) {
      const list = handlers.get(type) || [];
      list.push({ fn, once: options.once });
      handlers.set(type, list);
    },
    dispatch(type, event = {}) {
      for (const handler of [...(handlers.get(type) || [])]) {
        handler.fn(event);
        if (handler.once) handlers.set(type, handlers.get(type).filter(item => item !== handler));
      }
    },
    closest(selector) { return matches.includes(selector) ? this : null; },
  };
}

function fixture(options = {}) {
  const location = new URL(options.url || 'https://seacolpaintingllc.com/');
  const storage = options.storage || new Map();
  const scripts = [];
  const controls = [target(), target()];
  const sections = ['hero', 'estimate'].map(id => ({ id, classList: { contains: value => value === id } }));
  let observer;
  const document = Object.assign(target(), {
    referrer: options.referrer || '', visibilityState: 'visible',
    head: { appendChild: script => scripts.push(script) },
    createElement: () => ({}),
    querySelectorAll(selector) {
      if (selector === '[data-comparison]') return controls.map(control => ({ querySelector: () => control }));
      if (selector === 'main > section') return sections;
      return [];
    },
  });
  const window = Object.assign(target(), { location });
  const navigator = options.navigator || {};
  function IntersectionObserver(callback, config) {
    this.callback = callback; this.config = config;
    this.observe = () => {}; this.unobserve = () => {};
    observer = this;
  }
  window.IntersectionObserver = IntersectionObserver;
  const sessionStorage = {
    getItem: key => { if (options.storageBlocked) throw Error('blocked'); return storage.get(key); },
    setItem: (key, value) => { if (options.storageBlocked) throw Error('blocked'); storage.set(key, value); },
  };
  const context = vm.createContext({ window, document, navigator, URL, sessionStorage, IntersectionObserver });
  vm.runInContext(source, context);
  const queue = () => Array.from(window.vaq || [], args => Array.from(args));
  const events = () => queue().filter(args => args[0] === 'event').map(args => JSON.parse(JSON.stringify(args[1])));
  return { window, document, scripts, controls, sections, observer, storage, context, queue, events };
}

test('only public production pages load analytics; privacy preferences prevent any load', () => {
  for (const url of ['https://preview.vercel.app/', 'https://www.seacolpaintingllc.com/',
    'http://seacolpaintingllc.com/', 'https://seacolpaintingllc.com/private/client@example.com']) {
    assert.equal(fixture({ url }).scripts.length, 0, url);
  }
  for (const navigator of [{ doNotTrack: '1' }, { globalPrivacyControl: true }, { msDoNotTrack: 'yes' }]) {
    assert.equal(fixture({ navigator }).scripts.length, 0);
  }
  assert.equal(fixture().scripts[0].src, '/_vercel/insights/script.js');
});

test('URL queries/fragments are removed; external referrer details fail closed', () => {
  const f = fixture({ url: 'https://seacolpaintingllc.com/gallery.html?email=private@example.com#secret' });
  const beforeSend = f.queue().find(args => args[0] === 'beforeSend')[1];
  assert.equal(beforeSend({ type: 'pageview', url: f.window.location.href }).url,
    'https://seacolpaintingllc.com/gallery');
  assert.equal(beforeSend({ type: 'pageview', url: 'https://other.example/private' }), null);
  assert.equal(beforeSend({ type: 'event', url: f.window.location.href, payload: { name: 'identify' } }), null);
  for (const referrer of ['https://example.com/?email=private@example.com',
    'https://example.com/client/private@example.com', 'https://example.com/#secret', 'https://user:pass@example.com/']) {
    assert.equal(fixture({ referrer }).scripts.length, 0, referrer);
  }
  assert.equal(fixture({ referrer: 'https://www.google.com/' }).scripts.length, 1);
  assert.equal(fixture({ referrer: 'https://seacolpaintingllc.com/?secret=private' }).scripts.length, 1);
});

test('gallery views are counted once while native pageviews are not duplicated', () => {
  const f = fixture({ url: 'https://seacolpaintingllc.com/gallery-cabinets' });
  assert.deepEqual(f.events(), [{ name: 'gallery_view', data: { gallery: 'cabinets' } }]);
  assert.equal(f.queue().filter(args => args[0] === 'pageview').length, 0);
  vm.runInContext(source, f.context);
  assert.equal(f.scripts.length, 1);
  assert.equal(f.events().length, 1);
});

test('contact and estimate CTA events contain fixed labels, never link contents', () => {
  const f = fixture();
  for (const href of ['tel:+12065551234', 'sms:+12065551234?body=private',
    'mailto:private@example.com?body=private', '#estimate']) {
    const anchor = target(['a[href]', '.hero']);
    anchor.getAttribute = () => href;
    f.document.dispatch('click', { target: anchor });
  }
  assert.deepEqual(f.events().map(e => e.name), ['call_click', 'sms_click', 'email_click', 'estimate_cta_click']);
  assert.equal(JSON.stringify(f.events()).includes('private'), false);
  assert.equal(JSON.stringify(f.events()).includes('12065551234'), false);
});

test('editing a form is not a conversion; only server success contract records submission', () => {
  const f = fixture();
  const field = target(['#estimate-form']);
  Object.defineProperty(field, 'value', { get() { throw Error('Form values must never be read'); } });
  f.document.dispatch('input', { target: field });
  f.document.dispatch('change', { target: field });
  f.document.dispatch('submit', { target: field });
  assert.deepEqual(f.events().map(e => e.name), ['estimate_form_start']);
  const success = { detail: { project: 'Cabinet Refinishing', email: 'private@example.com' } };
  f.document.dispatch('seacol:estimate-success', success);
  f.window.dispatch('seacol:estimate-success', success);
  assert.deepEqual(f.events()[1], { name: 'estimate_submitted', data: { project: 'cabinets', page: '/' } });
  assert.equal(f.events().length, 2);
  f.window.dispatch('seacol:estimate-success', { detail: { project: 'private@example.com' } });
  assert.equal(f.events()[2].data.project, 'other');
  assert.equal(JSON.stringify(f.events()).includes('private'), false);
});

test('sliders and sections do not multiply events during repeated interaction or scrolling', () => {
  const f = fixture();
  f.controls[0].dispatch('input'); f.controls[0].dispatch('input'); f.controls[1].dispatch('input');
  const entries = f.sections.map(section => ({ target: section, isIntersecting: true }));
  f.observer.callback(entries); f.observer.callback(entries);
  assert.equal(f.events().filter(e => e.name === 'comparison_interaction').length, 2);
  assert.equal(f.events().filter(e => e.name === 'section_view').length, 2);
  const next = fixture({ storage: f.storage });
  next.observer.callback(next.sections.map(section => ({ target: section, isIntersecting: true })));
  assert.equal(next.events().filter(e => e.name === 'section_view').length, 0);
  assert(f.events().every(event => Object.keys(event.data).length <= 2));
});

test('storage restrictions never break the page; changes to privacy preference stop events', () => {
  const navigator = {};
  const f = fixture({ storageBlocked: true, navigator });
  f.observer.callback([{ target: f.sections[0], isIntersecting: true }]);
  assert.equal(f.events().length, 1);
  navigator.globalPrivacyControl = true;
  f.controls[0].dispatch('input');
  const beforeSend = f.queue().find(args => args[0] === 'beforeSend')[1];
  assert.equal(beforeSend({ type: 'pageview', url: f.window.location.href }), null);
  assert.equal(f.events().length, 1);
});
