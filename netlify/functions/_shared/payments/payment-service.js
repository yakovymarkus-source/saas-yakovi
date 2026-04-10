'use strict';

/**
 * payment-service.js — Business orchestration layer for payments.
 *
 * This is the ONLY layer that business code (endpoints, UI responses) should call.
 * It knows nothing about Grow, Stripe, or any specific provider.
 *
 * Responsibilities:
 *   - Route to the active provider via factory
 *   - Grant / revoke user access based on normalized events
 *   - Persist payment events to the database
 *   - Idempotency guard on external event IDs
 *   - Structured logging at every step
 *   - Never expose raw provider data to callers
 */

const { getActiveProvider }    = require('./factory');
const { getAdminClient }       = require('../supabase');
const { SUBSCRIPTION_STATUS, ACTIVE_SUBSCRIPTION_STATUSES } = require('./statuses');

// ── Checkout ──────────────────────────────────────────────────────────────────

/**
 * Create a checkout session / payment link for the given plan.
 *
 * @param {{ userId, email, planId, priceId, successUrl, cancelUrl }} input
 * @returns {Promise<{ url: string, sessionId?: string, provider: string, requiresManualVerification: boolean }>}
 */
async function createCheckoutSession(input) {
  const provider = getActiveProvider();
  console.info(`[payment-service] createCheckoutSession provider=${provider.getName()} plan=${input.planId}`);

  const result = await provider.createCheckoutSession(input);

  return {
    ...result,
    provider:                  provider.getName(),
    requiresManualVerification: provider.requiresManualVerification,
  };
}

// ── Webhook pipeline ──────────────────────────────────────────────────────────

/**
 * Full webhook pipeline:
 *   RAW → verify → parse → normalize → idempotency → business action → persist → log
 *
 * @param {{ rawBody, headers, body, isBase64Encoded }} req
 * @returns {Promise<{ ok: boolean, eventType: string, action: string }>}
 */
async function processWebhook(req) {
  const provider = getActiveProvider();
  const name     = provider.getName();

  // 1. Verify signature (if supported)
  try {
    const rawBody = req.isBase64Encoded
      ? Buffer.from(req.rawBody, 'base64')
      : req.rawBody;

    if (provider.supportsWebhookSignature) {
      provider.verifyWebhook({ rawBody, headers: req.headers });
      console.info(`[payment-service] webhook signature verified provider=${name}`);
    } else {
      console.info(`[payment-service] webhook signature skipped (not supported by ${name})`);
    }
  } catch (err) {
    console.warn(`[payment-service] webhook verification failed provider=${name}:`, err.message);
    throw err;
  }

  // 2. Parse + normalize
  const rawBody = req.isBase64Encoded
    ? Buffer.from(req.rawBody, 'base64')
    : req.rawBody;

  const normalizedEvent = provider.parseWebhookEvent({
    rawBody,
    headers: req.headers,
    body:    req.body,
  });

  console.info(`[payment-service] event parsed`, {
    eventType:       normalizedEvent.eventType,
    internalStatus:  normalizedEvent.internalStatus,
    userId:          normalizedEvent.userId,
    planId:          normalizedEvent.planId,
    provider:        name,
  });

  // 3. Idempotency — skip if already processed
  const alreadyProcessed = await _checkIdempotency(normalizedEvent.externalEventId);
  if (alreadyProcessed) {
    console.info(`[payment-service] duplicate event skipped: ${normalizedEvent.externalEventId}`);
    return { ok: true, eventType: normalizedEvent.eventType, action: 'skipped_duplicate' };
  }

  // 4. Business action
  const action = await _applyBusinessAction(normalizedEvent);

  // 5. Persist event
  await _persistPaymentEvent(normalizedEvent);

  return { ok: true, eventType: normalizedEvent.eventType, action };
}

// ── Portal ────────────────────────────────────────────────────────────────────

/**
 * Get billing portal URL (provider must support it).
 *
 * @param {{ userId, returnUrl }} input
 * @returns {Promise<{ url: string }|null>}
 */
async function getBillingPortalUrl({ userId, returnUrl }) {
  const provider = getActiveProvider();

  if (!provider.supportsPortal) {
    console.info(`[payment-service] portal not supported by provider=${provider.getName()}`);
    return null;
  }

  const { getSubscription } = require('../billing');
  const sub = await getSubscription(userId);
  if (!sub?.stripe_customer_id) return null;

  return provider.buildCustomerPortalLink({
    userId,
    customerId: sub.stripe_customer_id,
    returnUrl,
  });
}

// ── Cancel ────────────────────────────────────────────────────────────────────

/**
 * Cancel a user's subscription via the active provider.
 *
 * @param {{ userId, prorate }} input
 * @returns {Promise<void>}
 */
