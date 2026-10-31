/* First-party Vercel Web Analytics. Never send form values or contact links.
 * The public site uses the documented window.va queue and beforeSend hook:
 * https://vercel.com/docs/analytics/redacting-sensitive-data
 */
(() => {
  'use strict';

  const HOST = 'seacolpaintingllc.com';
  const ORIGIN = `https://${HOST}`;
  const PATHS = new Set([
    '/', '/gallery', '/gallery-cabinets', '/gallery-interiors',
    '/gallery-exteriors', '/gallery-custom', '/gallery-commercial',
    '/gallery-process', '/gallery-woodwork', '/gallery-repairs', '/privacy',
  ]);
  const EVENTS = new Set([
    'gallery_view', 'estimate_cta_click', 'estimate_form_start',
    'call_click', 'sms_click', 'email_click', 'comparison_interaction',
    'section_view', 'estimate_submitted',
  ]);
  const PROJECTS = new Map([
    ['Interior Painting', 'interior'], ['Exterior Painting', 'exterior'],
    ['Cabinet Refinishing', 'cabinets'], ['Commercial Painting', 'commercial'],
    ['Deck / Wood Restoration', 'wood-restoration'], ['Other', 'other'],
  ]);

  function optedOut() {
    return navigator.globalPrivacyControl === true ||
      [navigator.doNotTrack, navigator.msDoNotTrack, window.doNotTrack]
        .some(value => value === '1' || value === 'yes');
  }

  function pagePath(value) {
    try {
      const url = new URL(value, ORIGIN);
      if (url.origin !== ORIGIN || url.username || url.password) return null;
      let path = url.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
      if (path === '/index') path = '/';
      return PATHS.has(path) ? path : null;
    } catch (_) {
      return null;
    }
  }

  function safeReferrer() {
    if (!document.referrer) return true;
    try {
      const referrer = new URL(document.referrer);
      if (!['http:', 'https:'].includes(referrer.protocol) ||
          referrer.username || referrer.password) return false;
      // Vercel omits same-host referrers. External referrers are read separately
      // from beforeSend, so do not collect a document with a sensitive-looking
      // external path, query or fragment; the hook cannot redact that field.
      if (referrer.hostname === HOST) return true;
      return referrer.pathname === '/' && !referrer.search && !referrer.hash;
    } catch (_) {
      return false;
    }
  }

  const page = pagePath(window.location.href);
  if (window.location.hostname !== HOST || window.location.protocol !== 'https:' ||
      !page || optedOut() || !safeReferrer() || window.__seacolAnalyticsLoaded) return;
  window.__seacolAnalyticsLoaded = true;
  window.va = window.va || function () {
    (window.vaq = window.vaq || []).push(arguments);
  };

  window.va('beforeSend', event => {
    if (optedOut() || !safeReferrer()) return null;
    const path = pagePath(event.url);
    if (!path) return null;
    if (event.type === 'event' && event.payload && !EVENTS.has(event.payload.name)) return null;
    return { ...event, url: ORIGIN + path };
  });

  function track(name, properties = {}) {
    if (optedOut() || !safeReferrer()) return;
    // Callers pass only fixed labels, page paths and allowlisted categories.
    // Pro supports two custom properties; no persistent visitor identifier.
    try { window.va('event', { name, data: properties }); } catch (_) { /* optional telemetry */ }
  }

  const collector = document.createElement('script');
  collector.src = '/_vercel/insights/script.js';
  collector.defer = true;
  collector.referrerPolicy = 'no-referrer';
  // Native pageviews are automatic; do not send a second page_view event.
  document.head.appendChild(collector);

  if (page === '/gallery' || page.startsWith('/gallery-')) {
    track('gallery_view', { gallery: page === '/gallery' ? 'all' : page.slice(9) });
  }

  function placement(element) {
    if (element.closest('header')) return 'header';
    if (element.closest('footer')) return 'footer';
    if (element.closest('.hero')) return 'hero';
    if (element.closest('#estimate')) return 'estimate';
    return 'content';
  }

  document.addEventListener('click', event => {
    const anchor = event.target && event.target.closest && event.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    const contact = /^tel:/i.test(href) ? 'call_click' :
      /^sms:/i.test(href) ? 'sms_click' : /^mailto:/i.test(href) ? 'email_click' : null;
    if (contact) {
      track(contact, { placement: placement(anchor), page });
      return;
    }
    try {
      const target = new URL(href, window.location.href);
      if (target.origin === ORIGIN && pagePath(target.href) === '/' && target.hash === '#estimate') {
        track('estimate_cta_click', { placement: placement(anchor), page });
      }
    } catch (_) { /* not a navigable website link */ }
  }, { passive: true });

  let formStarted = false;
  function startForm(event) {
    const field = event.target;
    if (formStarted || !field || !field.closest || !field.closest('#estimate-form') ||
        field.type === 'hidden' || field.readOnly) return;
    formStarted = true;
    track('estimate_form_start', { page });
  }
  document.addEventListener('input', startForm, { passive: true });
  document.addEventListener('change', startForm, { passive: true });

  const successes = new WeakSet();
  function completedEstimate(event) {
    if (successes.has(event)) return;
    successes.add(event);
    const project = PROJECTS.get(event.detail && event.detail.project) || 'other';
    track('estimate_submitted', { project, page });
  }
  // Application code dispatches this only after the server confirms storage.
  // Listening on both supports a document event and a direct window event.
  document.addEventListener('seacol:estimate-success', completedEstimate);
  window.addEventListener('seacol:estimate-success', completedEstimate);

  document.querySelectorAll('[data-comparison]').forEach((comparison, index) => {
    const control = comparison.querySelector('input[type="range"]');
    if (!control) return;
    control.addEventListener('input', () => {
      track('comparison_interaction', { component: `comparison-${index + 1}`, page });
    }, { once: true, passive: true });
  });

  if ('IntersectionObserver' in window) {
    const seen = new Set();
    const labels = new Map();
    const sectionNames = ['hero', 'about', 'services', 'projects', 'transformations',
      'portfolio', 'process', 'commercial-proof', 'estimate', 'category-hero', 'gallery-section'];
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting || document.visibilityState === 'hidden') return;
        const section = labels.get(entry.target);
        if (!section || seen.has(section)) return;
        seen.add(section);
        observer.unobserve(entry.target);
        const key = `seacol.analytics.section:${page}:${section}`;
        try {
          if (sessionStorage.getItem(key)) return;
          sessionStorage.setItem(key, '1');
        } catch (_) { /* memory-only deduplication when storage is unavailable */ }
        track('section_view', { section, page });
      });
    }, { threshold: 0, rootMargin: '0px 0px -25% 0px' });
    document.querySelectorAll('main > section').forEach((section, index) => {
      const name = sectionNames.find(value => section.id === value || section.classList.contains(value));
      labels.set(section, name || `section-${index + 1}`);
      observer.observe(section);
    });
  }
})();
