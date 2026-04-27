'use strict';

const { ok, fail, options }                    = require('./_shared/http');
const { createRequestContext, buildLogPayload } = require('./_shared/observability');
const { writeRequestLog, getAdminClient }       = require('./_shared/supabase');
const { requireAdmin }                          = require('./_shared/admin-auth');
const { AppError }                              = require('./_shared/errors');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  const context = createRequestContext(event, 'admin-qa');
  try {
    if (event.httpMethod !== 'GET') throw new AppError({ code: 'METHOD_NOT_ALLOWED', status: 405 });
    await requireAdmin(event, context.functionName, context);

    const sb      = getAdminClient();
    const since1h = new Date(Date.now() -      3_600_000).toISOString();
    const since24h= new Date(Date.now() -     86_400_000).toISOString();
    const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const [
      total1h, error1h,
      total24h, error24h,
      latencyRes,
      agentStatsRes,
      recentFailuresRes,
      topErrorsRes,
    ] = await Promise.all([
      // Counts last 1h
      sb.from('system_intelligence_logs').select('id', { count: 'exact', head: true }).gte('created_at', since1h),
      sb.from('system_intelligence_logs').select('id', { count: 'exact', head: true }).gte('created_at', since1h).in('status', ['TECH_ERROR','TIMEOUT','LOGIC_FAIL']),

      // Counts last 24h
      sb.from('system_intelligence_logs').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
      sb.from('system_intelligence_logs').select('id', { count: 'exact', head: true }).gte('created_at', since24h).in('status', ['TECH_ERROR','TIMEOUT','LOGIC_FAIL']),

      // Avg latency last 1h
      sb.from('system_intelligence_logs').select('latency_ms').gte('created_at', since1h).not('latency_ms', 'is', null).limit(500),

      // Per-agent stats last 24h
      sb.from('system_intelligence_logs').select('agent_name, status').gte('created_at', since24h),

      // Recent failures
      sb.from('system_intelligence_logs')
        .select('id, agent_name, interaction_type, status, error_details, latency_ms, created_at, user_input')
        .in('status', ['TECH_ERROR','TIMEOUT','LOGIC_FAIL'])
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(30),

      // Top error agents last 7d
      sb.from('system_intelligence_logs')
        .select('agent_name, status')
        .gte('created_at', since7d)
        .in('status', ['TECH_ERROR','TIMEOUT','LOGIC_FAIL']),
    ]);

    // Compute derived stats
    const t1h  = total1h.count  || 0;
    const e1h  = error1h.count  || 0;
    const t24h = total24h.count || 0;
    const e24h = error24h.count || 0;

    const latencies  = (latencyRes.data || []).map(r => r.latency_ms).filter(Boolean);
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const p95Latency = latencies.length ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] || 0 : 0;

    // Per-agent breakdown
    const agentMap = {};
    for (const row of (agentStatsRes.data || [])) {
      if (!agentMap[row.agent_name]) agentMap[row.agent_name] = { total: 0, errors: 0 };
      agentMap[row.agent_name].total++;
      if (row.status !== 'SUCCESS' && row.status !== 'PARTIAL') agentMap[row.agent_name].errors++;
    }
    const agentHealth = Object.entries(agentMap).map(([name, s]) => ({
      name,
      total:       s.total,
      errors:      s.errors,
      successRate: s.total > 0 ? Math.round(((s.total - s.errors) / s.total) * 100) : 100,
    })).sort((a, b) => a.successRate - b.successRate);

    // Top error agents last 7d
    const errorAgentMap = {};
    for (const row of (topErrorsRes.data || [])) {
      errorAgentMap[row.agent_name] = (errorAgentMap[row.agent_name] || 0) + 1;
    }
    const topErrorAgents = Object.entries(errorAgentMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const payload = {
      summary: {
        successRate1h:  t1h  > 0 ? Math.round(((t1h  - e1h)  / t1h)  * 100) : 100,
        successRate24h: t24h > 0 ? Math.round(((t24h - e24h) / t24h) * 100) : 100,
        total1h:  t1h,
        error1h:  e1h,
        total24h: t24h,
        error24h: e24h,
        avgLatencyMs: avgLatency,
        p95LatencyMs: p95Latency,
      },
      agentHealth,
      topErrorAgents,
      recentFailures: (recentFailuresRes.data || []).map(r => ({
        id:              r.id,
        agent:           r.agent_name,
        type:            r.interaction_type,
        status:          r.status,
        latency:         r.latency_ms,
        error:           r.error_details,
        input:           r.user_input ? r.user_input.slice(0, 120) : null,
        time:            r.created_at,
      })),
    };

    await writeRequestLog(buildLogPayload(context, 'info', 'admin-qa ok'));
    return ok(payload);
  } catch (err) {
    await writeRequestLog(buildLogPayload(context, 'error', err.message));
    return fail(err);
  }
};