async function cancelSubscription({ userId, prorate = true }) {
  const provider = getActiveProvider();
  const { getSubscription } = require('../billing');
  const sub = await getSubscription(userId);

  if (!sub) {
    const { AppError } = require('../errors');
    throw new AppError({
      code:        'NO_SUBSCRIPTION',
      userMessage: 'לא נמצא מנוי פעיל',
      devMessage:  `No subscription found for user ${userId}`,
      status:      404,
    });
  }

  console.info(`[payment-service] cancelSubscription userId=${userId} provider=${provider.getName()}`);

  if (provider.supportsSubscriptions && sub.stripe_sub_id) {
    await provider.cancelSubscription({ subscriptionId: sub.stripe_sub_id, prorate });
  }

  // Always update DB regardless of provider capability
  await getAdminClient()
    .from('subscriptions')
    .update({ status: SUBSCRIPTION_STATUS.CANCELED, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  console.info(`[payment-service] subscription canceled userId=${userId}`);
}

// ── Access helpers ────────────────────────────────────────────────────────────

/**
 * Grant plan access to a user.
 * @param {{ userId, plan, providerCustomerId, providerSubscriptionId }} input
 */
async function grantAccess({ userId, plan, providerCustomerId = null, providerSubscriptionId = null }) {
  const sb = getAdminClient();
  await sb.from('subscriptions').upsert({
    user_id:               userId,
    plan,
    status:                SUBSCRIPTION_STATUS.ACTIVE,
    payment_status:        'verified',
    stripe_customer_id:    providerCustomerId,
    stripe_sub_id:         providerSubscriptionId,
    updated_at:            new Date().toISOString(),
  }, { onConflict: 'user_id' });

  console.info(`[payment-service] access granted userId=${userId} plan=${plan}`);
}

/**
 * Revoke access (set to free/inactive).
 * @param {{ userId, reason }} input
 */
async function revokeAccess({ userId, reason }) {
  await getAdminClient()
    .from('subscriptions')
    .update({
      status:     SUBSCRIPTION_STATUS.CANCELED,
      plan:       'free',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  console.info(`[payment-service] access revoked userId=${userId} reason=${reason}`);
}

// ── Provider info ─────────────────────────────────────────────────────────────

/**
 * Returns capability flags and name of the active provider.
 * Useful for UI to know what features to show/hide.
 */
function getProviderCapabilities() {
  const p = getActiveProvider();
  return {
    name:                     p.getName(),
    supportsSubscriptions:    p.supportsSubscriptions,
    supportsRefunds:          p.supportsRefunds,
    supportsPortal:           p.supportsPortal,
    supportsWebhookSignature: p.supportsWebhookSignature,
    supportsTrials:           p.supportsTrials,
    supportsCoupons:          p.supportsCoupons,
    requiresManualVerification: p.requiresManualVerification,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _checkIdempotency(externalEventId) {
  if (!externalEventId) return false;
  const sb = getAdminClient();
  const { data } = await sb
    .from('payment_events')
    .select('id')
    .eq('external_event_id', externalEventId)
    .maybeSingle();
  return !!data;
}

async function _applyBusinessAction(event) {
  const { eventType, userId, planId, internalStatus,
          customerId, subscriptionId, periodEnd } = event;

  if (!userId) {
    console.warn(`[payment-service] no userId in event ${event.externalEventId} — skipping business action`);
    return 'skipped_no_user';
  }

  const sb = getAdminClient();

  switch (eventType) {
    case 'subscription.updated':
    case 'payment.succeeded': {
      if (!ACTIVE_SUBSCRIPTION_STATUSES.has(internalStatus) && internalStatus !== 'paid') {
        return 'no_action';
      }
      await sb.from('subscriptions').upsert({
        user_id:            userId,
        plan:               planId || 'free',
        status:             ACTIVE_SUBSCRIPTION_STATUSES.has(internalStatus)
                              ? internalStatus
                              : SUBSCRIPTION_STATUS.ACTIVE,
        stripe_customer_id: customerId,
        stripe_sub_id:      subscriptionId,
        current_period_end: periodEnd || null,
        updated_at:         new Date().toISOString(),
      }, { onConflict: 'user_id' });
      console.info(`[payment-service] access granted userId=${userId} plan=${planId} status=${internalStatus}`);
      return 'access_granted';
    }

    case 'payment.renewed': {
      // Renewal — extend period, keep existing plan
      await sb.from('subscriptions')
        .update({ current_period_end: periodEnd, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      return 'period_extended';
    }

    case 'subscription.canceled':
    case 'payment.failed': {
      await revokeAccess({ userId, reason: eventType });
      return 'access_revoked';
    }

    case 'subscription.activated': {
      // Grow manual activation
      await grantAccess({
        userId,
        plan:                   planId || 'early_bird',
        providerCustomerId:     customerId,
        providerSubscriptionId: subscriptionId,
      });
      return 'access_granted';
    }

    case 'payment.pending': {
      // Grow — recorded pending, waiting for admin
      await sb.rpc('set_payment_pending', { p_user_id: userId, p_plan: planId });
      return 'pending_recorded';
    }

    default:
      return 'no_action';
  }
}

async function _persistPaymentEvent(event) {
  const sb = getAdminClient();
  try {
    await sb.from('payment_events').insert({
      user_id:             event.userId,
      provider_name:       event.providerName,
      external_event_id:   event.externalEventId,
      external_customer_id:event.customerId,
      external_sub_id:     event.subscriptionId,
      event_type:          event.eventType,
      internal_status:     event.internalStatus,
      raw_status:          event.rawStatus,
      plan:                event.planId,
      amount_cents:        event.amountCents,
      currency:            event.currency,
      period_start:        event.periodStart,
      period_end:          event.periodEnd,
      raw_payload:         event.rawPayload,
    });
  } catch (err) {
    // Don't fail the whole pipeline on persistence error — log and continue
    if (!err?.message?.includes('duplicate key')) {
      console.warn('[payment-service] failed to persist payment event:', err.message);
    }
  }
}

module.exports = {
  createCheckoutSession,
  processWebhook,
  getBillingPortalUrl,
  cancelSubscription,
  grantAccess,
  revokeAccess,
  getProviderCapabilities,
};
