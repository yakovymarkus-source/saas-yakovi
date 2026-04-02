/**
 * billing.js — Stripe subscription management and plan enforcement
 *
 * Plans: starter | pro | agency
 * Limits (campaigns per plan):  starter=3, pro=15, agency=unlimited
 */

const { AppError } = require('./errors');
const { getAdminClient } = require('./supabase');

// ─── Plan definitions ─────────────────────────────────────────────────────────
const PLANS = {
  free:    { campaignLimit: 1,        analysisPerDay: 5,   label: 'חינמי' },
  starter: { campaignLimit: 3,        analysisPerDay: 30,  label: 'Starter' },
  pro:     { campaignLimit: 15,       analysisPerDay: 200, label: 'Pro' },
  agency:  { campaignLimit: Infinity, analysisPerDay: Infinity, label: 'Agency' },
};

// ─── Stripe helpers ───────────────────────────────────────────────────────────
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  return require('stripe')(key);
}

// ─── Subscription record helpers ─────────────────────────────────────────────
async function getSubscription(userId) {
  const { data, error } = await getAdminClient()
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) console.warn('[billing] getSubscription error:', error.message);
  return data || null;
}

async function getPlan(userId) {
  const sub = await getSubscription(userId);
  if (!sub || sub.status !== 'active' && sub.status !== 'trialing') return 'free';
  return sub.plan || 'free';
}

// ─── Enforcement ─────────────────────────────────────────────────────────────
async function assertCampaignLimit(userId) {
  const plan  = await getPlan(userId);
  const limit = PLANS[plan]?.campaignLimit ?? 1;
  if (limit === Infinity) return;

  const { count, error } = await getAdminClient()
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('owner_user_id', userId);

  if (error) {
    console.warn('[billing] campaign count error:', error.message);
    return; // fail open — don't block on infra error
  }

  if ((count || 0) >= limit) {
    throw new AppError({
      code: 'PLAN_LIMIT_REACHED',
      userMessage: `תוכנית ה-${PLANS[plan].label} שלך מוגבלת ל-${limit} קמפיינים. שדרג כדי להוסיף עוד.`,
      devMessage:  `User ${userId} on plan '${plan}' reached campaign limit (${limit})`,
      status: 403,
      details: { plan, limit, current: count },
    });
  }
}

async function assertAnalysisQuota(userId) {
  const plan  = await getPlan(userId);
  const limit = PLANS[plan]?.analysisPerDay ?? 5;
  if (limit === Infinity) return;

  const since = new Date(Date.now() - 86400 * 1000).toISOString();
  const { count, error } = await getAdminClient()
    .from('analysis_results')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);

  if (error) {
    console.warn('[billing] analysis count error:', error.message);
    return;
  }

  if ((count || 0) >= limit) {
    throw new AppError({
      code: 'ANALYSIS_QUOTA_REACHED',
      userMessage: `הגעת למכסת הניתוחים היומית (${limit}) בתוכנית ה-${PLANS[plan].label}. שדרג לתוכנית גבוהה יותר.`,
      devMessage:  `User ${userId} on plan '${plan}' reached daily analysis quota (${limit})`,
      status: 403,
      details: { plan, limit, current: count },
    });
  }
}

// ─── Stripe Checkout ──────────────────────────────────────────────────────────
async function createCheckoutSession({ userId, email, priceId, successUrl, cancelUrl }) {
  const stripe = getStripe();

  // Get or create Stripe customer
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
    customer:            customerId,
    mode:                'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url:         successUrl,
    cancel_url:          cancelUrl,
    subscription_data: {
      trial_period_days: 14,
      metadata: { supabase_user_id: userId },
    },
    allow_promotion_codes: true,
  });

  return { sessionId: session.id, url: session.url };
}

// ─── Stripe Customer Portal ───────────────────────────────────────────────────
async function createPortalSession({ userId, returnUrl }) {
  const stripe = getStripe();
  const sub = await getSubscription(userId);
  if (!sub?.stripe_customer_id) {
    throw new AppError({
      code: 'NO_SUBSCRIPTION',
      userMessage: 'אין מנוי פעיל עבור החשבון הזה',
      devMessage:  `No stripe_customer_id for user ${userId}`,
      status: 400,
    });
  }
  const session = await stripe.billingPortal.sessions.create({
    customer:   sub.stripe_customer_id,
    return_url: returnUrl,
  });
  return { url: session.url };
}

// ─── Handle Stripe webhook events ────────────────────────────────────────────
async function handleWebhookEvent(event) {
  const sb = getAdminClient();

  const upsertSub = async (stripeObj, status) => {
    const userId = stripeObj.metadata?.supabase_user_id;
    if (!userId) return;

    // Map Stripe price → internal plan name
    const priceId = stripeObj.items?.data?.[0]?.price?.id || stripeObj.plan?.id || '';
    let plan = 'free';
    if (priceId === process.env.STRIPE_PRICE_STARTER) plan = 'starter';
    else if (priceId === process.env.STRIPE_PRICE_PRO) plan = 'pro';
    else if (priceId === process.env.STRIPE_PRICE_AGENCY) plan = 'agency';

    await sb.from('subscriptions').upsert({
      user_id:             userId,
      stripe_customer_id:  stripeObj.customer,
      stripe_sub_id:       stripeObj.id,
      plan,
      status,
      current_period_end:  stripeObj.current_period_end
        ? new Date(stripeObj.current_period_end * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  };

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await upsertSub(event.data.object, event.data.object.status);
      break;
    case 'customer.subscription.deleted':
      await upsertSub(event.data.object, 'canceled');
      break;
    case 'invoice.payment_succeeded': {
      // Optionally send billing confirmation email here (done in webhook function)
      break;
    }
    default:
      // Unknown event — ignore safely
      break;
  }
}

module.exports = {
  PLANS,
  getStripe,
  getSubscription,
  getPlan,
  assertCampaignLimit,
  assertAnalysisQuota,
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
};
