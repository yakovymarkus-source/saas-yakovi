'use strict';
/**
 * meta-setup.js
 * POST /.netlify/functions/meta-setup
 * Auth: Bearer <supabase-jwt>
 * Body: { accessToken, businessId, adAccountId, domain? }
 *
 * Runs the full Facebook infrastructure setup for a user:
 * 1. Create / fetch DataSet (Pixel)
 * 2. Store System User Token
 * 3. Register domain for CAPI trust
 * 4. Create Custom Conversions (scroll milestones + form events)
 * 5. Link DataSet to Ad Account
 * 6. Save everything to user_meta_config
 */

const { createClient } = require('@supabase/supabase-js');

const GRAPH = 'https://graph.facebook.com/v19.0';

// ── helpers ───────────────────────────────────────────────────────────────────
async function fbGet(path, token) {
  const res = await fetch(`${GRAPH}${path}&access_token=${token}`);
  const json = await res.json();
  if (json.error) throw new Error(`Meta API: ${json.error.message}`);
  return json;
}

async function fbPost(path, token, body) {
  const res = await fetch(`${GRAPH}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Meta API: ${json.error.message}`);
  return json;
}

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ── Step 1: Create or fetch existing DataSet (Pixel) ─────────────────────────
async function createOrFetchDataset(token, businessId, label) {
  // Try to list existing pixels for this business
  try {
    const existing = await fbGet(`/${businessId}/owned_pixels?fields=id,name&limit=10`, token);
    if (existing.data && existing.data.length > 0) {
      const pixel = existing.data[0];
      return { pixelId: pixel.id, created: false };
    }
  } catch (e) {
    console.warn('[meta-setup] Could not list pixels:', e.message);
  }

  // Create new DataSet
  const result = await fbPost(`/${businessId}/datasets`, token, {
    name: label || 'FullCycle Analytics',
  });
  return { pixelId: result.id, created: true };
}

// ── Step 2: Register domain ───────────────────────────────────────────────────
async function registerDomain(token, businessId, domain) {
  try {
    const result = await fbPost(`/${businessId}/owned_domains`, token, { domain });
    return {
      verificationCode: result.ownership_verification?.dns_code || result.verification_code || null,
      domainId: result.id || null,
    };
  } catch (e) {
    // Domain might already be registered
    console.warn('[meta-setup] Domain registration warning:', e.message);
    return { verificationCode: null, domainId: null };
  }
}

// ── Step 3: Create Custom Conversions ────────────────────────────────────────
const CUSTOM_CONVERSIONS = [
  { name: 'FullCycle — High Scroll (75%)',         event: 'scroll_75',    rule_type: 'URL_CONTAINS',  description: 'גולש הגיע ל-75% גלילה — כוונה גבוהה' },
  { name: 'FullCycle — Full Read (100%)',           event: 'scroll_100',   rule_type: 'URL_CONTAINS',  description: 'קרא את כל הדף' },
  { name: 'FullCycle — Video 90%',                  event: 'video_90',     rule_type: 'URL_CONTAINS',  description: 'צפה ב-90% מהוידאו' },
  { name: 'FullCycle — Form Started (High Intent)', event: 'form_start',   rule_type: 'URL_CONTAINS',  description: 'התחיל למלא טופס' },
  { name: 'FullCycle — Lead Submitted',             event: 'form_submit',  rule_type: 'URL_CONTAINS',  description: 'השאיר פרטים מוצלח' },
];

async function setupCustomConversions(token, adAccountId, pixelId) {
  const results = [];
  for (const cc of CUSTOM_CONVERSIONS) {
    try {
      const result = await fbPost(`/${adAccountId}/customconversions`, token, {
        name:              cc.name,
        event_source_id:   pixelId,
        custom_event_type: 'OTHER',
        custom_event_name: cc.event,
        rule:              JSON.stringify({ and: [{ event_sources: [{ id: pixelId, type: 'PIXEL' }] }] }),
        description:       cc.description,
      });
      results.push({ name: cc.name, id: result.id, event: cc.event });
    } catch (e) {
      console.warn(`[meta-setup] Custom conversion "${cc.name}" warning:`, e.message);
      results.push({ name: cc.name, error: e.message, event: cc.event });
    }
  }
  return results;
}

