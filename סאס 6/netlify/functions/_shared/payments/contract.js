'use strict';

/**
 * contract.js — Base class every payment provider must implement.
 *
 * Providers that don't support a capability should:
 *   - Return null / throw a clear NOT_SUPPORTED error
 *   - Set the matching capability flag to false
 *
 * Never fake a capability that doesn't exist.
 */

const { AppError } = require('../errors');

class PaymentProvider {
  // ── Identity ────────────────────────────────────────────────────────────────

  /** @returns {string} e.g. 'grow' | 'stripe' */
  getName() { throw new Error(`${this.constructor.name}.getName() not implemented`); }

  /** @returns {boolean} true if all required env vars are present */
  isConfigured() { throw new Error(`${this.constructor.name}.isConfigured() not implemented`); }

  // ── Capability flags ─────────────────────────────────────────────────────────
  // Override in subclass; default = not supported

  get supportsSubscriptions()       { return false; }
  get supportsRefunds()             { return false; }
  get supportsPortal()              { return false; }
  get supportsWebhookSignature()    { return false; }
  get supportsTrials()              { return false; }
  get supportsCoupons()             { return false; }
  get requiresManualVerification()  { return false; }

  // ── Checkout ─────────────────────────────────────────────────────────────────

  /**
   * Create a checkout/payment session.
   * @param {{ userId, email, planId, priceId, successUrl, cancelUrl }} input
   * @returns {Promise<{ url: string, sessionId?: string }>}
   */
  // eslint-disable-next-line no-unused-vars
  async createCheckoutSession(input) {
    this._notSupported('createCheckoutSession');
  }

  // ── Webhook ───────────────────────────────────────────────────────────────────

  /**
   * Verify the incoming webhook request is authentic.
   * @param {{ rawBody: string|Buffer, headers: object, event: object }} req
   * @returns {boolean}
   */
  // eslint-disable-next-line no-unused-vars
  verifyWebhook(req) {
    if (!this.supportsWebhookSignature) return true; // manual flow — trust caller auth
    this._notSupported('verifyWebhook');
  }

  /**
   * Parse a verified webhook request into a normalized payment event.
   * @param {{ rawBody: string|Buffer, headers: object, body: object }} req
   * @returns {NormalizedEvent}
   */
  // eslint-disable-next-line no-unused-vars
  parseWebhookEvent(req) {
    this._notSupported('parseWebhookEvent');
  }

  // ── Status mapping ───────────────────────────────────────────────────────────

  /**
   * Map a provider-specific status string to an internal canonical status.
   * @param {string} externalStatus
   * @returns {string} SUBSCRIPTION_STATUS or PAYMENT_STATUS value
   */
  // eslint-disable-next-line no-unused-vars
  mapExternalStatusToInternalStatus(externalStatus) {
    this._notSupported('mapExternalStatusToInternalStatus');
  }

  // ── Portal / management ──────────────────────────────────────────────────────

  /**
   * Build a URL for the billing portal / subscription management page.
   * @param {{ userId, customerId, returnUrl }} input
   * @returns {Promise<{ url: string }>}
   */
  // eslint-disable-next-line no-unused-vars
  async buildCustomerPortalLink(input) {
    this._notSupported('buildCustomerPortalLink');
  }

  /**
   * Cancel a subscription.
   * @param {{ userId, subscriptionId, prorate }} input
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async cancelSubscription(input) {
    this._notSupported('cancelSubscription');
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  _notSupported(method) {
    throw new AppError({
      code:        'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      userMessage: 'פעולה זו אינה נתמכת על ידי ספק התשלומים הפעיל',
      devMessage:  `${this.getName()}.${method}() is not supported`,
      status:      501,
    });
  }
}

/**
 * @typedef {object} NormalizedEvent
 * @property {string}  eventType       — canonical event type (payment.succeeded | payment.failed | subscription.activated | subscription.canceled | subscription.updated | payment.pending)
 * @property {string}  providerName    — e.g. 'grow' | 'stripe'
 * @property {string}  externalEventId — provider's event/transaction ID
 * @property {string|null} userId      — supabase user_id if known
 * @property {string|null} customerId  — provider customer ID
 * @property {string|null} subscriptionId — provider subscription ID
 * @property {string}  internalStatus  — SUBSCRIPTION_STATUS or PAYMENT_STATUS value
 * @property {string}  rawStatus       — original provider status string
 * @property {string|null} planId      — internal plan name
 * @property {number}  amountCents     — amount in smallest currency unit
 * @property {string}  currency        — ISO 4217 e.g. 'ils' | 'usd'
 * @property {string|null} periodStart — ISO timestamp
 * @property {string|null} periodEnd   — ISO timestamp
 * @property {object}  rawPayload      — full provider payload for audit
 */

module.exports = { PaymentProvider };
