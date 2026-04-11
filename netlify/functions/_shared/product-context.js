'use strict';

/**
 * product-context.js
 *
 * Loads the full state of a user's account in a single parallel fetch.
 * Replaces all localStorage-based business data access.
 *
 * Usage:
 *   const ctx = await loadProductContext(userId, sb);
 *   ctx.profile        // business_profiles row or null
 *   ctx.assets         // recent generated_assets[]
 *   ctx.onboarding     // onboarding_progress row
 *   ctx.stage          // 'new' | 'has_profile' | 'has_asset' | 'growing' | 'active' | 'power'
 *   ctx.unlockedScreens // Set of screen IDs visible to this user
 */

/** Maps onboarding steps → which screens are unlocked */
const UNLOCK_RULES = [
  // [condition fn,  screen IDs to unlock]
  [s => s.profile_started,  ['landing-pages']],
  [s => s.first_asset,      ['recommendations']],
  [s => s.multiple_assets,  ['copy']],
  [s => s.has_metrics,      ['performance']],
  [s => s.has_ab_data,      ['ab-tests', 'economics']],
];

/** Always-visible screens regardless of progress */
const BASE_SCREENS = new Set(['dashboard', 'business-profile']);

/**
 * Derive the current onboarding stage label from step flags.
 * Used by Recommendations to decide which action cards to show.
 */
function deriveStage(steps) {
  if (!steps) return 'new';
  if (steps.has_ab_data)      return 'power';
  if (steps.has_metrics)      return 'active';
  if (steps.multiple_assets)  return 'growing';
  if (steps.first_asset)      return 'has_asset';
  if (steps.profile_started)  return 'has_profile';
  return 'new';
}

/**
 * Build the set of screen IDs the user can currently see in the sidebar.
 */
function buildUnlockedScreens(steps) {
  const screens = new Set(BASE_SCREENS);
  if (!steps) return screens;
  for (const [condition, ids] of UNLOCK_RULES) {
    if (condition(steps)) ids.forEach(id => screens.add(id));
  }
  return screens;
}

/**
 * loadProductContext(userId, supabaseAdminClient)
 * Returns a rich context object — never throws (returns safe defaults on error).
 */
async function loadProductContext(userId, sb) {
  const [profileRes, assetsRes, onboardingRes] = await Promise.all([
    sb.from('business_profiles')
      .select('id,user_id,business_name,category,offer,target_audience,problem_solved,primary_goal,completed,profile_score,updated_at')
      .eq('user_id', userId)
      .maybeSingle(),

    sb.from('generated_assets')
      .select('id, asset_type, status, title, preview_url, created_at, parent_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),

    sb.from('onboarding_progress')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const profile   = profileRes.data   || null;
  const assets    = assetsRes.data    || [];
  const onboarding = onboardingRes.data || null;

  const steps = onboarding?.steps || {
    profile_started:  !!(profile?.offer || profile?.business_name),
    profile_complete: !!profile?.completed,
    first_asset:      assets.length >= 1,
    multiple_assets:  assets.length >= 3,
    has_metrics:      false,
    has_ab_data:      false,
  };

  return {
    profile,
    assets,
    onboarding,
    steps,
    stage:           deriveStage(steps),
    unlockedScreens: buildUnlockedScreens(steps),
    hasProfile:      !!(profile?.offer || profile?.business_name),
    assetCount:      assets.length,
  };
}

/**
 * advanceOnboarding(userId, sb, flag)
 * Call this after key user actions to unlock next features.
 * flag: 'profile_started' | 'profile_complete' | 'first_asset' |
 *        'multiple_assets' | 'has_metrics' | 'has_ab_data'
 */
async function advanceOnboarding(userId, sb, flag) {
  const { data: existing } = await sb
    .from('onboarding_progress')
    .select('steps')
    .eq('user_id', userId)
    .maybeSingle();

  const steps = existing?.steps || {};
  if (steps[flag]) return; // already set — no-op

  steps[flag] = true;
  const stage = deriveStage(steps);

  await sb.from('onboarding_progress').upsert({
    user_id:      userId,
    steps,
    current_step: stage,
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

module.exports = { loadProductContext, advanceOnboarding, deriveStage, buildUnlockedScreens };
