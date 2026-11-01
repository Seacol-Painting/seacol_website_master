// Direct submissions keep contact details out of website URLs and browser storage.
(() => {
  'use strict';
  const form = document.querySelector('#estimate-form');
  if (!form) return;
  const fields = document.querySelector('#estimate-fields');
  const submit = document.querySelector('#estimate-submit');
  const status = document.querySelector('#estimate-status');
  const colorLab = document.querySelector('#estimate-color-lab');
  const another = document.querySelector('#estimate-another');
  const fallback = document.querySelector('#request-options');
  const copyStatus = document.querySelector('#copy-status');
  let pending = false;
  let accepted = false;
  let lastPayload = '';
  let submissionId;

  function message(text, state) {
    if (state === 'success') {
      const eyebrow = document.createElement('span');
      eyebrow.className = 'estimate-receipt-eyebrow';
      eyebrow.textContent = 'Request received';
      const title = document.createElement('h3');
      title.className = 'estimate-receipt-title';
      title.textContent = 'A beautiful space begins with your vision.';
      const copy = document.createElement('p');
      copy.className = 'estimate-receipt-copy';
      copy.textContent = text;
      status.replaceChildren(eyebrow, title, copy);
    } else {
      status.textContent = text;
    }
    status.dataset.state = state;
    status.hidden = false;
    if (colorLab) colorLab.hidden = state !== 'success';
  }
  function showFallback(data) {
    const request = prepareEstimateRequest(data);
    document.querySelector('#send-email').href = request.email;
    document.querySelector('#send-text').href = request.sms;
    document.querySelector('#request-preview').value = request.body;
    copyStatus.textContent = '';
    fallback.hidden = false;
  }
  function clearFallback() {
    fallback.hidden = true;
    document.querySelector('#send-email').href = 'mailto:info@seacolpaintingllc.com';
    document.querySelector('#send-text').href = 'sms:+12065732474';
    document.querySelector('#request-preview').value = '';
    copyStatus.textContent = '';
  }
  submit.disabled = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || accepted || !form.reportValidity()) return;
    const data = new FormData(form);
    const payload = Object.fromEntries(['name', 'email', 'phone', 'city', 'project', 'property', 'details', 'website']
      .map((key) => [key, String(data.get(key) || '').trim()]));
    payload.consent = data.get('consent') === 'on';
    const snapshot = JSON.stringify(payload);
    // Reuse this ID on a timeout/retry; a lost response must not create a second request.
    if (snapshot !== lastPayload || !submissionId) {
      submissionId = crypto.randomUUID();
      lastPayload = snapshot;
    }
    pending = true;
    submit.disabled = true;
    fields.disabled = true;
    submit.textContent = 'Sending your request…';
    clearFallback();
    form.setAttribute('aria-busy', 'true');
    message('Sending your request securely…', 'pending');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ...payload, submissionId }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true || typeof result.reference !== 'string' || !/^SC-[A-Z0-9-]+$/.test(result.reference)) {
        let text = 'We couldn’t confirm receipt. Your details are still here. Please try again, or contact us below.';
        if (response.status === 429) text = 'Please wait before sending another request, or contact SEACOL by email or phone. Your details are still here.';
        else if (response.status === 400 || response.status === 422) text = 'Please check your contact details, project description and consent, then try again.';
        else if (response.status === 409) text = 'Please review your details and try again. We could not confirm this version of your request.';
        throw new Error(text);
      }
      accepted = true;
      message('Thank you for considering SEACOL. We’ve received your request and look forward to exploring the possibilities with you. We’ll be in touch soon.', 'success');
      fields.hidden = true;
      submit.hidden = true;
      another.hidden = false;
      // Only an acknowledged, durable request counts as a submission.
      if (!result.duplicate) document.dispatchEvent(new CustomEvent('seacol:estimate-success', { detail: { project: payload.project } }));
    } catch (error) {
      const text = error.name === 'AbortError' || error instanceof TypeError
        ? 'We couldn’t confirm receipt because the connection was interrupted. Your details are still here. Please retry; the same request will not be saved twice.'
        : error.message;
      message(text, 'error');
      showFallback(data);
    } finally {
      clearTimeout(timeout);
      pending = false;
      form.setAttribute('aria-busy', 'false');
      fields.disabled = false;
      submit.disabled = accepted;
      submit.textContent = 'Send My Estimate Request';
      status.focus({ preventScroll: true });
      if (accepted) status.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  });

  another.addEventListener('click', () => {
    form.reset();
    accepted = false;
    submissionId = undefined;
    lastPayload = '';
    fields.hidden = false;
    submit.hidden = false;
    submit.disabled = false;
    another.hidden = true;
    status.hidden = true;
    if (colorLab) colorLab.hidden = true;
    clearFallback();
    form.querySelector('[name="name"]').focus();
  });
  form.addEventListener('input', (event) => {
    if (!pending && !event.target.closest('#request-options')) clearFallback();
  });
  document.querySelector('#copy-request').addEventListener('click', async () => {
    const preview = document.querySelector('#request-preview');
    try {
      await navigator.clipboard.writeText(preview.value);
      copyStatus.textContent = 'Request copied. Paste it into your email or messaging app.';
    } catch {
      preview.focus(); preview.select();
      copyStatus.textContent = 'Select and copy the request above, then paste it into your email or messaging app.';
    }
  });
})();
