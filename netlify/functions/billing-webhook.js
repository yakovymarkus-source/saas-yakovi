/**
 * billing-webhook.js — Stripe webhook receiver
 *
 * Must be configured with raw body parsing in netlify.toml:
 *   isRawBody = true
 *
 * Stripe sends events here; we update subscriptions and trigger emails.
 */

const { ok, fail, respond }                     = require('./_shared/http');
const { createRequestContext, buildLogPayload }  = require('./_shared/observability');
const { writeRequestLog, getAdminClient }        = require('./_shared/supabase');
const { handleWebhookEvent, getStripe }          = require('./_shared/billing');
const { sendBillingConfirmation }                = require('./_shared/email');

exports.handler = async (event) => {
  const context = createRequestContext(event, 'billing-webhook');

  const sig     = event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'] || '';
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    const stripe = getStripe();
    // event.body is raw string when isRawBody = true in netlify.toml
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64')
      : event.body;

    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    await writeRequestLog(buildLogPayload(context, 'warn', 'billing_webhook_signature_failed', { error: err.message })).catch(() => {});
    return respond(400, { ok: false, message: 'Webhook signature invalid' }, context.requestId);
  }

  try {
    await handleWebhookEvent(stripeEvent);

    // Send billing confirmation email on successful payment
    if (stripeEvent.type === 'invoice.payment_succeeded') {
      const invoice = stripeEvent.data.object;
      const customerId = invoice.customer;
      try {
        const sb = getAdminClient();
        const { data: sub } = await sb.from('subscriptions').select('user_id, plan').eq('stripe_customer_id', customerId).maybeSingle();
        if (sub?.user_id) {
          const { data: profile } = await sb.from('profiles').select('email, name').eq('id', sub.user_id).maybeSingle();
          if (profile?.email) {
            await sendBillingConfirmation({
              to:       profile.email,
              name:     profile.name,
              planName: sub.plan,
              amount:   ((invoice.amount_paid || 0) / 100).toFixed(2),
              currency: (invoice.currency || 'usd').toUpperCase(),
            });
          }
        }
      } catch (emailErr) {
        console.warn('[billing-webhook] email send failed:', emailErr.message);
      }
    }

    // ── Write to payment_events for admin dashboard ──────────────────────────
    try {
      const sb = getAdminClient();
      const TRACKED = ['invoice.payment_succeeded', 'invoice.payment_failed', 'customer.subscription.deleted'];
      if (TRACKED.includes(stripeEvent.type)) {
        const obj = stripeEvent.data.object;
        const customerId = obj.customer;
        const { data: sub } = await sb.from('subscriptions')
          .select('user_id, plan').eq('stripe_customer_id', customerId).maybeSingle();

        let eventType, amountCents, periodStart, periodEnd, stripeSubId;
        if (stripeEvent.type === 'invoice.payment_succeeded') {
          eventType = 'payment_succeeded';
          amountCents = obj.amount_paid || 0;
          stripeSubId = obj.subscription;
          periodStart = obj.period_start ? new Date(obj.period_start * 1000).toISOString() : null;
          periodEnd   = obj.period_end   ? new Date(obj.period_end   * 1000).toISOString() : null;
        } else if (stripeEvent.type === 'invoice.payment_failed') {
          eventType = 'payment_failed';
          amountCents = obj.amount_due || 0;
          stripeSubId = obj.subscription;
        } else {
          eventType = 'subscription_canceled';
          amountCents = 0;
          stripeSubId = obj.id;
        }

        await sb.from('payment_events').insert({
          user_id:            sub?.user_id   || null,
          stripe_event_id:    stripeEvent.id,
          stripe_customer_id: customerId,
          stripe_sub_id:      stripeSubId    || null,
          event_type:         eventType,
          plan:               sub?.plan      || null,
          amount_cents:       amountCents,
          currency:           obj.currency   || 'usd',
          period_start:       periodStart    || null,
          period_end:         periodEnd      || null,
        });
      }
    } catch (peErr) {
      // Idempotency: ignore duplicate key (Stripe webhook retry)
      if (!peErr?.message?.includes('duplicate key')) {
        console.warn('[billing-webhook] payment_events write failed:', peErr.message);
      }
    }

    await writeRequestLog(buildLogPayload(context, 'info', 'billing_webhook_processed', { event_type: stripeEvent.type }));
    return ok({ received: true }, context.requestId);
  } catch (error) {
    await writeRequestLog(buildLogPayload(context, 'error', 'billing_webhook_processing_failed', { event_type: stripeEvent.type, code: error.code || 'INTERNAL_ERROR' })).catch(() => {});
    return fail(error, context.requestId);
  }
};
