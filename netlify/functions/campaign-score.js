'use strict';
/**
 * campaign-score.js
 * GET  /.netlify/functions/campaign-score?campaignId=xxx  → returns score
 * POST /.netlify/functions/campaign-score                 → recalculate + save
 * Auth: Bearer <supabase-jwt>
 *
 * Barrel Effect logic:
 *   score = avg(ctr_score, scroll_score, form_score, conversion_score)
 *   barrel_weak_link = the lowest scoring component
 */

const { createClient } = require('@supabase/supabase-js');

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// AI fix suggestions per weak link
const BARREL_FIXES = {
  ctr: {
    label: 'CTR נמוך — המודעה לא מושכת קליקים',
    action: 'rewrite_ad',
    cta: 'תן ל-AI לשכתב את המודעה',
    agent: 'execution',
  },
  scroll: {
    label: 'גולשים נוטשים מוקדם — הדף לא מעניין מספיק',
    action: 'rewrite_landing',
    cta: 'תן ל-AI לשפר את הדף',
    agent: 'execution',
  },
  form: {
    label: 'הטופס מרתיע — אנשים מתחילים ולא מסיימים',
    action: 'optimize_form',
    cta: 'תן ל-AI לפשט את הטופס',
    agent: 'qa',
  },
  conversion: {
    label: 'המרה נמוכה — גולשים רואים הכל אבל לא ממירים',
    action: 'optimize_cta',
    cta: 'תן ל-AI לחזק את ה-CTA',
    agent: 'execution',
  },
};

async function calculateScore(campaignId, userId) {
  const supabase = db();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Pull raw_events for this campaign
  const { data: events } = await supabase
    .from('raw_events')
    .select('event_type, session_id')
    .eq('campaign_id', campaignId)
    .gte('created_at', since);

  if (!events || events.length === 0) {
    return { score: 0, empty: true };
  }

  const sessions = new Set(events.map(e => e.session_id)).size || 1;
  const byType = {};
  events.forEach(e => {
    byType[e.event_type] = (byType[e.event_type] || new Set());
    byType[e.event_type].add(e.session_id);
  });

  const ratio = (type) => (byType[type]?.size || 0) / sessions;

  // Pull Meta ads data for CTR
  const { data: cache } = await supabase
    .from('api_cache')
    .select('payload')
    .eq('user_id', userId)
    .eq('source', 'meta')
    .maybeSingle();

  const metaCTR = cache?.payload?.ctr || null;

  // Score each component 0–100
  const ctr_score       = metaCTR ? Math.min(100, Math.round(metaCTR / 0.03 * 100)) : (ratio('cta_click') > 0.05 ? 70 : 30);
  const scroll_score    = Math.min(100, Math.round(ratio('scroll_50') * 200));
  const form_score      = ratio('form_start') > 0
    ? Math.min(100, Math.round((ratio('form_submit') / ratio('form_start')) * 100))
    : (ratio('form_submit') > 0 ? 80 : 20);
  const conversion_score = Math.min(100, Math.round(ratio('form_submit') * 500));

  const score = Math.round((ctr_score + scroll_score + form_score + conversion_score) / 4);

  // Barrel: weakest link
  const components = { ctr: ctr_score, scroll: scroll_score, form: form_score, conversion: conversion_score };
  const weakKey = Object.entries(components).sort((a, b) => a[1] - b[1])[0][0];
  const barrel = { ...BARREL_FIXES[weakKey], score: components[weakKey], key: weakKey };

  return { score, ctr_score, scroll_score, form_score, conversion_score, barrel, sessions };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };

  const token = (event.headers['authorization'] || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await anon.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const campaignId = event.queryStringParameters?.campaignId
    || JSON.parse(event.body || '{}').campaignId;
  if (!campaignId) return { statusCode: 400, body: JSON.stringify({ error: 'campaignId required' }) };

  try {
    const result = await calculateScore(campaignId, user.id);

    if (!result.empty) {
      await db().from('campaign_scores').upsert({
        user_id:          user.id,
        campaign_id:      campaignId,
        score:            result.score,
        ctr_score:        result.ctr_score,
        scroll_score:     result.scroll_score,
        form_score:       result.form_score,
        conversion_score: result.conversion_score,
        barrel_weak_link: result.barrel?.key,
        barrel_details:   result.barrel,
        calculated_at:    new Date().toISOString(),
      }, { onConflict: 'user_id,campaign_id' });

      // Check achievements after score update
      await checkAchievements(user.id, campaignId, result);
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, campaignId, ...result }),
    };
  } catch (err) {
    console.error('[campaign-score]', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

async function checkAchievements(userId, campaignId, result) {
  const supabase = db();
  const toAward = [];

  if (result.score >= 80) toAward.push({ id: 'campaign_pro', meta: { score: result.score, campaignId } });
  if (result.conversion_score >= 60) toAward.push({ id: 'first_lead', meta: { campaignId } });
  if (result.scroll_score >= 70) toAward.push({ id: 'scroll_master', meta: { campaignId } });

  for (const ach of toAward) {
    await supabase.from('user_achievements').upsert(
      { user_id: userId, achievement_id: ach.id, metadata: ach.meta },
      { onConflict: 'user_id,achievement_id', ignoreDuplicates: true }
    );
  }
}
