// Optional owner notification. Private estimate storage is the durable inbox.
// Configure only after Resend is connected and the sending domain is verified.
import { put } from '@vercel/blob';

const OWNER_EMAIL = 'info@seacolpaintingllc.com';

export function createNotifier({ env = process.env, fetcher = fetch, saveStatus = put } = {}) {
  return async function notify(record) {
    // Preview and local verification must never notify the real business inbox.
    if (record.environment !== 'production') return { status: 'not_production' };
    const from = env.ESTIMATE_NOTIFICATION_FROM;
    if (!env.RESEND_API_KEY || !from) return { status: 'not_configured' };
    // The owner destination and sending domain cannot be overridden by visitor input.
    if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@seacolpaintingllc\.com$/i.test(from)) {
      return { status: 'invalid_configuration' };
    }
    const { form } = record;
    const lines = [
      `New website estimate request: ${record.reference}`,
      `Received: ${record.createdAt}`,
      '',
      `Name: ${form.name}`,
      `Email: ${form.email}`,
      `Phone: ${form.phone || 'Not provided'}`,
      `City: ${form.city}`,
      `Project: ${form.project}`,
      `Property: ${form.property}`,
      '',
      'Project details:',
      form.details,
      '',
      'This request is also saved in the private SEACOL website inbox in Vercel Storage.',
    ];
    let state;
    try {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `seacol-estimate/${record.submissionId}`,
        },
        body: JSON.stringify({
          from: `SEACOL Website <${from}>`,
          to: [OWNER_EMAIL],
          reply_to: form.email,
          subject: `Website estimate ${record.reference} — ${form.project}`,
          text: lines.join('\n'),
        }),
        signal: AbortSignal.timeout(4000),
      });
      const result = await response.json().catch(() => null);
      state = response.ok && typeof result?.id === 'string' && result.id.length > 0
        ? { status: 'accepted', providerId: result.id }
        : { status: 'failed', httpStatus: response.status };
    } catch {
      state = { status: 'failed' };
    }
    // Store only delivery metadata here. No email body or provider error text in logs.
    try {
      await saveStatus(`notifications/${record.submissionId}.json`, JSON.stringify({
        ...state, reference: record.reference, updatedAt: new Date().toISOString(),
      }), {
        access: 'private', addRandomSuffix: false, allowOverwrite: true,
        contentType: 'application/json', cacheControlMaxAge: 60,
        abortSignal: AbortSignal.timeout(2000),
      });
    } catch { /* The original request remains in the private inbox. */ }
    return state;
  };
}

export const notifyEstimate = createNotifier();
