'use strict';

/**
 * WhatsApp send adapter — supports two providers:
 *
 *   WHATSAPP_PROVIDER=meta   → Meta Cloud API (direct)
 *   WHATSAPP_PROVIDER=twilio → Twilio WhatsApp sandbox / production
 *
 * Set the appropriate env vars (see .env.example) and flip the provider.
 * No code changes needed when switching.
 */

const PROVIDER = process.env.WHATSAPP_PROVIDER || 'meta';

// ── Meta Cloud API ────────────────────────────────────────────────────────────
async function sendViaMeta(to, text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token         = process.env.WHATSAPP_ACCESS_TOKEN;
  const version       = process.env.META_GRAPH_VERSION || 'v19.0';

  const res = await fetch(
    `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Meta WhatsApp error ${res.status}: ${err?.error?.message || 'unknown'}`);
  }
  return res.json();
}

// ── Twilio WhatsApp ───────────────────────────────────────────────────────────
async function sendViaTwilio(to, text) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_WHATSAPP_FROM; // e.g. whatsapp:+14155238886

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const body = new URLSearchParams({
    From: from,
    To:   `whatsapp:${to}`,
    Body: text,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method:  'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        Authorization:   `Basic ${credentials}`,
      },
      body: body.toString(),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Twilio error ${res.status}: ${err?.message || 'unknown'}`);
  }
  return res.json();
}

// ── Public API ────────────────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, text) {
  if (PROVIDER === 'twilio') return sendViaTwilio(to, text);
  return sendViaMeta(to, text);
}

/**
 * Parse incoming webhook body to a unified message object.
 * Works for both Meta and Twilio formats.
 *
 * Returns: { from: string, text: string, messageId: string } or null
 */
function parseIncomingMessage(body, provider = PROVIDER) {
  try {
    if (provider === 'twilio') {
      const from = (body.From || '').replace('whatsapp:', '');
      return from ? { from, text: body.Body || '', messageId: body.MessageSid } : null;
    }

    // Meta format
    const entry   = body?.entry?.[0];
    const change  = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message) return null;

    return {
      from:      message.from,
      text:      message.text?.body || '',
      messageId: message.id,
    };
  } catch {
    return null;
  }
}

/**
 * Verify Meta webhook challenge (GET request during setup).
 */
function verifyMetaWebhook(queryParams) {
  const mode      = queryParams['hub.mode'];
  const token     = queryParams['hub.verify_token'];
  const challenge = queryParams['hub.challenge'];
  const expected  = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expected) return challenge;
  return null;
}

module.exports = { sendWhatsAppMessage, parseIncomingMessage, verifyMetaWebhook };