// ── Step 4: Link DataSet to Ad Account ───────────────────────────────────────
async function linkDatasetToAdAccount(token, adAccountId, pixelId) {
  try {
    await fbPost(`/${adAccountId}/ads_data_sets`, token, { dataset_id: pixelId });
    return true;
  } catch (e) {
    console.warn('[meta-setup] Link dataset warning:', e.message);
    return false;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // Auth
  const token = (event.headers['authorization'] || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { accessToken, businessId, adAccountId, domain } = body;
  if (!accessToken || !businessId || !adAccountId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'accessToken, businessId, adAccountId required' }) };
  }

  const supabase = db();
  const steps = [];

  // Mark setup as in-progress
  await supabase.from('user_meta_config').upsert({
    user_id: user.id,
    business_id: businessId,
    ad_account_id: adAccountId,
    domain: domain || null,
    setup_completed: false,
  }, { onConflict: 'user_id' });

  try {
    // ── Step 1: DataSet ───────────────────────────────────────────────────────
    steps.push({ step: 1, name: 'יצירת DataSet', status: 'running' });
    const { pixelId, created } = await createOrFetchDataset(accessToken, businessId, `FullCycle-${user.id.slice(0,8)}`);
    steps[0].status = 'done';
    steps[0].pixelId = pixelId;
    steps[0].created = created;

    // Save pixel immediately
    await supabase.from('user_meta_config').update({
      pixel_id:           pixelId,
      dataset_id:         pixelId,
      capi_access_token:  accessToken,
    }).eq('user_id', user.id);

    // ── Step 2: Domain ────────────────────────────────────────────────────────
    const activeDomain = domain || process.env.APP_URL || null;
    steps.push({ step: 2, name: 'רישום דומיין', status: 'running' });
    let domainResult = { verificationCode: null };
    if (activeDomain) {
      domainResult = await registerDomain(accessToken, businessId, activeDomain);
      await supabase.from('user_meta_config').update({
        domain:                   activeDomain,
        domain_verification_code: domainResult.verificationCode,
      }).eq('user_id', user.id);
    }
    steps[1].status = 'done';
    steps[1].verificationCode = domainResult.verificationCode;

    // ── Step 3: Custom Conversions ────────────────────────────────────────────
    steps.push({ step: 3, name: 'הגדרת Custom Conversions', status: 'running' });
    const conversions = await setupCustomConversions(accessToken, adAccountId, pixelId);
    await supabase.from('user_meta_config').update({
      custom_conversions: conversions,
    }).eq('user_id', user.id);
    steps[2].status = 'done';
    steps[2].conversions = conversions.length;

    // ── Step 4: Link DataSet to Ad Account ────────────────────────────────────
    steps.push({ step: 4, name: 'חיבור DataSet לחשבון מודעות', status: 'running' });
    const linked = await linkDatasetToAdAccount(accessToken, adAccountId, pixelId);
    steps[3].status = 'done';
    steps[3].linked = linked;

    // ── Mark setup complete ───────────────────────────────────────────────────
    await supabase.from('user_meta_config').update({
      setup_completed: true,
      setup_error:     null,
    }).eq('user_id', user.id);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        pixelId,
        verificationCode: domainResult.verificationCode,
        steps,
        message: `הפיקסל ${pixelId} הותקן. מעכשיו כל דף נחיתה שתפרסם יימדד אוטומטית בשרת.`,
      }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[meta-setup] Error:', msg);
    await supabase.from('user_meta_config').update({ setup_error: msg }).eq('user_id', user.id);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: msg, steps }),
    };
  }
};
