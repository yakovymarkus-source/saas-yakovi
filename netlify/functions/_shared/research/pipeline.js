'use strict';

/**
 * research/pipeline.js
 * Main research pipeline orchestrator.
 * Runs all 15 steps, writes progress to research_steps table,
 * enforces budget, handles retries and fallbacks.
 *
 * Each step MUST call emit(key, message) before running.
 * All AI calls go through budget.spend().
 */

require('../env');
const { createPlan }           = require('./planner');
const { BudgetController }     = require('./budget-controller');
const { discoverCompetitors, expandCompetitors, collectAvatarSignals, collectAdsIntelligence }
                                = require('./collectors/claude-collector');
const { analyzeCompetitors }   = require('./analysis/competitor-analyzer');
const { analyzeAvatar }        = require('./analysis/avatar-analyzer');
const { detectPatterns, detectGaps, buildOpportunities, buildRecommendations, computeDataQuality }
                                = require('./analysis/synthesizer');
const { buildReport }          = require('./output/report-builder');

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

async function runResearchPipeline({ job, supabase, onStep }) {
  const startTime = Date.now();
  const plan      = createPlan(job.depth_level);
  const budget    = new BudgetController(plan);
  const apiKey    = getAnthropicKey();
  const model     = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  // Helper to emit a step and persist it
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
        data: data ? data : undefined,
      });
    } catch (e) { console.warn('[pipeline] step emit failed:', e.message); }
    if (onStep) onStep({ step_index: idx, step_key: key, message, status });
  }

  // Update job status
  async function updateJob(patch) {
    await supabase.from('research_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', job.id);
  }

  // ── State ──────────────────────────────────────────────────
  let rawEntities    = [];
  let entities       = [];
  let avatarResult   = { signals: [], segments: [] };
  let avatarAnalysis = {};
  let adsIntelligence= {};
  let patterns       = [];
  let gaps           = [];
  let opportunities  = [];
  let recommendations= [];

  try {
    await updateJob({ status: 'running', started_at: new Date().toISOString() });
    await emit('start', `מתחיל מחקר שוק ברמת "${plan.label}" לנישה: ${job.niche}`);

    // ── Check cache ───────────────────────────────────────────
    await emit('cache_check', 'בודק אם יש נתונים שמורים לנישה זו...');
    const cacheKey = `${job.niche.toLowerCase().trim()}::${job.depth_level}`;
    const { data: cached } = await supabase
      .from('research_cache')
      .select('*')
      .eq('cache_key', cacheKey)
      .eq('is_stale', false)
      .single();

    if (cached) {
      await emit('cache_hit', `נמצא מידע שמור מ-${new Date(cached.updated_at).toLocaleDateString('he-IL')} — משתמש בנתונים קיימים`, 'done');
      rawEntities = cached.entities_data || [];
      avatarResult.signals = cached.signals_data || [];
    } else {
      await emit('cache_miss', 'לא נמצא מידע שמור — מתחיל מחקר חדש', 'done');
    }

    // ── STEP 1: Discovery ─────────────────────────────────────
    if (rawEntities.length === 0) {
      await emit('discovery', `מחפש מתחרים בשוק "${job.niche}"...`);
      for (let attempt = 0; attempt <= 1; attempt++) {
        try {
          if (!budget.canSpend(1500)) { await emit('discovery', 'תקציב AI מוגבל — דילוג על הרחבה', 'skipped'); break; }
          rawEntities = await discoverCompetitors({
            apiKey, model, plan,
            niche:          job.niche,
            businessName:   job.business_name,
            targetAudience: job.target_audience,
          });
          budget.spend(1500);
          break;
        } catch (e) {
          if (attempt === 1) await emit('discovery', `⚠️ שגיאה בחיפוש מתחרים: ${e.message}`, 'error');
        }
      }
      if (rawEntities.length > 0) {
        await emit('discovery_done', `נמצאו ${rawEntities.length} מתחרים פוטנציאליים`, 'done', { count: rawEntities.length });
      }
    }

    // ── STEP 2: Deduplication ─────────────────────────────────
    await emit('dedup', 'מסיר כפילויות ומאחד ישויות דומות...');
    const { analyzeCompetitors: analyzeC } = require('./analysis/competitor-analyzer');
    const competitorResult = analyzeC(rawEntities, plan);
    entities = competitorResult.entities;
    await emit('dedup_done', `נשארו ${entities.length} מתחרים ייחודיים אחרי סינון`, 'done');

    // Log each top competitor
    for (const e of entities.slice(0, 5)) {
      await emit('competitor_found', `🏢 מצאתי מתחרה: ${e.name}${e.primary_domain ? ' (' + e.primary_domain + ')' : ''} — עוצמה: ${e.priority === 'high' ? 'גבוהה' : e.priority === 'medium' ? 'בינונית' : 'נמוכה'}`, 'done');
    }

    // ── STEP 3: Competitor Expansion ─────────────────────────
    if (budget.canSpend(1500) && entities.length > 0 && job.depth_level !== 'low') {
      await emit('expansion', 'מרחיב מידע על מתחרים מובילים...');
      try {
        entities = await expandCompetitors({ apiKey, model, competitors: entities, niche: job.niche, plan: { canSpendExpansion: true } });
        budget.spend(1500);
        await emit('expansion_done', 'הורחב מידע על מודעות ומסרים של מתחרים', 'done');
      } catch { await emit('expansion', 'דילוג על הרחבה (שגיאה)', 'skipped'); }
    }

    // Save competitors to DB
    if (entities.length > 0) {
      await supabase.from('research_entities').insert(
        entities.map(e => ({ ...e, job_id: job.id, raw_data: e.raw_data || {} }))
      ).select();
    }

    // ── STEP 4: Avatar Collection ─────────────────────────────
    if (avatarResult.signals.length === 0) {
      await emit('avatar', `חוקר את קהל היעד של "${job.niche}"...`);
      for (let attempt = 0; attempt <= 1; attempt++) {
        try {
          if (!budget.canSpend(2000)) break;
          avatarResult = await collectAvatarSignals({
            apiKey, model, plan,
            niche:          job.niche,
            targetAudience: job.target_audience,
          });
          budget.spend(2000);
          break;
        } catch (e) {
          if (attempt === 1) await emit('avatar', `⚠️ שגיאת איסוף אווטר: ${e.message}`, 'error');
        }
      }
    }

    if (avatarResult.signals.length > 0) {
      await emit('avatar_done', `נאספו ${avatarResult.signals.length} אותות מקהל היעד`, 'done', { count: avatarResult.signals.length });
      // Log signal types found
      const types = [...new Set(avatarResult.signals.map(s => s.type))];
      const typeLabels = { pain: 'כאבים', fear: 'פחדים', desire: 'רצונות', frustration: 'תסכולים', trigger: 'טריגרים', language: 'שפה' };
      await emit('avatar_types', `סוגי אותות שנמצאו: ${types.map(t => typeLabels[t] || t).join(', ')}`, 'done');

      // Save signals to DB
      await supabase.from('research_signals').insert(
        avatarResult.signals.map(s => ({ ...s, job_id: job.id }))
      );
    }

    // ── STEP 5: Avatar Analysis ───────────────────────────────
    await emit('avatar_analysis', 'מנתח דפוסים פסיכולוגיים בקהל היעד...');
    avatarAnalysis = analyzeAvatar(avatarResult.signals, plan);
    if (avatarAnalysis.corePains.length > 0) {
      await emit('avatar_pains', `כאבים מרכזיים: ${avatarAnalysis.corePains.slice(0, 3).join(' | ')}`, 'done');
    }
    if (avatarAnalysis.isLowConfidence) {
      await emit('avatar_warning', '⚠️ כמות האותות נמוכה — תוצאות האווטר בביטחון חלקי', 'done');
    }

    // ── STEP 6: Ads Intelligence ──────────────────────────────
    if (budget.canSpend(1000) && entities.length > 0) {
      await emit('ads_intel', 'מנתח מודעות ופרסומות בנישה...');
      try {
        adsIntelligence = await collectAdsIntelligence({ apiKey, model, niche: job.niche, competitors: entities, plan });
        budget.spend(1000);
        if (adsIntelligence.winning_angles?.length > 0) {
          await emit('ads_intel_done', `זוויות מנצחות שנמצאו: ${adsIntelligence.winning_angles.slice(0, 2).join(', ')}`, 'done');
        }
      } catch { await emit('ads_intel', 'דילוג על ניתוח מודעות', 'skipped'); }
    }

    // ── STEP 7: Pattern Detection ─────────────────────────────
    if (budget.canSpend(1500) && entities.length >= 2) {
      await emit('patterns', 'מזהה דפוסים חוזרים בשוק...');
      try {
        patterns = await detectPatterns({ apiKey, model, entities, avatarAnalysis, niche: job.niche });
        budget.spend(1500);
        await emit('patterns_done', `זוהו ${patterns.length} דפוסים שוקיים`, 'done', { count: patterns.length });
        patterns.forEach(p => {
          if (p.priority === 'high') {
            emit('pattern_found', `📊 דפוס: ${p.title} (ביטחון: ${p.confidence}%)`, 'done');
          }
        });
      } catch { await emit('patterns', 'דילוג על זיהוי דפוסים', 'skipped'); }
    }

    // ── STEP 8: Gap Detection ─────────────────────────────────
    if (budget.canSpend(1500) && avatarResult.signals.length >= 10) {
      await emit('gaps', 'מחפש פערים והזדמנויות שלא מנוצלות בשוק...');
      try {
        gaps = await detectGaps({ apiKey, model, entities, avatarAnalysis, niche: job.niche, adsIntelligence });
        budget.spend(1500);
        await emit('gaps_done', `נמצאו ${gaps.length} פערים בשוק`, 'done', { count: gaps.length });
        gaps.filter(g => g.priority === 'high').forEach(g => {
          emit('gap_found', `💡 פער: ${g.title}`, 'done');
        });
      } catch { await emit('gaps', 'דילוג על זיהוי פערים', 'skipped'); }
    }

    // ── STEP 9: Opportunities ─────────────────────────────────
    if (budget.canSpend(1500) && gaps.length > 0) {
      await emit('opportunities', 'בונה הזדמנויות מוכנות לניצול...');
      try {
        opportunities = await buildOpportunities({ apiKey, model, entities, avatarAnalysis, patterns, gaps, niche: job.niche });
        budget.spend(1500);
        await emit('opportunities_done', `${opportunities.length} הזדמנויות זוהו`, 'done', { count: opportunities.length });
      } catch { await emit('opportunities', 'דילוג על בניית הזדמנויות', 'skipped'); }
    }

    // ── STEP 10: Recommendations ──────────────────────────────
    if (budget.canSpend(1500)) {
      await emit('recommendations', 'מכין המלצות פעולה מוכנות לביצוע...');
      try {
        recommendations = await buildRecommendations({ apiKey, model, niche: job.niche, entities, avatarAnalysis, gaps, opportunities });
        budget.spend(1500);
        await emit('recommendations_done', `${recommendations.length} המלצות מוכנות`, 'done');
      } catch { await emit('recommendations', 'דילוג על המלצות', 'skipped'); }
    }

    // ── STEP 11: Save to cache ────────────────────────────────
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
        await emit('cache_save_done', 'נתוני שוק נשמרו לשימוש עתידי', 'done');
      } catch (e) { console.warn('[pipeline] cache save failed:', e.message); }
    }

    // ── STEP 12: Build Report ─────────────────────────────────
    await emit('report', 'בונה דוח מחקר סופי...');
    const dataQuality = computeDataQuality({ entities, signals: avatarResult.signals, patterns, gaps, opportunities });
    const generationMs= Date.now() - startTime;
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

    // Save report to DB
    const { data: savedReport } = await supabase.from('research_reports').insert({
      job_id:          job.id,
      user_id:         job.user_id,
      niche:           job.niche,
      depth_level:     job.depth_level,
      market_map:      report.market_map,
      avatar:          report.avatar,
      insights:        report.insights,
      recommendations: report.recommendations,
      data_quality_score: dataQuality,
      confidence_score:   report.meta.confidence_score,
      entities_count:     entities.length,
      signals_count:      avatarResult.signals.length,
      sources_used:       ['claude_researcher'],
      ai_calls_made:      budgetSummary.aiCallsUsed,
      generation_ms:      generationMs,
      stale_at:           new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).select().single();

    // Save insights to DB
    const allInsights = [...patterns, ...gaps, ...opportunities];
    if (allInsights.length > 0) {
      await supabase.from('research_insights').insert(
        allInsights.map(i => ({ ...i, job_id: job.id, evidence: i.evidence || [] }))
      );
    }

    // Mark job complete
    await updateJob({
      status:          'completed',
      completed_at:    new Date().toISOString(),
      ai_calls_used:   budgetSummary.aiCallsUsed,
      report_id:       savedReport?.id,
      credits_used:    plan.credits,
    });

    await emit('done', `✅ מחקר הושלם! נמצאו ${entities.length} מתחרים, ${avatarResult.signals.length} אותות קהל, ${allInsights.length} תובנות`, 'done', { report_id: savedReport?.id });

    return { success: true, reportId: savedReport?.id, report };

  } catch (err) {
    console.error('[research-pipeline] fatal error:', err.message);
    await updateJob({ status: 'failed', error_message: err.message });
    await emit('error', `❌ שגיאה: ${err.message}`, 'error');
    throw err;
  }
}

module.exports = { runResearchPipeline };
