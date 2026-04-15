'use strict';

/**
 * beginner-mode.js — Beginner execution layer (Phase 4E)
 *
 * Wraps the chat pipeline for early-stage users.
 * Guides them through a 4-step "first money path":
 *   connect → analyze → fix_top_issue → track_result → graduated
 *
 * Design principles:
 *   - No extra DB reads — all state derived from already-loaded chatContext.adaptive
 *   - Pure functions for detection and response generation
 *   - One async function (persistMilestoneProgress) called fire-and-forget only
 *   - Graceful: if anything fails, normal flow is used unchanged
 */

const { upsertMemoryEntry } = require('./user-intelligence');

// ── Milestone order ───────────────────────────────────────────────────────────

const MILESTONE_ORDER = ['connect', 'analyze', 'fix_top_issue', 'track_result', 'graduated'];

// ── Milestone definitions ─────────────────────────────────────────────────────

const MILESTONES = {
  connect: {
    label:     'חיבור נתונים',
    stepLabel: 'שלב 1 מתוך 4',
    // All intents redirect — can't do anything useful without data
    redirect: (name) =>
      `היי ${name}!\n\n` +
      `📌 **${MILESTONES.connect.stepLabel}: ${MILESTONES.connect.label}**\n\n` +
      `לפני שנוכל לנתח ביצועים, צריך לחבר לפחות חשבון פרסום אחד.\n\n` +
      `**למה זה קריטי:** בלי נתונים אמיתיים, כל המלצה היא ניחוש — ואני לא מנחש.\n\n` +
      `⚡ **הצעד שלך עכשיו:**\n` +
      `1. לחץ **"אינטגרציות"** בתפריט הצדדי\n` +
      `2. בחר Google Ads או Meta Ads\n` +
      `3. עקוב אחר תהליך החיבור (2 דקות)\n\n` +
      `כשתסיים, חזור אלי ואנחנו מתקדמים.`,
    quickActions: ['חבר Google Ads', 'חבר Meta Ads', 'יש לי בעיה בחיבור'],
  },

  analyze: {
    label:     'ניתוח ראשוני',
    stepLabel: 'שלב 2 מתוך 4',
    onTopic: new Set(['overview', 'recs']),
    // Off-topic redirect
    redirect: (name) =>
      `מצוין ${name}! יש לך נתונים מחוברים.\n\n` +
      `📌 **${MILESTONES.analyze.stepLabel}: ${MILESTONES.analyze.label}**\n\n` +
      `הגיע הזמן לראות מה קורה בקמפיינים שלך.\n\n` +
      `⚡ **הצעד שלך עכשיו:** שאל אותי **"מה מצב הקמפיינים שלי?"** — אני אנתח הכל ואוציא את הממצא המרכזי.`,
    quickActions: ['מה מצב הקמפיינים שלי?', 'נתח את הביצועים שלי'],
  },

  fix_top_issue: {
    label:     'תיקון הבעיה המרכזית',
    stepLabel: 'שלב 3 מתוך 4',
    // Normal flow runs, then addendum is appended
    addendum: (issueLabel) =>
      `\n\n---\n` +
      `📌 **${MILESTONES.fix_top_issue.stepLabel}: ${MILESTONES.fix_top_issue.label}**\n\n` +
      `⚡ **הצעד שלך:** ${issueLabel ? `תקן את בעיית **${issueLabel}**` : 'יישם את ההמלצה המרכזית'}.\n` +
      `כשתסיים, כתוב לי **"עשיתי את זה"** כדי לעבור לשלב האחרון.`,
    quickActions: ['עשיתי את זה!', 'איך בדיוק לתקן?', 'הסבר לי שוב'],
  },

  track_result: {
    label:     'מדידת תוצאה',
    stepLabel: 'שלב 4 מתוך 4',
    // Normal flow runs, then addendum
    addendum: (returnDate) =>
      `\n\n---\n` +
      `📌 **${MILESTONES.track_result.stepLabel}: ${MILESTONES.track_result.label}**\n\n` +
      `⏳ **עכשיו — תמתין.** פרסום צריך 48-72 שעות לנתונים משמעותיים.\n` +
      `חזור אלי **${returnDate}** לבדיקת התוצאה. בינתיים, אל תשנה כלום.`,
    quickActions: ['בדוק תוצאות', 'מה אני עושה בינתיים?'],
  },
};

