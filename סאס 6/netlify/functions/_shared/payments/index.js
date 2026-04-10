'use strict';

/**
 * payments/index.js — Clean public API for the payments abstraction layer.
 *
 * All payment-related code should import from here, not from sub-modules.
 */

const service      = require('./payment-service');
const { getActiveProvider }   = require('./factory');
const { listProviders }       = require('./registry');
const { PAYMENT_STATUS, SUBSCRIPTION_STATUS, ACTIVE_SUBSCRIPTION_STATUSES } = require('./statuses');

module.exports = {
  // Business operations
  createCheckoutSession:   service.createCheckoutSession,
  processWebhook:          service.processWebhook,
  getBillingPortalUrl:     service.getBillingPortalUrl,
  cancelSubscription:      service.cancelSubscription,
  grantAccess:             service.grantAccess,
  revokeAccess:            service.revokeAccess,
  getProviderCapabilities: service.getProviderCapabilities,

  // Provider access (rarely needed outside payment-service)
  getActiveProvider,
  listProviders,

  // Canonical status constants
  PAYMENT_STATUS,
  SUBSCRIPTION_STATUS,
  ACTIVE_SUBSCRIPTION_STATUSES,
};
