'use strict';
/**
 * end-user-translator.js
 * מתרגם תובנות מקצועיות לשפה פשוטה למשתמש קצה.
 * מאוחד מ-dev/insight-library — dictionary, templates, explanationEngine, prioritizer, insightEngine.
 * שימוש: translateInsightsForUser(rawIssues, context) או attachEndUserInsights(analysisResult, context)
 */

const CONTRACT_VERSION = '1.0.0';

// ─── DICTIONARY ───────────────────────────────────────────────────────────────

const DICTIONARY = {
  low_ctr: {
    professional_label: 'Low CTR',
    simple_label: 'מעט מדי אנשים לוחצים על המודעה',
    simple_summary: 'המודעה לא מצליחה לעצור מספיק אנשים ולהכניס אותם פנימה.',
    business_impact: {
      generic: 'אתה משלם על חשיפה בלי לקבל מספיק כניסות איכותיות.',
      services: 'פחות אנשים פותחים שיחה או משאירים פרטים, למרות שהמודעה נחשפת.',
      ecommerce: 'פחות אנשים מגיעים למוצר, ולכן יש פחות סיכוי לרכישה.',
      lead_generation: 'התקציב הולך על צפיות, אבל מעט מדי אנשים מתקדמים לטופס או לשיחה.',
    },
    likely_causes: [
      'הכותרת חלשה או כללית מדי.',
      'הקריאייטיב לא בולט מספיק בתוך הפיד.',
      'המסר לא ברור מיד ברגע הראשון.',
    ],
    first_action: 'החלף קודם את הכותרת או הקריאייטיב הראשי ובדוק גרסה חדה יותר.',
    learn_more: { term: 'CTR', definition: 'אחוז האנשים שלחצו על המודעה מתוך כל מי שראו אותה.' },
  },
  high_cpa: {
    professional_label: 'High CPA',
    simple_label: 'כל ליד עולה לך יקר מדי',
    simple_summary: 'הקמפיין מביא תוצאות, אבל המחיר לכל תוצאה כבד מדי.',
    business_impact: {
      generic: 'הרווח נשחק והפרסום נהיה יקר ולא בריא.',
      services: 'אתה משלם יותר מדי על כל פנייה, ולכן קשה להישאר רווחי.',
      ecommerce: 'עלות הרכישה עולה ואוכלת את המרווח על המוצר.',
      lead_generation: 'כל ליד עולה יותר מדי, ולכן קשה להגדיל תקציב בלי להפסיד.',
    },
    likely_causes: [
      'הקהל רחב מדי או לא מדויק.',
      'המודעה מביאה תנועה חלשה.',
      'ההצעה לא מספיק ברורה או משכנעת.',
    ],
    first_action: 'בדוק קודם קהל, קריאייטיב והצעה לפני שאתה מגדיל תקציב.',
    learn_more: { term: 'CPA', definition: 'העלות שאתה משלם כדי לקבל פעולה אחת חשובה, כמו ליד או רכישה.' },
  },
  low_conversion_rate: {
    professional_label: 'Low Conversion Rate',
    simple_label: 'אנשים נכנסים אבל לא משאירים פרטים',
    simple_summary: 'יש תנועה, אבל מעט מדי ממנה הופכת לפעולה אמיתית.',
    business_impact: {
      generic: 'אתה קונה ביקורים שלא הופכים ללקוחות.',
      services: 'אנשים מגיעים, אבל מעט מדי סוגרים שיחה או משאירים פרטים.',
      ecommerce: 'יש כניסות, אבל מעט מדי מבצעים רכישה.',
      lead_generation: 'יש תנועה לטופס, אבל מעט מדי טפסים נשלחים.',
    },
    likely_causes: [
      'הדף לא מסביר מהר מספיק למה כדאי להישאר.',
      'הקריאה לפעולה חלשה או מוסתרת.',
      'יש חוסר התאמה בין ההבטחה במודעה למה שרואים בדף.',
    ],
    first_action: 'פשט את הדף, חזק את ההצעה והבלט את הקריאה לפעולה.',
    learn_more: { term: 'Conversion Rate', definition: 'האחוז מתוך המבקרים שביצעו את הפעולה שרצית.' },
  },
  audience_mismatch: {
    professional_label: 'Audience Mismatch',
    simple_label: 'המודעה מגיעה לאנשים הלא נכונים',
    simple_summary: 'המסר נחשף לקהל שלא באמת מתאים להצעה שלך.',
    business_impact: {
      generic: 'התקציב נשרף על תנועה חלשה ולא מדויקת.',
      services: 'אתה מושך פניות לא רלוונטיות או כאלה שלא יסגרו.',
      ecommerce: 'אנשים שלא מתאימים למוצר רואים אותו, ולכן יחס הקנייה נפגע.',
      lead_generation: 'נכנסים לידים חלשים או לא מתאימים, והצוות מבזבז זמן.',
    },
    likely_causes: [
      'הטרגוט רחב מדי.',
      'המסר במודעה מושך קהל כללי במקום קהל מדויק.',
      'הקריאייטיב לא מסנן את מי שלא מתאים.',
    ],
    first_action: 'צמצם או דייק את הטרגוט כדי להגיע לקהל שמתאים להצעה.',
    learn_more: { term: 'Audience Fit', definition: 'כמה הקהל שנחשף למודעה באמת מתאים למוצר או לשירות שלך.' },
  },
  landing_page_issue: {
    professional_label: 'Landing Page Issue',
    simple_label: 'הדף לא משכנע מספיק',
    simple_summary: 'אנשים מגיעים, אבל לא מבינים מהר למה להישאר ולפעול.',
    business_impact: {
      generic: 'פחות לידים או מכירות מאותו תקציב.',
      services: 'הביקור לא הופך לשיחה, ולכן פניות הולכות לאיבוד.',
      ecommerce: 'המבקר מגיע למוצר אבל נופל לפני הקנייה.',
      lead_generation: 'הטופס לא נסגר מספיק, למרות שיש תנועה.',
    },
    likely_causes: [
      'הכותרת לא ברורה.',
      'העמוד עמוס או מבלבל.',
      'הקריאה לפעולה חלשה או לא בולטת.',
    ],
    first_action: 'פשט את הכותרת והקריאה לפעולה והסר רעש מיותר מהעמוד.',
    learn_more: { term: 'Landing Page', definition: 'העמוד שאליו מגיעים אחרי הלחיצה על המודעה.' },
  },
  poor_creative: {
    professional_label: 'Poor Creative Performance',
    simple_label: 'הקריאייטיב לא מחזיק את תשומת הלב',
    simple_summary: 'המודעה לא מספיק חזקה כדי לעצור, לסקרן ולהניע לפעולה.',
    business_impact: {
      generic: 'פחות עניין, פחות קליקים ופחות תוצאות מאותו תקציב.',
      services: 'המודעה לא גורמת לאנשים טובים לפנות.',
      ecommerce: 'המוצר לא נראה מספיק מושך או ברור ולכן המכירות נפגעות.',
      lead_generation: 'המסר חלש מדי ולכן מעט אנשים ממשיכים לטופס.',
    },
    likely_causes: ['הפתיח חלש.', 'הוויזואל לא בולט.', 'אין מסר חד או בידול ברור.'],
    first_action: 'בדוק זווית חדשה למסר הראשי וגרסה חזותית בולטת יותר.',
    learn_more: { term: 'Creative', definition: 'השילוב של תמונה, וידאו, כותרת וטקסט במודעה.' },
  },
  low_roas: {
    professional_label: 'Low ROAS',
    simple_label: 'הפרסום לא מחזיר מספיק כסף',
    simple_summary: 'ההכנסות מהקמפיין נמוכות מדי ביחס למה שאתה משקיע בו.',
    business_impact: {
      generic: 'הפרסום עובד, אבל לא באמת מצדיק את ההוצאה.',
      services: 'אתה משקיע בפרסום בלי לראות מספיק סגירות או הכנסה בפועל.',
      ecommerce: 'ההכנסה מכל שקל פרסום נמוכה מדי, ולכן הרווח נמחץ.',
      lead_generation: 'גם אם יש לידים, הם לא מחזירים מספיק ערך מול העלות.',
    },
    likely_causes: ['הצעה חלשה.', 'קהל לא מדויק.', 'המרה נמוכה אחרי הקליק.'],
    first_action: 'בדוק קודם את איכות ההצעה והעמוד לפני הגדלת הוצאה.',
    learn_more: { term: 'ROAS', definition: 'כמה הכנסה נכנסה על כל שקל שהושקע בפרסום.' },
  },
  weak_offer: {
    professional_label: 'Weak Offer',
    simple_label: 'ההצעה לא מספיק חזקה',
    simple_summary: 'הלקוח לא מרגיש שיש כאן סיבה מספיק טובה לפעול עכשיו.',
    business_impact: {
      generic: 'גם תנועה טובה לא תספיק אם ההצעה לא משכנעת.',
      services: 'אנשים מתעניינים, אבל לא מרגישים דחיפות להשאיר פרטים.',
      ecommerce: 'המוצר נראה רגיל מדי ולכן פחות אנשים קונים.',
      lead_generation: 'יש כניסות, אבל מעט מדי אנשים מרגישים ששווה להשאיר פרטים.',
    },
    likely_causes: ['אין בידול ברור.', 'אין תועלת חדה ומיידית.', 'אין סיבה טובה לפעול עכשיו.'],
    first_action: 'חדד את הערך המרכזי והצג סיבה ברורה לפעול כבר עכשיו.',
    learn_more: { term: 'Offer Strength', definition: 'כמה ההצעה שלך ברורה, מושכת ומשכנעת לפעולה.' },
  },
  low_quality_traffic: {
    professional_label: 'Low Quality Traffic',
    simple_label: 'מגיעים אנשים, אבל הם לא באמת שווים',
    simple_summary: 'יש תנועה, אבל היא לא מתנהגת כמו קהל שבא לקנות או להשאיר פרטים.',
    business_impact: {
      generic: 'התקציב מביא נפח, אבל לא איכות.',
      services: 'מגיעות פניות חלשות או לא רלוונטיות.',
      ecommerce: 'יש ביקורים, אבל מעט עניין אמיתי במוצר.',
      lead_generation: 'הטופס רואה תנועה, אבל הקהל לא באמת בשל להשאיר פרטים.',
    },
    likely_causes: [
      'המסר מושך קהל סקרן מדי ולא קהל בשל.',
      'הטרגוט רחב מדי.',
      'הערוץ מביא כמות במקום איכות.',
    ],
    first_action: 'בדוק מחדש את המסר והטרגוט כדי לסנן קהל לא רלוונטי.',
    learn_more: { term: 'Traffic Quality', definition: 'עד כמה התנועה שמגיעה באמת מתאימה למטרה העסקית שלך.' },
  },
  tracking_uncertainty: {
    professional_label: 'Tracking Uncertainty',
    simple_label: 'הנתונים לא מספיק אמינים',
    simple_summary: 'קשה לסמוך על המספרים, ולכן גם קשה לקבל החלטה חכמה.',
    business_impact: {
      generic: 'אתה עלול לשפר את הדבר הלא נכון או לעצור משהו שכן עובד.',
      services: 'אי אפשר לדעת איזה מקור באמת מביא פניות.',
      ecommerce: 'קשה לדעת מאיפה באמת מגיעות רכישות.',
      lead_generation: 'אי אפשר לדעת איזה קמפיין באמת מייצר לידים טובים.',
    },
    likely_causes: [
      'אירועים לא מוגדרים נכון.',
      'חסרים חיבורים בין מערכות.',
      'יש פער בין פלטפורמת הפרסום לנתוני האתר.',
    ],
    first_action: 'בדוק קודם שהאירועים המרכזיים נמדדים נכון מקצה לקצה.',
    learn_more: { term: 'Tracking', definition: 'הדרך שבה המערכת מודדת קליקים, לידים, רכישות ושאר פעולות.' },
  },
};

