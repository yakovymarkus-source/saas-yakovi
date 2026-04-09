'use strict';

/**
 * admin-metrics.js — All KPI calculations for the admin dashboard.
 *
 * Every function accepts an (optional) Supabase admin client so tests
 * can inject a mock without touching global state.
 */

const { getAdminClient } = require('./supabase');
const { PLAN_PRICES }    = require('./billing');

function sb(client) { return client || getAdminClient(); }

// ─── MRR (point-in-time from subscriptions table) ────────────────────────────
async function getMrrSnapshot(client) {
  const { data, error } = await sb(client)
    .from('subscriptions')
    .select('plan, status');

  if (error || !data) return { mrr: 0, breakdown: {}, activeCount: 0, trialingCount: 0 };

  let mrr = 0;
  const breakdown = { free: 0, early_bird: 0, starter: 0, pro: 0, agency: 0 };
  let activeCount = 0;
  let trialingCount = 0;

  for (const row of data) {
    if (row.status !== 'active' && row.status !== 'trialing') continue;
    const price = PLAN_PRICES[row.plan] ?? 0;
    mrr += price;
    if (row.plan in breakdown) breakdown[row.plan] += price;
    if (row.status === 'active')   activeCount++;
    if (row.status === 'trialing') trialingCount++;
  }

  return { mrr, breakdown, activeCount, trialingCount };
}

// ─── MRR trend (via SQL RPC) ──────────────────────────────────────────────────
async function getMrrTrend(client, days = 30) {
  const { data, error } = await sb(client).rpc('admin_mrr_trend', { p_days: days });
  if (error) { console.warn('[admin-metrics] getMrrTrend:', error.message); return []; }
  return (data || []).map(r => ({ date: r.day, revenueCents: Number(r.revenue_cents) }));
}

// ─── Signup trend (via SQL RPC) ───────────────────────────────────────────────
async function getSignupTrend(client, days = 30) {
  const { data, error } = await sb(client).rpc('admin_signup_trend', { p_days: days });
  if (error) { console.warn('[admin-metrics] getSignupTrend:', error.message); return []; }
  return (data || []).map(r => ({ date: r.day, count: Number(r.signups) }));
}

// ─── Churn rate (30-day rolling) ──────────────────────────────────────────────
async function getChurnRate(client) {
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const [activeRes, canceledRes] = await Promise.all([
    sb(client).from('subscriptions').select('id', { count: 'exact', head: true })
      .in('status', ['active', 'trialing']),
    sb(client).from('subscriptions').select('id', { count: 'exact', head: true })
      .eq('status', 'canceled').gte('updated_at', since),
  ]);
  const activeCount   = activeRes.count   || 0;
  const canceledCount = canceledRes.count || 0;
  const baseCount     = activeCount + canceledCount;
  const rate          = baseCount > 0 ? canceledCount / baseCount : 0;
  return { churnedCount: canceledCount, baseCount, rate: Math.round(rate * 1000) / 1000 };
}

// ─── Trial → paid conversion rate ────────────────────────────────────────────
async function getConversionRate(client) {
  const [totalRes, paidRes] = await Promise.all([
    sb(client).from('profiles').select('id', { count: 'exact', head: true })
      .is('deleted_at', null),
    sb(client).from('subscriptions').select('id', { count: 'exact', head: true })
      .in('status', ['active', 'trialing']).neq('plan', 'free'),
  ]);
  const total     = totalRes.count || 0;
  const converted = paidRes.count  || 0;
  const rate      = total > 0 ? converted / total : 0;
  return { converted, total, rate: Math.round(rate * 1000) / 1000 };
}

// ─── New signups in last N hours ──────────────────────────────────────────────
async function getNewSignups(client, hours = 24) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { count } = await sb(client).from('profiles')
    .select('id', { count: 'exact', head: true }).gte('created_at', since);
  return count || 0;
}

// ─── Failed payments in last N hours ─────────────────────────────────────────
async function getFailedPayments(client, hours = 24) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { count } = await sb(client).from('payment_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'payment_failed').gte('created_at', since);
  return count || 0;
}

// ─── Total user count ─────────────────────────────────────────────────────────
async function getTotalUsers(client) {
  const { count } = await sb(client).from('profiles')
    .select('id', { count: 'exact', head: true }).is('deleted_at', null);
  return count || 0;
}

module.exports = {
  getMrrSnapshot, getMrrTrend, getSignupTrend,
  getChurnRate, getConversionRate,
  getNewSignups, getFailedPayments, getTotalUsers,
  PLAN_PRICES,
};
