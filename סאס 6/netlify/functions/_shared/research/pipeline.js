'use strict';

/**
 * research/pipeline.js
 * Main research pipeline orchestrator — 15 steps.
 *
 * Features:
 *  - System State Awareness object tracked across all steps
 *  - Early Stop when enough high-confidence data is collected
 *  - Red Flags detection on avatar data
 *  - Usage logs written to research_usage_logs after every AI call
 *  - withRetry() wrapper applied to every AI-dependent step
 *  - Validation fallback when <3 competitors found
 *  - Budget enforcement (BudgetController) across all AI calls
 */

require('../env');
const { createPlan }      = require('./planner');
const { BudgetController }= require('./budget-controller');
const { withRetry }       = require('./shared/utils');
const {
  discoverCompetitors, expandCompetitors,
  collectAvatarSignals, collectAdsIntelligence,
} = require('./collectors/claude-collector');
const { analyzeCompetitors }  = require('./analysis/competitor-analyzer');
const { analyzeAvatar }        = require('./analysis/avatar-analyzer');
const {
  detectPatterns, detectGaps,
  buildOpportunities, buildRecommendations, computeDataQuality,
} = require('./analysis/synthesizer');
const { buildReport } = require('./output/report-builder');

// ── API key helper ────────────────────────────────────────────────────
function getAnthropicKey() {
  let key = process.env.ANTHROPIC_API_KEY || '';
  try {
    const fs = require('node:fs'), path = require('node:path');
    const f  = path.resolve(__dirname, '../../../..', '.env');
    if (fs.existsSync(f)) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const m = line.match(/^ANTHROPIC_API_KEY=(.+)/);
        if (m) { key = m[1].trim(); break; }
      }
    }
  } catch {}
  return key;
}