// ─── TEMPLATES (pattern-based fallback) ──────────────────────────────────────

function _titleFromCode(code) {
  return String(code || 'unknown')
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function _buildPatternTemplate(code) {
  if (code.startsWith('low_') && code.includes('rate')) {
    return {
      professional_label: _titleFromCode(code),
      simple_label: 'היחס נמוך מהבריא',
      simple_summary: 'משהו בתהליך עובד חלש מדי, ולכן מעט מדי אנשים מתקדמים לשלב הבא.',
      business_impact: { generic: 'המערכת משקיעה תנועה אבל מעט מדי ממנה הופכת לתוצאה עסקית.' },
      likely_causes: ['המסר לא מספיק ברור.', 'יש חיכוך בדרך לפעולה.', 'הקהל או ההצעה לא מספיק מדויקים.'],
      first_action: 'זהה את השלב שבו אנשים נופלים ושפר קודם רק אותו.',
      learn_more: { term: _titleFromCode(code), definition: 'מדד שמראה איזה חלק מהאנשים ממשיכים לשלב הבא.' },
    };
  }
  if (code.startsWith('high_') && (code.includes('cost') || code.includes('cpa') || code.includes('cpl'))) {
    return {
      professional_label: _titleFromCode(code),
      simple_label: 'העלות גבוהה מדי',
      simple_summary: 'אתה מקבל תוצאה, אבל משלם עליה יותר מדי.',
      business_impact: { generic: 'קשה להישאר רווחי כשכל תוצאה עולה יותר מדי.' },
      likely_causes: ['קהל יקר או לא מדויק.', 'מודעה חלשה.', 'המרה נמוכה אחרי הקליק.'],
      first_action: 'אל תגדיל תקציב לפני שאתה מוריד את העלות דרך קהל, מסר או דף.',
      learn_more: { term: _titleFromCode(code), definition: 'מדד עלות שמראה כמה כסף נדרש כדי לקבל תוצאה.' },
    };
  }
  if (code.includes('mismatch')) {
    return {
      professional_label: _titleFromCode(code),
      simple_label: 'יש חוסר התאמה בתהליך',
      simple_summary: 'מה שמושך את האנשים לא תואם מספיק למה שמחכה להם אחר כך.',
      business_impact: { generic: 'הכסף הולך על תנועה שנשברת בדרך במקום להתקדם.' },
      likely_causes: ['פער בין המודעה לדף.', 'המסר מושך קהל לא נכון.', 'הציפייה שנוצרת לא תואמת את ההמשך.'],
      first_action: 'וודא שהמודעה, הדף וההצעה מדברים בדיוק על אותו דבר.',
      learn_more: { term: _titleFromCode(code), definition: 'פער בין חלקי המשפך שמוריד ביצועים.' },
    };
  }
  if (code.includes('tracking') || code.includes('measurement')) {
    return {
      professional_label: _titleFromCode(code),
      simple_label: 'המדידה לא מספיק יציבה',
      simple_summary: 'הנתונים לא מספיק ברורים כדי לסמוך עליהם עד הסוף.',
      business_impact: { generic: 'קשה לדעת מה באמת עובד ומה לא, ולכן ההחלטות נפגעות.' },
      likely_causes: ['אירועים חסרים.', 'הטמעה חלקית.', 'פער בין מערכות מדידה.'],
      first_action: 'בדוק קודם את המדידה של הפעולה העסקית הראשית ביותר.',
      learn_more: { term: _titleFromCode(code), definition: 'קשיי מדידה שמקשים להבין את התמונה האמיתית.' },
    };
  }
  return null;
}

function _safeFallback(code) {
  return {
    professional_label: code,
    simple_label: 'יש כאן נקודה שדורשת בדיקה',
    simple_summary: 'המערכת זיהתה סימן לבעיה, אבל לא מדובר בתבנית מוכרת מספיק.',
    business_impact: { generic: 'כנראה שיש כאן משהו שפוגע בביצועים או מקשה על קבלת החלטות.' },
    likely_causes: ['יש חריגה בנתונים.', 'יש חולשה מקומית במשפך.', 'חסר הקשר מלא כדי לדייק את הסיבה.'],
    first_action: 'בדוק קודם את השלב שבו הביצועים ירדו בצורה החדה ביותר.',
    learn_more: { term: code, definition: 'סימון פנימי לבעיה שדורשת בדיקה נוספת.' },
  };
}

// ─── EXPLANATION ENGINE ───────────────────────────────────────────────────────

const VALID_BUSINESS_TYPES = ['services', 'ecommerce', 'lead_generation', 'generic'];
const VALID_SEVERITIES     = ['low', 'medium', 'high', 'critical'];

function _normalizeBusinessType(input) {
  return VALID_BUSINESS_TYPES.includes(input) ? input : 'generic';
}

function _normalizeSeverity(input) {
  const v = String(input || '').toLowerCase();
  return VALID_SEVERITIES.includes(v) ? v : 'medium';
}

function _pickSource(code) {
  if (DICTIONARY[code]) return DICTIONARY[code];
  const tmpl = _buildPatternTemplate(code);
  if (tmpl) return tmpl;
  return _safeFallback(code);
}

function _resolveImpact(source, businessType) {
  const type = _normalizeBusinessType(businessType);
  return source.business_impact[type] || source.business_impact.generic || 'יש כאן פגיעה עסקית שדורשת טיפול.';
}

function _buildExplanation(issue, context = {}) {
  const code     = String(issue.issue_code || '').toLowerCase();
  const source   = _pickSource(code);
  const severity = _normalizeSeverity(issue.severity);
  const priority = typeof issue.priority_rank === 'number' ? issue.priority_rank : 999;
  const userLevel    = context.user_level    || 'beginner';
  const displayMode  = context.display_mode  || 'simple';
  const businessType = _normalizeBusinessType(context.business_type);

  return {
    id:                 `${code}:${severity}:${priority}`,
    issue_code:         code,
    title:              source.simple_label,
    explanation:        source.simple_summary,
    action:             source.first_action,
    severity,
    professional_label: source.professional_label,
    simple_label:       source.simple_label,
    simple_summary:     source.simple_summary,
    business_impact:    _resolveImpact(source, businessType),
    likely_causes:      source.likely_causes,
    first_action:       source.first_action,
    learn_more:         source.learn_more,
    confidence:         typeof issue.confidence === 'number' ? issue.confidence : 0.6,
    priority,
    user_level:         userLevel,
    display_mode:       displayMode,
  };
}

// ─── PRIORITIZER ─────────────────────────────────────────────────────────────

const SEVERITY_SCORE = { critical: 400, high: 300, medium: 200, low: 100 };

function _rankInsights(insights) {
  return [...insights].sort((a, b) => {
    const sd = (SEVERITY_SCORE[b.severity] || 0) - (SEVERITY_SCORE[a.severity] || 0);
    if (sd !== 0) return sd;
    const pd = (a.priority || 999) - (b.priority || 999);
    if (pd !== 0) return pd;
    return (b.confidence || 0) - (a.confidence || 0);
  });
}

// ─── MAIN ENGINE ─────────────────────────────────────────────────────────────

/**
 * translateInsightsForUser(rawIssues, context)
 *
 * @param {Array}  rawIssues  — מערך של { issue_code, severity?, confidence?, priority_rank?, metrics? }
 * @param {object} context    — { business_type?, user_level?, display_mode? }
 * @returns {{ primary_insight, secondary_insights, all_insights, meta }}
 */
function translateInsightsForUser(rawIssues = [], context = {}) {
  if (!Array.isArray(rawIssues) || rawIssues.length === 0) {
    return _emptyBundle(context);
  }

  const normalized = [];
  const seen = new Set();

  for (let i = 0; i < rawIssues.length; i++) {
    const r = rawIssues[i];
    if (!r || typeof r !== 'object') continue;
    const code = String(r.issue_code || r.code || '').trim();
    if (!code) continue;
    const key = `${code}|${r.severity}|${r.confidence}|${r.priority_rank}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ issue_code: code, severity: r.severity, confidence: r.confidence, priority_rank: i, metrics: r.metrics || null });
  }

  const translated = [];
  const skipped    = [];

  for (const issue of normalized) {
    try {
      translated.push(_buildExplanation(issue, context));
    } catch (err) {
      skipped.push({ issue_code: issue.issue_code, reason: err.message });
    }
  }

  const ranked   = _rankInsights(translated);
  const [primary, ...rest] = ranked;

  return {
    primary_insight:     primary || null,
    secondary_insights:  rest.slice(0, 2),
    all_insights:        ranked,
    skipped_insights:    skipped,
    meta: {
      total_input:      rawIssues.length,
      total_processed:  translated.length,
      total_skipped:    skipped.length,
      business_type:    _normalizeBusinessType(context.business_type),
      user_level:       context.user_level    || 'beginner',
      display_mode:     context.display_mode  || 'simple',
      contract_version: CONTRACT_VERSION,
    },
  };
}

function _emptyBundle(context = {}) {
  return {
    primary_insight:    null,
    secondary_insights: [],
    all_insights:       [],
    skipped_insights:   [],
    meta: {
      total_input: 0, total_processed: 0, total_skipped: 0,
      business_type:    _normalizeBusinessType(context.business_type),
      user_level:       context.user_level   || 'beginner',
      display_mode:     context.display_mode || 'simple',
      contract_version: CONTRACT_VERSION,
    },
  };
}

/**
 * attachEndUserInsights(analysisResult, context)
 * מוסיף translated_insights לתוצאת ניתוח קיימת — ללא דריסה.
 *
 * @param {object} analysisResult — תוצאת ה-pipeline הקיים
 * @param {object} context        — { business_type?, user_level?, display_mode? }
 */
function attachEndUserInsights(analysisResult, context = {}) {
  if (!analysisResult || typeof analysisResult !== 'object') return analysisResult;

  const raw = Array.isArray(analysisResult.issues)   ? analysisResult.issues
            : Array.isArray(analysisResult.findings) ? analysisResult.findings
            : Array.isArray(analysisResult.insights) ? analysisResult.insights
            : [];

  // מנסה לחלץ קודי בעיות גם ממבנים שונים
  const normalized = raw.map((item) => {
    if (typeof item === 'string') return { issue_code: item };
    if (item && (item.issue_code || item.code || item.type)) {
      return { issue_code: item.issue_code || item.code || item.type, ...item };
    }
    return item;
  }).filter(Boolean);

  return {
    ...analysisResult,
    end_user_insights: translateInsightsForUser(normalized, context),
  };
}

module.exports = { translateInsightsForUser, attachEndUserInsights, DICTIONARY };
