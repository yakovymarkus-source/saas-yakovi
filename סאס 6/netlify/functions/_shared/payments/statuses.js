'use strict';

/**
 * statuses.js — Canonical internal payment/subscription statuses.
 *
 * Every payment provider maps its own statuses to these values.
 * Business logic only reads these — never raw provider statuses.
 */

const PAYMENT_STATUS = Object.freeze({
  PENDING:   'pending',    // payment initiated, not yet confirmed
  PAID:      'paid',       // payment confirmed
  FAILED:    'failed',     // payment attempt failed
  REFUNDED:  'refunded',   // payment was refunded
  CANCELED:  'canceled',   // payment or subscription canceled
});

const SUBSCRIPTION_STATUS = Object.freeze({
  ACTIVE:    'active',     // subscription is live and paid
  TRIALING:  'trialing',   // in trial period
  PAST_DUE:  'past_due',   // payment failed, grace period
  CANCELED:  'canceled',   // subscription ended
  INACTIVE:  'inactive',   // access should be blocked
  EXPIRED:   'expired',    // trial ended without conversion
  PENDING:   'pending',    // awaiting manual verification (Grow flow)
});

/** Plans that grant full access */
const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.TRIALING,
]);

module.exports = { PAYMENT_STATUS, SUBSCRIPTION_STATUS, ACTIVE_SUBSCRIPTION_STATUSES };
