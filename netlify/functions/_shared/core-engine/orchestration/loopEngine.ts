import { CampaignSession, LoopType } from './types';
import { logActivity } from './activityLog';
import { saveShortTerm, getShortTerm } from './systemMemory';
import { transition } from './stateManager';

export interface LoopResult {
  loopType: LoopType;
  iterations: number;
  resolved: boolean;
  outcome: string;
}

// Fast loop: execution → QA → fix (לבעיות תוצרים)
export async function runFastLoop(
  session: CampaignSession,
  runExecutionAgent: () => Promise<unknown>,
  runQaAgent: (assets: unknown) => Promise<{ passed: boolean; reasons: string[] }>
): Promise<LoopResult> {
  const MAX_FAST_ITERATIONS = 3;
  let iterations = 0;

  logActivity(session, 'loop_started', 'Fast loop: execution → QA → fix', {
    metadata: { maxIterations: MAX_FAST_ITERATIONS }
  });

  while (iterations < MAX_FAST_ITERATIONS) {
    iterations += 1;

    transition(session, 'executing', `fast loop iteration ${iterations}`);
    const assets = await runExecutionAgent();
    saveShortTerm(session, 'assets', assets);

    transition(session, 'qa_review', `fast loop QA iteration ${iterations}`);
    const qa = await runQaAgent(assets);
    saveShortTerm(session, 'qaResult', qa);

    logActivity(session, 'loop_started', `Fast loop iteration ${iterations}: QA ${qa.passed ? 'PASS' : 'FAIL'}`, {
      metadata: { iteration: iterations, passed: qa.passed, reasons: qa.reasons }
    });

    if (qa.passed) {
      logActivity(session, 'loop_completed', `Fast loop resolved in ${iterations} iteration(s)`);
      return { loopType: 'fast', iterations, resolved: true, outcome: 'QA passed' };
    }

    // שמור פידבק לסיבוב הבא
    saveShortTerm(session, 'qaFeedback', qa.reasons);
  }

  logActivity(session, 'loop_completed', `Fast loop exhausted after ${MAX_FAST_ITERATIONS} iterations — unresolved`);
  return { loopType: 'fast', iterations, resolved: false, outcome: 'Max iterations reached without QA pass' };
}

// Deep loop: analysis → strategy → execution (לבעיות מהותיות)
export async function runDeepLoop(
  session: CampaignSession,
  runAnalysisAgent: () => Promise<unknown>,
  runStrategyAgent: () => Promise<unknown>,
  runExecutionAgent: () => Promise<unknown>
): Promise<LoopResult> {
  const MAX_DEEP_ITERATIONS = 2;
  let iterations = 0;

  logActivity(session, 'loop_started', 'Deep loop: analysis → strategy → execution', {
    metadata: { maxIterations: MAX_DEEP_ITERATIONS }
  });

  while (iterations < MAX_DEEP_ITERATIONS) {
    iterations += 1;

    transition(session, 'analyzing', `deep loop analysis iteration ${iterations}`);
    const analysis = await runAnalysisAgent();
    saveShortTerm(session, 'lastAnalysisResult', analysis);

    transition(session, 'strategizing', `deep loop strategy iteration ${iterations}`);
    const strategy = await runStrategyAgent();
    saveShortTerm(session, 'strategy', strategy);

    transition(session, 'executing', `deep loop execution iteration ${iterations}`);
    const assets = await runExecutionAgent();
    saveShortTerm(session, 'assets', assets);

    const improvement = getShortTerm<Record<string, unknown>>(session, 'lastAnalysisResult');
    const verdict = improvement?.verdict as string | undefined;

    logActivity(session, 'loop_completed', `Deep loop iteration ${iterations}: verdict=${verdict ?? 'unknown'}`, {
      metadata: { iteration: iterations, verdict }
    });

    // אם אין יותר בעיה קריטית — צא מהלולאה
    if (verdict && !['Creative failure', 'Landing page issue', 'Budget inefficiency'].includes(verdict)) {
      return { loopType: 'deep', iterations, resolved: true, outcome: `Verdict improved to: ${verdict}` };
    }
  }

  return { loopType: 'deep', iterations, resolved: false, outcome: 'Deep loop exhausted — needs manual intervention' };
}
