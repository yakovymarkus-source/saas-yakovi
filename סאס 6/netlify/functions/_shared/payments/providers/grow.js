'use strict';

/**
 * providers/grow.js — Grow payment provider
 *
 * Grow (grow.link) is a link-based manual payment processor used for
 * one-time payments (early_bird / pro plans).
 *
 * Flow:
 *   1. User clicks Grow payment link (URL from env or config)
 *   2. User completes payment on Grow's hosted page
 *   3. Frontend calls payment-pending endpoint with plan + user token
 *   4. System marks subscription as payment_status='pending'
 *   5. Admin receives alert, verifies in Grow dashboard, calls activate-payment
 *   6. System sets payment_status='verified', status='active' → access granted
 *
 * Capabilities:
 *   - supportsSubscriptions:    false  (one-time payments only)
 *   - supportsRefunds:          false  (manual via Grow dashboard)
 *   - supportsPortal:           false  (no subscription management portal)
 *   - supportsWebhookSignature: false  (no cryptographic webhook signature)
 *   - requiresManualVerification: true
 *
 * TODO: If Grow adds a webhook API with HMAC signing in the future:
 *   - Set supportsWebhookSignature = true
 *   - Implement verifyWebhook() using GROW_WEBHOOK_SECRET
 *   - Set GROW_WEBHOOK_URL in Grow dashboard to /.netlify/functions/billing-webhook
 */

const { PaymentProvider }   = require('../contract');
const { SUBSCRIPTION_STATUS, PAYMENT_STATUS } = require('../statuses');

// Payment link config — plan → Grow URL (from env vars, not hardcoded)
// Set these in Netlify environment variables.
const GROW_LINKS = {
  early_bird: () => process.env.GROW_LINK_EARLY_BIRD || null,
  pro:        () => process.env.GROW_LINK_PRO        || null,
  pro_upgrade:() => process.env.GROW_LINK_PRO_UPGRADE || null,
};

// Grow's manual payment status strings → internal canonical status
const STATUS_MAP = {
  pending:  SUBSCRIPTION_STATUS.PENDING,
  verified: SUBSCRIPTION_STATUS.ACTIVE,
  failed:   SUBSCRIPTION_STATUS.INACTIVE,
  refunded: SUBSCRIPTION_STATUS.CANCELED,
};

class GrowProvider extends PaymentProvider {
  getName() { return 'grow'; }

  isConfigured() {
    // API key + terminal ID required for API calls; at least one link for checkout
    return !!(process.env.GROW_API_KEY && process.env.GROW_TERMINAL_ID) ||
           Object.values(GROW_LINKS).some(fn => !!fn());
  }

  /** Grow API credentials — used for server-side verification if needed */
  get apiKey()     { return process.env.GROW_API_KEY     || null; }
  get terminalId() { return process.env.GROW_TERMINAL_ID || null; }

  // ── Capabilities ─────────────────────────────────────────────────────────────
  get supportsSubscriptions()      { return false; }
  get supportsRefunds()            { return false; }
  get supportsPortal()             { return false; }
  get supportsWebhookSignature()   { return false; }
  get supportsTrials()             { return false; }
  get supportsCoupons()            { return false; }
  get requiresManualVerification() { return true;  }

  /**
   * Returns the Grow payment URL for the requested plan.
   * There is no server-side session creation with Grow — we return the link.
   *
   * @param {{ planId: string }} input
   * @returns {{ url: string, sessionId: null }}
   */
  async createCheckoutSession({ planId }) {
    const linkFn = GROW_LINKS[planId];
    if (!linkFn) {
      const { AppError } = require('../../errors');
      throw new AppError({
        code:        'GROW_UNSUPPORTED_PLAN',
        userMessage: `תוכנית ${planId} אינה זמינה לתשלום דרך Grow`,
        devMessage:  `No Grow payment link configured for plan: ${planId}`,
        status:      400,
      });
    }

    const url = linkFn();
    if (!url) {
      const { AppError } = require('../../errors');
      throw new AppError({
        code:        'GROW_LINK_NOT_CONFIGURED',
        userMessage: 'קישור התשלום אינו מוגדר',
        devMessage:  `GROW_LINK_${planId.toUpperCase()} env var is missing`,
        status:      500,
      });
    }

    return { url, sessionId: null };
  }

  /**
   * Grow doesn't send signed webhooks — the "webhook" is the frontend
   * calling payment-pending with the user's JWT. Auth is validated upstream.
   */
  verifyWebhook() { return true; }

  /**
   * Parse a Grow "webhook" (= payment-pending request body).
   *
   * @param {{ body: { plan: string, userId: string } }} req
   * @returns {NormalizedEvent}
   */
  parseWebhookEvent({ body }) {
    const plan   = body?.plan   || 'unknown';
    const userId = body?.userId || null;

    return this._buildNormalizedEvent({
      eventType:      'payment.pending',
      externalEventId: `grow-pending-${userId}-${Date.now()}`,
      userId,
      internalStatus: SUBSCRIPTION_STATUS.PENDING,
      rawStatus:      'pending',
      planId:         plan,
      amountCents:    0,   // Grow amount not provided in callback
      currency:       'ils',
      rawPayload:     body,
    });
  }

  /**
   * Normalize after admin verification (activate-payment endpoint).
   *
   * @param {{ userId: string, plan: string, paymentStatus: string }} data
   * @returns {NormalizedEvent}
   */
  normalizePaymentResult(data) {
    const internal = this.mapExternalStatusToInternalStatus(data.paymentStatus || 'verified');
    return this._buildNormalizedEvent({
      eventType:      'subscription.activated',
      externalEventId: `grow-activation-${data.userId}-${Date.now()}`,
      userId:          data.userId,
      internalStatus:  internal,
      rawStatus:       data.paymentStatus || 'verified',
      planId:          data.plan,
      amountCents:     0,
      currency:        'ils',
      rawPayload:      data,
    });
  }

  mapExternalStatusToInternalStatus(externalStatus) {
    return STATUS_MAP[externalStatus] || SUBSCRIPTION_STATUS.INACTIVE;
  }

  // Grow has no portal — callers should check supportsPortal first
  async buildCustomerPortalLink() { this._notSupported('buildCustomerPortalLink'); }
  async cancelSubscription()      { this._notSupported('cancelSubscription'); }

  // ── Private ───────────────────────────────────────────────────────────────────

  _buildNormalizedEvent({ eventType, externalEventId, userId, customerId = null,
    subscriptionId = null, internalStatus, rawStatus, planId, amountCents, currency, rawPayload,
    periodStart = null, periodEnd = null }) {
    return {
      eventType,
      providerName:   this.getName(),
      externalEventId,
      userId,
      customerId,
      subscriptionId,
      internalStatus,
      rawStatus,
      planId,
      amountCents,
      currency,
      periodStart,
      periodEnd,
      rawPayload,
    };
  }
}

module.exports = { GrowProvider };
