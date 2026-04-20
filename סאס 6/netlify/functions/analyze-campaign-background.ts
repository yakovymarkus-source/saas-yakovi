'use strict';
/**
 * analyze-campaign-background.ts
 * Netlify Background Function — returns 202 immediately, runs up to 15 min.
 *
 * POST /analyze-campaign-background
 * Body: { jobId: string }
 * Header: x-internal-secret
 *
 * Reads job from orchestration_jobs table, runs the appropriate agent via superLayer,
 * and saves result + session snapshot to Supabase.
 */

import { createClient } from '@supabase/supabase-js';
import {
  startSession,
  runResearchAgent,
  runStrategyAgent,
  runExecutionAgent,
  runQaAgent,
  runAnalysisAgentOnSession,
} from './_shared/core-engine/orchestration/superLayer';
import type { CampaignGoal, AutomationLevel } from './_shared/core-engine/orchestration/types';
import type { AuthenticatedUser } from './_shared/core-engine/types/domain';
import type { CampaignBuildInput } from './_shared/core-engine/domain/campaignBuild';

type HandlerEvent = {
  httpMethod: string;
  headers: Record<string, string>;
  body: string | null;
};

type HandlerResponse = {
  statusCode: number;
  body: string;
};

function db() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function markFailed(supabase: ReturnType<typeof db>, jobId: string, error: string) {
  await supabase
    .from('orchestration_jobs')
    .update({ status: 'failed', error_message: error, finished_at: new Date().toISOString() })
    .eq('id', jobId);
}

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const secret = process.env.INTERNAL_SECRET || '';
  if (secret && event.headers['x-internal-secret'] !== secret) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  let body: { jobId?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { jobId } = body;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'jobId required' }) };
  }

  const supabase = db();

  // Load job
  const { data: job, error: jobErr } = await supabase
    .from('orchestration_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Job not found' }) };
  }
  if (job.status !== 'pending') {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, status: job.status }) };
  }

  // Mark running
  await supabase
    .from('orchestration_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', jobId);

  const user: AuthenticatedUser = {
    id: job.user_id,
    email: job.user_email || '',
    roles: ['user'],
    permissions: [],
    token: '',
    supabaseUserId: job.user_id,
  };

  const goal: CampaignGoal = job.goal || {
    type: 'leads',
    target: 100,
    timeframe: '30d',
    metric: 'leads',
  };

  const automationLevel: AutomationLevel = job.automation_level || 'semi';

  try {
    // Create orchestration session
    const session = startSession(user.id, job.campaign_id, goal, automationLevel);
    const sessionId = session.id;

    let result;
    const action: string = job.action || 'research';

    if (action === 'research') {
      const buildInput: CampaignBuildInput = job.campaign_data;
      result = await runResearchAgent(sessionId, buildInput, user);
    } else if (action === 'strategy') {
      const buildInput: CampaignBuildInput = job.campaign_data;
      result = await runStrategyAgent(sessionId, job.campaign_id, buildInput, user);
    } else if (action === 'execution') {
      const buildInput: CampaignBuildInput = job.campaign_data;
      result = await runExecutionAgent(sessionId, job.campaign_id, buildInput, user, job.exec_target);
    } else if (action === 'qa') {
      const buildInput: CampaignBuildInput = job.campaign_data;
      result = await runQaAgent(sessionId, job.campaign_id, buildInput, user);
    } else if (action === 'analysis') {
      result = await runAnalysisAgentOnSession(sessionId, job.analysis_data, user, jobId);
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    // Save result
    await supabase
      .from('orchestration_jobs')
      .update({
        status: 'completed',
        result: result,
        finished_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, jobId, state: result.state }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[analyze-campaign-background] Error:', message);
    await markFailed(supabase, jobId, message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};