// ── Signal patterns ───────────────────────────────────────────────────────────

const OVERTHINK_RE = /\b(אולי|אבל מה|לא בטוח|מה אם|צריך לחשוב|maybe|what if|should i|בטוח\?|נכון\?|כדאי לחכות|לפני שאני|אולי כדאי|אני תוהה)\b/i;
const FRICTION_RE  = /\b(לא יודע איך|מסובך|לא מבין|אין לי זמן|קשה לי|don't know|complicated|too hard|no time|לא ברור|בלגן|מבולבל)\b/i;
const DONE_RE      = /\b(עשיתי|יישמתי|שיניתי|תיקנתי|הגדרתי|done|finished|completed|applied|עדכנתי|הורדתי|הגדלתי|ביצעתי|הפעלתי)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getReturnDate() {
  const d = new Date(Date.now() + 48 * 60 * 60 * 1000);
  return d.toLocaleDateString('he-IL', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
}

function buildProgressBar(state) {
  const steps = [
    { key: 'connect',       icon: '🔌', label: 'חיבור' },
    { key: 'analyze',       icon: '📊', label: 'ניתוח' },
    { key: 'fix_top_issue', icon: '🔧', label: 'תיקון' },
    { key: 'track_result',  icon: '📈', label: 'מדידה' },
  ];
  const current = state.milestone;
  const completed = Array.isArray(state.completed) ? state.completed : [];

  return steps
    .map(s => {
      if (completed.includes(s.key))   return `✅ ${s.label}`;
      if (s.key === current)           return `▶️ **${s.label}**`;
      return `⬜ ${s.label}`;
    })
    .join(' → ');
}

// ── State detection ───────────────────────────────────────────────────────────

/**
 * detectBeginnerState(adaptive, integrations, recentAnalysis)
 * Pure function — uses already-loaded context, zero DB calls.
 * Returns { active, milestone, overthinkCount, completed, fixIssueLabel, trackingStarted }
 */
function detectBeginnerState(adaptive, integrations, recentAnalysis) {
  const progress = adaptive.milestoneProgress;

  // Graduated → normal mode
  if (progress?.current === 'graduated') return { active: false };

  // Explicit milestone stored from a previous interaction
  if (progress?.current) {
    return {
      active:          true,
      milestone:       progress.current,
      overthinkCount:  progress.overthink_count || 0,
      completed:       Array.isArray(progress.completed) ? progress.completed : [],
      fixIssueLabel:   progress.fix_issue_label   || null,
      trackingStarted: progress.tracking_started  || null,
    };
  }

  // Auto-detect for first-time users (no milestone stored yet)
  const hasActive = integrations.some(i => i.connection_status === 'active');
  if (!hasActive) {
    return { active: true, milestone: 'connect', overthinkCount: 0, completed: [], fixIssueLabel: null, trackingStarted: null };
  }
  if (!recentAnalysis) {
    return { active: true, milestone: 'analyze', overthinkCount: 0, completed: ['connect'], fixIssueLabel: null, trackingStarted: null };
  }
  // Has integrations + analysis — default to fix_top_issue
  return { active: true, milestone: 'fix_top_issue', overthinkCount: 0, completed: ['connect', 'analyze'], fixIssueLabel: null, trackingStarted: null };
}

// ── Override generator ────────────────────────────────────────────────────────

/**
 * generateBeginnerOverride(state, intent, message, context)
 * Returns { reply, quickActions } to REPLACE normal flow, or null to let normal flow run.
 * Caller is responsible for appending addendum when null is returned for fix/track milestones.
 */
function generateBeginnerOverride(state, intent, message, context) {
  const { milestone, overthinkCount, fixIssueLabel } = state;
  const name = context.profileName || 'משתמש';
  const ms   = MILESTONES[milestone];

  if (!ms) return null;

  // ── Friction: "I don't know how" → one concrete step ─────────────────────
  if (FRICTION_RE.test(message)) {
    return { reply: buildFrictionResponse(milestone, name, fixIssueLabel), quickActions: ms.quickActions };
  }

  // ── Overthinking: 3+ hesitation signals without advancing ────────────────
  if (OVERTHINK_RE.test(message) && overthinkCount >= 2) {
    return { reply: buildOverthinkResponse(milestone, name, overthinkCount + 1, fixIssueLabel), quickActions: ms.quickActions };
  }

  // ── Per-milestone routing ─────────────────────────────────────────────────
  switch (milestone) {
    case 'connect': {
      // CA-009: intents that work WITHOUT live ad data — let normal flow run
      // (ad copy, economics, business profile, A/B test suggestions, landing pages)
      const NO_DATA_INTENTS = new Set(['copy', 'economics', 'business', 'test', 'landing_page']);
      if (NO_DATA_INTENTS.has(intent)) return null;
      // All other intents (overview, budget, top_ads, roas, ctr, recs, trends,
      // tracking, integrations) require real campaign data — redirect
      return { reply: ms.redirect(name), quickActions: ms.quickActions };
    }

    case 'analyze':
      // overview/recs are on-topic; all others redirect
      if (ms.onTopic.has(intent)) return null;
      return { reply: ms.redirect(name), quickActions: ms.quickActions };

    case 'fix_top_issue':
    case 'track_result':
      // Let normal flow run — caller appends addendum
      return null;

    default:
      return null;
  }
}

/**
 * appendBeginnerAddendum(state, normalResponse, engineResult)
 * Wraps a normal response with milestone progress bar and next-step guidance.
 * Used for fix_top_issue and track_result milestones.
 */
function appendBeginnerAddendum(state, normalResponse, engineResult) {
  const { milestone, fixIssueLabel } = state;
  const ms = MILESTONES[milestone];
  if (!ms?.addendum) return normalResponse;

  const progressBar = buildProgressBar(state);
  const issueLabel  = fixIssueLabel
    || engineResult?.issues?.[0]?.simple_label
    || engineResult?.issues?.[0]?.dict_key
    || null;

  const addendumArg = milestone === 'track_result' ? getReturnDate() : issueLabel;
  const addendum    = ms.addendum(addendumArg);

  return {
    reply:        `**${progressBar}**\n\n${normalResponse.reply}${addendum}`,
    quickActions: [...ms.quickActions, ...normalResponse.quickActions.slice(0, 1)],
  };
}

// ── Focused fallback responses ────────────────────────────────────────────────

function buildFrictionResponse(milestone, name, fixIssueLabel) {
  switch (milestone) {
    case 'connect':
      return (
        `${name}, בוא נפשט.\n\n` +
        `**צעד אחד בלבד:**\n` +
        `1. לחץ **"אינטגרציות"** בתפריט\n` +
        `2. לחץ **"חבר"** על הפלטפורמה הראשונה שאתה רואה\n` +
        `3. עקוב אחרי ההוראות\n\n` +
        `אם נתקעת בנקודה ספציפית — כתוב לי בדיוק **איפה** ואעזור.`
      );
    case 'analyze':
      return (
        `${name}, הניתוח הוא לחיצה אחת.\n\n` +
        `שאל אותי: **"מה מצב הקמפיינים שלי?"** — אני מטפל בהכל.`
      );
    case 'fix_top_issue':
      return (
        `${name}, בוא נפרק לצעד אחד:\n\n` +
        `⚡ **הפעולה האחת:** ${fixIssueLabel ? `פתח את הקמפיין שיש בו "${fixIssueLabel}" ושנה רק דבר אחד` : 'פתח את הקמפיין הגרוע ביותר ושנה רק דבר אחד'}.\n\n` +
        `לא צריך לתקן הכל. שינוי אחד. אחר כך כתוב לי **"עשיתי"**.`
      );
    case 'track_result':
      return (
        `${name}, הצעד הזה פשוט — אתה לא צריך לעשות כלום.\n\n` +
        `המתן ${getReturnDate()} ואז חזור לבדוק תוצאות. פרסום לוקח זמן.`
      );
    default:
      return `${name}, ${MILESTONES[milestone]?.stepLabel || 'הצעד הבא פשוט'}.`;
  }
}

function buildOverthinkResponse(milestone, name, count, fixIssueLabel) {
  const strong = count >= 5;
  const intro  = strong
    ? `${name} — שאלת ${count} שאלות בלי לזוז צעד. זה לא ניתוח, זה הימנעות.`
    : `${name}, אני שם לב שאתה שואל הרבה לפני שפועל. זה נורמלי — אבל הנתונים לא ייסגרו לבד.`;

  switch (milestone) {
    case 'connect':
      return `${intro}\n\n**הפעולה האחת שמקדמת אותך כרגע:** חבר חשבון פרסום אחד. כל שאלה שיש לך — אפשר לענות עליה אחרי שיש נתונים.`;
    case 'analyze':
      return `${intro}\n\n**הפעולה האחת:** הרץ ניתוח. הנתונים יענו על רוב השאלות שלך.`;
    case 'fix_top_issue':
      return (
        `${intro}\n\n` +
        `**הפעולה האחת:** ${fixIssueLabel ? `תתחיל בתיקון "${fixIssueLabel}"` : 'בצע את ההמלצה הראשונה'}. ` +
        `שנה דבר אחד. תבדוק תוצאה. רק אז תחשוב על השאלות הבאות.\n\n` +
        `כשתסיים — כתוב לי **"עשיתי"**.`
      );
    default:
      return `${intro}\n\n${MILESTONES[milestone]?.stepLabel || 'המשך לפעולה הבאה.'} — הצעד הפעיל שלך.`;
  }
}

// ── Progress resolution ───────────────────────────────────────────────────────

/**
 * resolveProgressUpdate(state, intent, message, chatContext, engineResult)
 * Pure function — returns new progress object to persist, or null if no change.
 */
function resolveProgressUpdate(state, intent, message, chatContext, engineResult) {
  const { milestone, completed, overthinkCount, trackingStarted } = state;
  const isOverthink = OVERTHINK_RE.test(message);
  const isDone      = DONE_RE.test(message);

  const issueLabel = state.fixIssueLabel
    || engineResult?.issues?.[0]?.simple_label
    || engineResult?.issues?.[0]?.dict_key
    || null;

  // Build base (may be returned with just overthink_count update)
  const base = {
    current:          milestone,
    completed:        Array.isArray(completed) ? completed : [],
    overthink_count:  isOverthink ? (overthinkCount + 1) : overthinkCount,
    fix_issue_label:  issueLabel,
    tracking_started: trackingStarted || null,
  };

  // ── Milestone auto-advancement ────────────────────────────────────────────
  switch (milestone) {
    case 'connect': {
      const nowActive = chatContext.integrations.some(i => i.connection_status === 'active');
      if (nowActive) {
        return { ...base, current: 'analyze', completed: [...base.completed, 'connect'], overthink_count: 0 };
      }
      break;
    }
    case 'analyze': {
      if (chatContext.recentAnalysis) {
        return { ...base, current: 'fix_top_issue', completed: [...base.completed, 'analyze'], overthink_count: 0 };
      }
      break;
    }
    case 'fix_top_issue': {
      if (isDone) {
        return {
          ...base,
          current:          'track_result',
          completed:        [...base.completed, 'fix_top_issue'],
          tracking_started: new Date().toISOString(),
          overthink_count:  0,
        };
      }
      break;
    }
    case 'track_result': {
      if (trackingStarted) {
        const elapsed = Date.now() - new Date(trackingStarted).getTime();
        if (elapsed >= 48 * 60 * 60 * 1000) {
          return { ...base, current: 'graduated', completed: [...base.completed, 'track_result'] };
        }
      }
      break;
    }
  }

  // Only persist if overthink count changed — avoid noisy writes
  if (isOverthink) return base;
  return null;
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function persistMilestoneProgress(userId, progress) {
  await upsertMemoryEntry(userId, 'pattern', 'milestone_progress', progress, 0.99);
}

module.exports = {
  MILESTONE_ORDER,
  detectBeginnerState,
  generateBeginnerOverride,
  appendBeginnerAddendum,
  buildProgressBar,
  resolveProgressUpdate,
  persistMilestoneProgress,
};
