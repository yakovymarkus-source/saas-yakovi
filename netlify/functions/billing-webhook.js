/**
 * billing-webhook.js — Provider-agnostic payment webhook receiver.
 *
 * Routes through payment-service which handles:
 *   verification → parsing → normalization → idempotency → business action → persistence
 *
 * This file does NOT know which payment provider is active.
 * The active provider is selected by PAYMENT_PROVIDER env var.
 *
 * For Stripe: requires raw body (isRawBody = true in netlify.toml).
 * For Grow:   this endpoint is NOT called (Grow uses payment-pending instead).
 */

const { ok, respond }                           = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { processWebhook, getActiveProvider }      = require('./_shared/payments');
const {
  sendBillingConfirmation,
  sendPaymentFailed,
  sendSubscriptionRenewed,
  sendSubscriptionCanceled,
} = require('./_shared/email');

exports.handler = async (event) => {
  const context = createRequestContext(event, 'billing-webhook');

  try {
    const provider = getActiveProvider();

    // Verify + parse + apply business action through payment-service
    let result;
    try {
      result = await processWebhook({
        rawBody:          event.body,
        headers:          event.headers || {},
        body:             (() => { try { return JSON.parse(event.body); } catch { return {}; } })(),
        isBase64Encoded:  event.isBase64Encoded || false,
      });
    } catch (verifyErr) {
      await writeRequestLog(
        buildLogPayload(context, 'warn', 'billing_webhook_verification_failed', { error: verifyErr.message })
      ).catch(() => {});
      return respond(400, { ok: false, message: 'Webhook verification failed' }, context.requestId);
    }

    // ── Send transactional emails based on normalized event type ───────────────
    if (result.ok && result.action !== 'skipped_duplicate') {
      await _sendEventEmail(result.eventType, event, context).catch(err =>
        console.warn('[billing-webhook] email send failed:', err.message)
      );
    }

    await writeRequestLog(buildLogPayload(context, 'info', 'billing_webhook_processed', {
      event_type: result.eventType,
      action:     result.action,
      provider:   provider.getName(),
    }));

    return ok({ received: true }, context.requestId);

  } catch (error) {
    await writeRequestLog(
      buildLogPayload(context, 'error', 'billing_webhook_processing_failed', { code: error.code || 'INTERNAL_ERROR' })
    ).catch(() => {});
    // Always return 200 to prevent provider from retrying on our application errors
    return ok({ received: true, warning: 'processing_error' }, context.requestId);
  }
};

// ── Email dispatch ─────────────────────────────────────────────────────────────

async function _sendEventEmail(eventType, rawEvent, context) {
  // Resolve user email from Stripe customer or from DB lookup
  const to = await _resolveUserEmail(rawEvent);
  if (!to) return;

  switch (eventType) {
    case 'payment.succeeded':
    case 'subscription.activated':
      await sendBillingConfirmation({ to });
      break;
    case 'payment.renewed':
      await sendSubscriptionRenewed({ to });
      break;
    case 'payment.failed':
      await sendPaymentFailed({ to });
      break;
    case 'subscription.canceled':
      await sendSubscriptionCanceled({ to });
      break;
    default:
      break;
  }
}

async function _resolveUserEmail(rawEvent) {
  try {
    const body = (() => { try { return JSON.parse(rawEvent.body); } catch { return {}; } })();
    const customerId = body?.data?.object?.customer;
    if (!customerId) return null;

    const sb = getAdminClient();
    const { data: sub } = await sb
      .from('subscriptions').select('user_id')
      .eq('stripe_customer_id', customerId).maybeSingle();
    if (!sub?.user_id) return null;

    const { data: profile } = await sb
      .from('profiles').select('email')
      .eq('id', sub.user_id).maybeSingle();
    return profile?.email || null;
  } catch {
    return null;
  }
}
