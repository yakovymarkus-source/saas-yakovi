'use strict';

/**
 * providers/stripe.js — Stripe payment provider
 *
 * Wraps the existing Stripe logic from _shared/billing.js.
 * Business code calls PaymentService — never this class directly.
 *
 * Capabilities:
 *   - supportsSubscriptions:    true
 *   - supportsRefunds:          true  (via Stripe dashboard / API)
 *   - supportsPortal:           true  (Stripe Billing Portal)
 *   - supportsWebhookSignature: true  (HMAC-SHA256)
 *   - supportsTrials:           true
 *   - supportsCoupons:          true
 *   - requiresManualVerification: false
 */

const { PaymentProvider } = require('../contract');
const { SUBSCRIPTION_STATUS, PAYMENT_STATUS } = require('../statuses');

// Stripe status → canonical internal status
const STRIPE_SUB_STATUS_MAP = {
  active:            SUBSCRIPTION_STATUS.ACTIVE,
  trialing:          SUBSCRIPTION_STATUS.TRIALING,
  past_due:          SUBSCRIPTION_STATUS.PAST_DUE,
  canceled:          SUBSCRIPTION_STATUS.CANCELED,
  unpaid:            SUBSCRIPTION_STATUS.INACTIVE,
  incomplete:        SUBSCRIPTION_STATUS.INACTIVE,
  incomplete_expired:SUBSCRIPTION_STATUS.EXPIRED,
  paused:            SUBSCRIPTION_STATUS.INACTIVE,
};

class StripeProvider extends PaymentProvider {
  getName() { return 'stripe'; }

  isConfigured() {
    return !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
  }

  // ── Capabilities ─────────────────────────────────────────────────────────────
  get supportsSubscriptions()      { return true;  }
  get supportsRefunds()            { return true;  }
  get supportsPortal()             { return true;  }
  get supportsWebhookSignature()   { return true;  }
  get supportsTrials()             { return true;  }
  get supportsCoupons()            { return true;  }
  get requiresManualVerification() { return false; }

  _sdk() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not set');
    return require('stripe')(key);
  }

  // ── Checkout ─────────────────────────────────────────────────────────────────

  async createCheckoutSession({ userId, email, priceId, successUrl, cancelUrl }) {
    const stripe     = this._sdk();
    const { getSubscription } = require('../../billing');

    let customerId;
    const sub = await getSubscription(userId);
    if (sub?.stripe_customer_id) {
      customerId = sub.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items:           [{ price: priceId, quantity: 1 }],
      success_url:          successUrl,
      cancel_url:           cancelUrl,
      subscription_data: {
        trial_period_days: 14,
        metadata: { supabase_user_id: userId },
      },
      allow_promotion_codes: true,
    });

    return { sessionId: session.id, url: session.url };
  }

  // ── Webhook ───────────────────────────────────────────────────────────────────

  verifyWebhook({ rawBody, headers }) {
    const stripe = this._sdk();
    const sig    = headers['stripe-signature'] || headers['Stripe-Signature'] || '';
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    // constructEvent throws if invalid — caller should catch
    stripe.webhooks.constructEvent(rawBody, sig, secret);
    return true;
  }

  parseWebhookEvent({ rawBody, headers }) {
    const stripe = this._sdk();
    const sig    = headers['stripe-signature'] || headers['Stripe-Signature'] || '';
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const event  = stripe.webhooks.constructEvent(rawBody, sig, secret);

    const obj = event.data.object;

    let eventType, userId, customerId, subscriptionId, internalStatus, rawStatus,
        planId, amountCents, currency, periodStart, periodEnd;

    customerId     = obj.customer || null;
    currency       = (obj.currency || 'usd').toLowerCase();

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        eventType      = 'subscription.updated';
        userId         = obj.metadata?.supabase_user_id || null;
        subscriptionId = obj.id;
        rawStatus      = obj.status;
        internalStatus = this.mapExternalStatusToInternalStatus(obj.status);
        planId         = this._priceToplan(obj.items?.data?.[0]?.price?.id || '');
        amountCents    = 0;
        periodStart    = obj.current_period_start ? new Date(obj.current_period_start * 1000).toISOString() : null;
        periodEnd      = obj.current_period_end   ? new Date(obj.current_period_end   * 1000).toISOString() : null;
        break;

      case 'customer.subscription.deleted':
        eventType      = 'subscription.canceled';
        userId         = obj.metadata?.supabase_user_id || null;
        subscriptionId = obj.id;
        rawStatus      = 'canceled';
        internalStatus = SUBSCRIPTION_STATUS.CANCELED;
        planId         = this._priceToplan(obj.items?.data?.[0]?.price?.id || '');
        amountCents    = 0;
        periodEnd      = obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null;
        break;

      case 'invoice.payment_succeeded':
        eventType      = obj.billing_reason === 'subscription_cycle' ? 'payment.renewed' : 'payment.succeeded';
        subscriptionId = obj.subscription;
        rawStatus      = 'paid';
        internalStatus = PAYMENT_STATUS.PAID;
        amountCents    = obj.amount_paid || 0;
        periodStart    = obj.period_start ? new Date(obj.period_start * 1000).toISOString() : null;
        periodEnd      = obj.period_end   ? new Date(obj.period_end   * 1000).toISOString() : null;
        break;

      case 'invoice.payment_failed':
        eventType      = 'payment.failed';
        subscriptionId = obj.subscription;
        rawStatus      = 'failed';
        internalStatus = PAYMENT_STATUS.FAILED;
        amountCents    = obj.amount_due || 0;
        break;

      default:
        eventType      = event.type;
        rawStatus      = 'unknown';
        internalStatus = 'unknown';
        amountCents    = 0;
    }

    return {
      eventType,
      providerName:    this.getName(),
      externalEventId: event.id,
      userId:          userId || null,
      customerId,
      subscriptionId:  subscriptionId || null,
      internalStatus,
      rawStatus,
      planId:          planId || null,
      amountCents:     amountCents || 0,
      currency,
      periodStart:     periodStart || null,
      periodEnd:       periodEnd   || null,
      rawPayload:      event,
    };
  }

  mapExternalStatusToInternalStatus(externalStatus) {
    return STRIPE_SUB_STATUS_MAP[externalStatus] || SUBSCRIPTION_STATUS.INACTIVE;
  }

  // ── Portal ────────────────────────────────────────────────────────────────────

  async buildCustomerPortalLink({ customerId, returnUrl }) {
    const stripe  = this._sdk();
    const session = await stripe.billingPortal.sessions.create({
      customer:   customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  // ── Cancel ────────────────────────────────────────────────────────────────────

  async cancelSubscription({ subscriptionId, prorate = true }) {
    const stripe = this._sdk();
    await stripe.subscriptions.cancel(subscriptionId, { prorate });
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  _priceToplan(priceId) {
    if (!priceId) return null;
    if (priceId === process.env.STRIPE_PRICE_STARTER) return 'starter';
    if (priceId === process.env.STRIPE_PRICE_PRO)     return 'pro';
    if (priceId === process.env.STRIPE_PRICE_AGENCY)  return 'agency';
    return null;
  }
}

module.exports = { StripeProvider };