// ── Main pipeline ─────────────────────────────────────────────────────
async function runResearchPipeline({ job, supabase, onStep }) {
  const startTime = Date.now();
  const plan      = createPlan(job.depth_level);
  const budget    = new BudgetController(plan);
  const apiKey    = getAnthropicKey();
  const model     = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  // ── System State Awareness ──────────────────────────────────────────
  const systemState = {
    phase:              'init',      // init → discovery → analysis → synthesis → report
    competitorQuality:  0,           // 0–100 confidence score of competitor data
    avatarQuality:      0,           // 0–100 quality score of avatar signals
    canEarlyStop:       false,       // flag: enough data collected
    earlyStopReason:    null,
    redFlags:           [],          // contradictions / thin data detected
    signalSaturation:   0,           // % saturation
    totalAiCalls:       0,
  };

  // ── Step emitter ───────────────────────────────────────────────────
  let stepIndex = 0;
  async function emit(key, message, status = 'running', data = null) {
    stepIndex++;
    const idx = stepIndex;
    try {
      await supabase.from('research_steps').insert({
        job_id:     job.id,
        step_index: idx,
        step_key:   key,
        message,
        status,
        data: data ?? undefined,
      });
    } catch (e) { console.warn('[pipeline] emit failed:', e.message); }
    if (onStep) onStep({ step_index: idx, step_key: key, message, status });
  }

  // ── Job status updater ─────────────────────────────────────────────
  async function updateJob(patch) {
    await supabase.from('research_jobs')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', job.id);
  }

  // ── Usage logger (writes to research_usage_logs) ───────────────────
  async function logUsage({ provider = 'claude_researcher', operation, tokensUsed = 0, success = true }) {
    systemState.totalAiCalls++;
    try {
      await supabase.from('research_usage_logs').insert({
        job_id:      job.id,
        user_id:     job.user_id,
        provider,
        action:      operation,
        tokens_used: tokensUsed,
        success,
      });
    } catch (e) { console.warn('[pipeline] logUsage failed:', e.message); }
  }

  // ── Early stop check ───────────────────────────────────────────────
  function checkEarlyStop(entities, signals) {
    // High-depth: if we have top-tier competitors + saturated signals
    if (job.depth_level === 'high' && entities.length >= 15 && signals.length >= 200 && systemState.signalSaturation >= 65) {
      systemState.canEarlyStop = true;
      systemState.earlyStopReason = `${entities.length} מתחרים ו-${signals.length} אותות — מספיק נתונים`;
    }
    // Medium: enough quality data collected
    if (job.depth_level === 'medium' && entities.length >= 8 && signals.length >= 70 && systemState.signalSaturation >= 60) {
      systemState.canEarlyStop = true;
      systemState.earlyStopReason = `כיסוי שוק מספק הושג`;
    }
    // Low: any 3+ competitors + 20+ signals → done
    if (job.depth_level === 'low' && entities.length >= 3 && signals.length >= plan.minSignalsRequired) {
      systemState.canEarlyStop = true;
      systemState.earlyStopReason = `כמות נתונים מינימלית הושגה`;
    }
  }

  // ── Pipeline state ─────────────────────────────────────────────────
  let rawEntities     = [];
  let entities        = [];
  let avatarResult    = { signals: [], segments: [] };
  let avatarAnalysis  = {};
  let adsIntelligence = {};
  let patterns        = [];
  let gaps            = [];
  let opportunities   = [];
  let recommendations = [];
  let cacheKey        = `${job.niche.toLowerCase().trim()}::${job.depth_level}`;

  try {
    await updateJob({ status: 'running', started_at: new Date().toISOString() });
    systemState.phase = 'init';
    await emit('start', `מתחיל מחקר שוק ברמת "${plan.label}" לנישה: ${job.niche}`);

    // ── STEP 1: Cache Check ───────────────────────────────────────────
    await emit('cache_check', 'בודק אם יש נתונים שמורים לנישה זו...');
    const { data: cached } = await supabase
      .from('research_cache')
      .select('*')
      .eq('cache_key', cacheKey)
      .eq('is_stale', false)
      .single();

    if (cached) {
      await emit('cache_hit', `נמצא מידע שמור מ-${new Date(cached.updated_at).toLocaleDateString('he-IL')} — משתמש בנתונים קיימים`, 'done');
      rawEntities          = cached.entities_data || [];
      avatarResult.signals = cached.signals_data  || [];
    } else {
      await emit('cache_miss', 'לא נמצא מידע שמור — מתחיל מחקר חדש', 'done');
    }

    // ── STEP 2: Discovery ─────────────────────────────────────────────
    systemState.phase = 'discovery';
    if (rawEntities.length === 0) {
      await emit('discovery', `מחפש מתחרים בשוק "${job.niche}"...`);
      try {
        if (!budget.canSpend(1500)) {
          await emit('discovery', 'תקציב AI מוגבל — דילוג על גילוי', 'skipped');
        } else {
          rawEntities = await withRetry(async () => {
            const result = await discoverCompetitors({
              apiKey, model, plan,
              niche:          job.niche,
              businessName:   job.business_name,
              targetAudience: job.target_audience,
            });
            return result;
          }, 2, 1500);
          budget.spend(1500);
          await logUsage({ operation: 'discover_competitors', tokensUsed: 1500, success: true });
        }
      } catch (e) {
        await logUsage({ operation: 'discover_competitors', tokensUsed: 0, success: false });
        await emit('discovery', `⚠️ שגיאה בחיפוש מתחרים: ${e.message}`, 'error');
      }

      if (rawEntities.length > 0) {
        await emit('discovery_done', `נמצאו ${rawEntities.length} מתחרים פוטנציאליים`, 'done', { count: rawEntities.length });
      }
    }

    // ── STEP 3: Deduplication ─────────────────────────────────────────
    await emit('dedup', 'מסיר כפילויות ומאחד ישויות דומות...');
    const competitorResult = analyzeCompetitors(rawEntities, plan);
    entities = competitorResult.entities;
    systemState.competitorQuality = entities.length > 0
      ? Math.round(entities.reduce((s, e) => s + (e.confidence || 50), 0) / entities.length)
      : 0;
    await emit('dedup_done', `נשארו ${entities.length} מתחרים ייחודיים אחרי סינון (ביטחון ממוצע: ${systemState.competitorQuality}%)`, 'done');

    // ── STEP 4: Validation Fallback ───────────────────────────────────
    if (entities.length < 3) {
      await emit('validation_fallback', `נמצאו פחות מ-3 מתחרים — מבצע חיפוש מורחב...`);
      try {
        if (budget.canSpend(1000)) {
          const broader = await withRetry(async () => discoverCompetitors({
            apiKey, model,
            plan:    { ...plan, maxCompetitors: plan.maxCompetitors + 5 },
            niche:   job.niche,
            broader: true,
          }), 2, 1000);
          budget.spend(1000);
          await logUsage({ operation: 'discover_competitors_fallback', tokensUsed: 1000, success: true });
          const merged = analyzeCompetitors([...rawEntities, ...broader], plan);
          if (merged.entities.length > entities.length) {
            entities = merged.entities;
            await emit('validation_fallback_done', `חיפוש מורחב מצא ${entities.length} מתחרים`, 'done');
          } else {
            await emit('validation_fallback', `גם חיפוש מורחב לא מצא מתחרים נוספים — ממשיך עם ${entities.length}`, 'done');
          }
        }
      } catch (e) {
        await logUsage({ operation: 'discover_competitors_fallback', tokensUsed: 0, success: false });
        await emit('validation_fallback', `שגיאה בחיפוש מורחב: ${e.message}`, 'error');
      }
    }

    // Log top competitors
    for (const e of entities.slice(0, 5)) {
      await emit('competitor_found',
        `🏢 ${e.name}${e.primary_domain ? ' (' + e.primary_domain + ')' : ''} — עוצמה: ${e.priority === 'high' ? 'גבוהה' : e.priority === 'medium' ? 'בינונית' : 'נמוכה'}`,
        'done');
    }

    // ── STEP 5: Competitor Expansion ──────────────────────────────────
    if (budget.canSpend(1500) && entities.length > 0 && job.depth_level !== 'low') {
      await emit('expansion', 'מרחיב מידע על מתחרים מובילים...');
      try {
        entities = await withRetry(async () =>
          expandCompetitors({ apiKey, model, competitors: entities, niche: job.niche, plan }),
        2, 1500);
        budget.spend(1500);
        await logUsage({ operation: 'expand_competitors', tokensUsed: 1500, success: true });
        await emit('expansion_done', 'הורחב מידע על מודעות ומסרים של מתחרים', 'done');
      } catch (e) {
        await logUsage({ operation: 'expand_competitors', tokensUsed: 0, success: false });
        await emit('expansion', 'דילוג על הרחבה (שגיאה)', 'skipped');
      }
    }

    // Save competitors to DB
    if (entities.length > 0) {
      await supabase.from('research_entities').insert(
        entities.map(e => ({ ...e, job_id: job.id, raw_data: e.raw_data || {} }))
      );
    }

    // ── STEP 6: Avatar Collection ──────────────────────────────────────
    systemState.phase = 'analysis';
    if (avatarResult.signals.length === 0) {
      await emit('avatar', `חוקר את קהל היעד של "${job.niche}"...`);
      try {
        if (!budget.canSpend(2000)) {
          await emit('avatar', 'תקציב AI מוגבל — דילוג על איסוף אווטר', 'skipped');
        } else {
          avatarResult = await withRetry(async () =>
            collectAvatarSignals({
              apiKey, model, plan,
              niche:          job.niche,
              targetAudience: job.target_audience,
            }),
          2, 1500);
          budget.spend(2000);
          await logUsage({ operation: 'collect_avatar_signals', tokensUsed: 2000, success: true });
        }
      } catch (e) {
        await logUsage({ operation: 'collect_avatar_signals', tokensUsed: 0, success: false });
        await emit('avatar', `⚠️ שגיאת איסוף אווטר: ${e.message}`, 'error');
      }
    }

    if (avatarResult.signals.length > 0) {
      await emit('avatar_done', `נאספו ${avatarResult.signals.length} אותות מקהל היעד`, 'done', { count: avatarResult.signals.length });
      const types = [...new Set(avatarResult.signals.map(s => s.type))];
      const labels = { pain: 'כאבים', fear: 'פחדים', desire: 'רצונות', frustration: 'תסכולים', trigger: 'טריגרים', language: 'שפה' };
      await emit('avatar_types', `סוגי אותות: ${types.map(t => labels[t] || t).join(', ')}`, 'done');

      await supabase.from('research_signals').insert(
        avatarResult.signals.map(s => ({ ...s, job_id: job.id }))
      );
    }

    // ── STEP 7: Avatar Analysis (+ Red Flags) ─────────────────────────
    await emit('avatar_analysis', 'מנתח דפוסים פסיכולוגיים בקהל היעד...');
    avatarAnalysis = analyzeAvatar(avatarResult.signals, plan, entities);
    systemState.avatarQuality   = avatarAnalysis.qualityScore || 0;
    systemState.signalSaturation= avatarAnalysis.saturation?.saturationPct || 0;
    systemState.redFlags        = avatarAnalysis.redFlags || [];

    if (avatarAnalysis.corePains.length > 0) {
      await emit('avatar_pains', `כאבים מרכזיים: ${avatarAnalysis.corePains.slice(0, 3).join(' | ')}`, 'done');
    }
    if (avatarAnalysis.isLowConfidence) {
      await emit('avatar_warning', '⚠️ כמות האותות נמוכה — תוצאות האווטר בביטחון חלקי', 'done');
    }
    if (systemState.redFlags.length > 0) {
      const highFlags = systemState.redFlags.filter(f => f.severity === 'high');
      if (highFlags.length > 0) {
        await emit('red_flags', `🚩 ${highFlags.length} דגלים אדומים: ${highFlags.map(f => f.description).join(' | ')}`, 'done');
      }
    }

    // Early stop evaluation after core data collection
    checkEarlyStop(entities, avatarResult.signals);
    if (systemState.canEarlyStop && job.depth_level === 'low') {
      await emit('early_stop', `✅ נאסף מספיק נתונים: ${systemState.earlyStopReason}`, 'done');
    }

    // ── STEP 8: Ads Intelligence ───────────────────────────────────────
    if (budget.canSpend(1000) && entities.length > 0) {
      await emit('ads_intel', 'מנתח מודעות ופרסומות בנישה...');
      try {
        adsIntelligence = await withRetry(async () =>
          collectAdsIntelligence({ apiKey, model, niche: job.niche, competitors: entities, plan }),
        2, 1500);
        budget.spend(1000);
        await logUsage({ operation: 'collect_ads_intelligence', tokensUsed: 1000, success: true });
        if (adsIntelligence.winning_angles?.length > 0) {
          await emit('ads_intel_done', `זוויות מנצחות: ${adsIntelligence.winning_angles.slice(0, 2).join(', ')}`, 'done');
        }
      } catch (e) {
        await logUsage({ operation: 'collect_ads_intelligence', tokensUsed: 0, success: false });
        await emit('ads_intel', 'דילוג על ניתוח מודעות', 'skipped');
      }
    }

    // ── STEP 9: Pattern Detection ──────────────────────────────────────
    systemState.phase = 'synthesis';
    if (budget.canSpend(1500) && entities.length >= 2 && !systemState.canEarlyStop) {
      await emit('patterns', 'מזהה דפוסים חוזרים בשוק...');
      try {
        patterns = await withRetry(async () =>
          detectPatterns({ apiKey, model, entities, avatarAnalysis, niche: job.niche }),
        2, 1500);
        budget.spend(1500);
        await logUsage({ operation: 'detect_patterns', tokensUsed: 1500, success: true });
        await emit('patterns_done', `זוהו ${patterns.length} דפוסים שוקיים`, 'done', { count: patterns.length });
        for (const p of patterns.filter(x => x.priority === 'high')) {
          await emit('pattern_found', `📊 דפוס: ${p.title} (ביטחון: ${p.confidence}%)`, 'done');
        }
      } catch (e) {
        await logUsage({ operation: 'detect_patterns', tokensUsed: 0, success: false });
        await emit('patterns', 'דילוג על זיהוי דפוסים', 'skipped');
      }
    } else if (systemState.canEarlyStop) {
      await emit('patterns', 'דילוג — כבר נאסף מספיק נתונים', 'skipped');
    }

    // ── STEP 10: Gap Detection ─────────────────────────────────────────
    if (budget.canSpend(1500) && avatarResult.signals.length >= 10 && !systemState.canEarlyStop) {
      await emit('gaps', 'מחפש פערים והזדמנויות שלא מנוצלות בשוק...');
      try {
        gaps = await withRetry(async () =>
          detectGaps({ apiKey, model, entities, avatarAnalysis, niche: job.niche, adsIntelligence }),
        2, 1500);
        budget.spend(1500);
        await logUsage({ operation: 'detect_gaps', tokensUsed: 1500, success: true });
        await emit('gaps_done', `נמצאו ${gaps.length} פערים בשוק`, 'done', { count: gaps.length });
        for (const g of gaps.filter(x => x.priority === 'high')) {
          await emit('gap_found', `💡 פער: ${g.title}`, 'done');
        }
      } catch (e) {
        await logUsage({ operation: 'detect_gaps', tokensUsed: 0, success: false });
        await emit('gaps', 'דילוג על זיהוי פערים', 'skipped');
      }
    }

    // ── STEP 11: Opportunities ─────────────────────────────────────────
    if (budget.canSpend(1500) && gaps.length > 0) {
      await emit('opportunities', 'בונה הזדמנויות מוכנות לניצול...');
      try {
        opportunities = await withRetry(async () =>
          buildOpportunities({ apiKey, model, entities, avatarAnalysis, patterns, gaps, niche: job.niche }),
        2, 1500);
        budget.spend(1500);
        await logUsage({ operation: 'build_opportunities', tokensUsed: 1500, success: true });
        await emit('opportunities_done', `${opportunities.length} הזדמנויות זוהו`, 'done', { count: opportunities.length });
      } catch (e) {
        await logUsage({ operation: 'build_opportunities', tokensUsed: 0, success: false });
        await emit('opportunities', 'דילוג על בניית הזדמנויות', 'skipped');
      }
    }

    // ── STEP 12: Recommendations ───────────────────────────────────────
    if (budget.canSpend(1500)) {
      await emit('recommendations', 'מכין המלצות פעולה מוכנות לביצוע...');
      try {
        recommendations = await withRetry(async () =>
          buildRecommendations({ apiKey, model, niche: job.niche, entities, avatarAnalysis, gaps, opportunities }),
        2, 1500);
        budget.spend(1500);
        await logUsage({ operation: 'build_recommendations', tokensUsed: 1500, success: true });
        await emit('recommendations_done', `${recommendations.length} המלצות מוכנות`, 'done');
      } catch (e) {
        await logUsage({ operation: 'build_recommendations', tokensUsed: 0, success: false });
        await emit('recommendations', 'דילוג על המלצות', 'skipped');
      }
    }

    // ── STEP 13: Save to Cache ─────────────────────────────────────────
    if (rawEntities.length > 0 && avatarResult.signals.length > 0) {
      await emit('cache_save', 'שומר נתוני שוק לשימוש עתידי...');
      try {
        await supabase.from('research_cache').upsert({
          cache_key:     cacheKey,
          niche:         job.niche,
          depth_level:   job.depth_level,
          entities_data: entities,
          signals_data:  avatarResult.signals,
          insights_data: [...patterns, ...gaps, ...opportunities],
          stale_after:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          is_stale:      false,
          last_used_at:  new Date().toISOString(),
        }, { onConflict: 'cache_key' });
        await emit('cache_save_done', 'נתוני שוק נשמרו (30 יום)', 'done');
      } catch (e) { console.warn('[pipeline] cache save failed:', e.message); }
    }

    // ── STEP 14: Build Report ──────────────────────────────────────────
    systemState.phase = 'report';
    await emit('report', 'בונה דוח מחקר סופי...');
    const dataQuality   = computeDataQuality({ entities, signals: avatarResult.signals, patterns, gaps, opportunities });
    const generationMs  = Date.now() - startTime;
    const budgetSummary = budget.summary();

    const report = buildReport({
      jobId:          job.id,
      userId:         job.user_id,
      niche:          job.niche,
      depthLevel:     job.depth_level,
      entities,
      avatarAnalysis,
      adsIntelligence,
      patterns,
      gaps,
      opportunities,
      recommendations,
      dataQuality,
      aiCallsMade:    budgetSummary.aiCallsUsed,
      generationMs,
      sourcesUsed:    ['claude_researcher'],
    });

    const { data: savedReport } = await supabase.from('research_reports').insert({
      job_id:             job.id,
      user_id:            job.user_id,
      niche:              job.niche,
      depth_level:        job.depth_level,
      market_map:         report.market_map,
      avatar:             report.avatar,
      insights:           report.insights,
      recommendations:    report.recommendations,
      data_quality_score: dataQuality,
      confidence_score:   report.meta.confidence_score,
      entities_count:     entities.length,
      signals_count:      avatarResult.signals.length,
      sources_used:       ['claude_researcher'],
      ai_calls_made:      budgetSummary.aiCallsUsed,
      generation_ms:      generationMs,
      stale_at:           new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).select().single();

    // Save insights
    const allInsights = [...patterns, ...gaps, ...opportunities];
    if (allInsights.length > 0) {
      await supabase.from('research_insights').insert(
        allInsights.map(i => ({ ...i, job_id: job.id, evidence: i.evidence || [] }))
      );
    }

    // Mark job complete
    await updateJob({
      status:        'completed',
      completed_at:  new Date().toISOString(),
      ai_calls_used: budgetSummary.aiCallsUsed,
      report_id:     savedReport?.id,
      credits_used:  plan.credits,
    });

    const summary = [
      `${entities.length} מתחרים`,
      `${avatarResult.signals.length} אותות קהל`,
      `${allInsights.length} תובנות`,
      systemState.redFlags.length > 0 ? `${systemState.redFlags.length} דגלים אדומים` : null,
      systemState.canEarlyStop ? `(עצירה מוקדמת: ${systemState.earlyStopReason})` : null,
    ].filter(Boolean).join(' | ');

    await emit('done', `✅ מחקר הושלם! ${summary}`, 'done', { report_id: savedReport?.id });

    return { success: true, reportId: savedReport?.id, report, systemState };

  } catch (err) {
    console.error('[research-pipeline] fatal error:', err.message);
    await updateJob({ status: 'failed', error_message: err.message });
    await emit('error', `❌ שגיאה: ${err.message}`, 'error');
    throw err;
  }
}

module.exports = { runResearchPipeline };
