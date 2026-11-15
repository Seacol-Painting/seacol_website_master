'use strict';
const frame = document.querySelector('#site');
const results = document.querySelector('#results');
const summary = document.querySelector('#summary');
const run = document.querySelector('#run');
const withColorChart = new URLSearchParams(location.search).get('colorChart') === '1';
const colors = 'Wall 1: Sherwin-Williams | Alabaster | SW7008 | #EDEAE0';
const cases = [
  ['gallery-interiors.html', 'interior', 'Interior Painting'],
  ['gallery-exteriors.html', 'exterior', 'Exterior Painting'],
  ['gallery-exteriors.html', 'wood-restoration', 'Deck / Wood Restoration'],
  ['gallery-cabinets.html', 'cabinets', 'Cabinet Refinishing'],
  ['gallery-commercial.html', 'commercial', 'Commercial Painting'],
  ...['gallery.html', 'gallery-custom.html', 'gallery-process.html', 'gallery-repairs.html', 'gallery-woodwork.html']
    .map(file => [file, null, '']),
];
function assert(condition, message) { if (!condition) throw new Error(message); }
function navigate(action) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { frame.removeEventListener('load', loaded); reject(new Error('Navigation timed out')); }, 20000);
    function loaded() { clearTimeout(timeout); resolve(frame.contentDocument); }
    frame.addEventListener('load', loaded, { once: true });
    action();
  });
}
function open(path) { return navigate(() => { frame.src = path; }); }
function withinViewport(element, minimumHeight = 0) {
  element.scrollIntoView({ block: 'center', behavior: 'instant' });
  const rect = element.getBoundingClientRect();
  const win = element.ownerDocument.defaultView;
  assert(rect.width >= 44 && rect.height >= minimumHeight, 'Control is too small');
  assert(rect.left >= -1 && rect.right <= win.innerWidth + 1, 'Control extends beyond viewport');
  assert(rect.top >= -1 && rect.bottom <= win.innerHeight + 1, 'Control cannot be reached vertically');
}
function checkForm(document, expected) {
  const select = document.querySelector('[name="project"]');
  assert(select.value === expected, `Expected ${expected || 'Select one'}, got ${select.value}`);
  assert(!select.disabled, 'Project selection must remain editable');
  assert(!document.querySelector('#estimate-submit').disabled, 'Estimate script did not initialize');
  assert(document.defaultView.location.hash === '#estimate', 'Estimate anchor was lost');
  assert(document.documentElement.scrollWidth <= document.defaultView.innerWidth + 1, 'Page overflows horizontally');
  withinViewport(select, 44);
}
function input(document, name, value) {
  const element = document.querySelector(`[name="${name}"]`);
  element.value = value;
  element.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  element.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Expected form state did not appear');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
run.addEventListener('click', async () => {
  if (['seacolpaintingllc.com', 'www.seacolpaintingllc.com'].includes(location.hostname)) {
    summary.textContent = 'Refusing to run on production.';
    return;
  }
  run.disabled = true;
  results.replaceChildren();
  let passed = 0, failed = 0;
  async function test(name, callback) {
    summary.textContent = `Running: ${name}`;
    const item = document.createElement('li');
    try { await callback(); passed++; item.className = 'pass'; item.textContent = `PASS — ${name}`; }
    catch (error) { failed++; item.className = 'fail'; item.textContent = `FAIL — ${name}: ${error.message}`; }
    results.append(item);
  }
  for (const [width, height] of [[320, 568], [390, 844], [412, 915], [844, 390]]) {
    frame.width = width; frame.height = height;
    for (const [file, key, expected] of cases) {
      await test(`${width}×${height}: ${file} → ${expected || 'Select one'}`, async () => {
        const document = await open('/' + file);
        const links = [...document.querySelectorAll('.gallery-estimate-callout a')];
        const link = links.find(node => new URL(node.href).searchParams.get('project') === key);
        assert(link, 'Contextual estimate link is missing');
        withinViewport(link, 44);
        const formDocument = await navigate(() => link.click());
        checkForm(formDocument, expected);
        const url = new URL(formDocument.defaultView.location.href);
        assert([...url.searchParams.keys()].every(name => name === 'project'), 'Gallery URL contains non-service data');
        input(formDocument, 'project', 'Other');
        assert(formDocument.querySelector('[name="project"]').value === 'Other', 'Manual change failed');
      });
    }
    await test(`${width}×${height}: manual edit, failed submission, retry, receipt and reset`, async () => {
      const document = await open('/?project=exterior#estimate');
      const win = document.defaultView;
      checkForm(document, 'Exterior Painting');
      for (const [name, value] of Object.entries({ name: 'Synthetic QA', email: 'qa@example.com',
        phone: '', city: 'Seattle', project: 'Interior Painting', details: 'Synthetic test: walls and trim.' })) input(document, name, value);
      document.querySelector('[name="consent"]').checked = true;
      const requests = [];
      win.fetch = async (url, options) => {
        assert(url === '/api/estimate' && options.method === 'POST', 'Submission contract changed');
        requests.push(JSON.parse(options.body));
        if (requests.length === 1) throw new win.TypeError('Synthetic offline test');
        return { ok: true, status: 201, json: async () => ({ ok: true, reference: 'SC-BROWSER-QA' }) };
      };
      const form = document.querySelector('#estimate-form');
      assert(form.reportValidity(), 'Synthetic form data should be valid');
      form.requestSubmit();
      await until(() => document.querySelector('#estimate-status').dataset.state === 'error');
      assert(document.querySelector('[name="project"]').value === 'Interior Painting', 'Failed request lost manual choice');
      form.requestSubmit();
      await until(() => document.querySelector('#estimate-status').dataset.state === 'success');
      assert(requests.length === 2, 'Unexpected request count');
      assert(JSON.stringify(requests[0]) === JSON.stringify(requests[1]), 'Retry changed payload or UUID');
      assert(requests[0].project === 'Interior Painting', 'Submission ignored manual selection');
      assert(!('projectKey' in requests[0]) && !('colors' in requests[0]), 'Unsupported payload fields');
      assert(win.location.search === '?project=exterior', 'Personal data or edited values entered the URL');
      document.querySelector('#estimate-another').click();
      assert(document.querySelector('[name="project"]').value === '', 'Reset reapplied stale service');
    });
    await test(`${width}×${height}: Color Chart coexistence (${withColorChart ? 'PR #19' : 'main'})`, async () => {
      const path = '/?project=cabinets&colors=' + encodeURIComponent(colors) + '#estimate';
      const document = await open(path);
      checkForm(document, 'Cabinet Refinishing');
      const details = document.querySelector('[name="details"]');
      assert(details.value === (withColorChart ? 'Color Chart selections\n' + colors : ''), 'Color Chart notes changed unexpectedly');
      input(document, 'details', 'My editable project notes');
      input(document, 'project', 'Other');
      assert(details.value === 'My editable project notes', 'Changing project overwrote notes');
      assert(new URL(document.defaultView.location.href).searchParams.get('colors') === colors, 'Color Chart parameter was lost');
    });
    await test(`${width}×${height}: invalid and duplicate parameters`, async () => {
      for (const search of ['?project=%3Cscript%3E', '?project=exterior&project=interior', '?project=constructor']) {
        checkForm(await open('/' + search + '#estimate'), '');
      }
    });
  }
  summary.textContent = `${passed} passed; ${failed} failed. ${withColorChart ? 'PR #19 compatibility' : 'Main branch'} complete.`;
  summary.dataset.passed = passed;
  summary.dataset.failed = failed;
  run.disabled = false;
});
