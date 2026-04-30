export type EventSeverity = 'low' | 'medium' | 'high' | 'critical';
export type EventCategory = 'engagement' | 'conversion' | 'ux_problem' | 'navigation' | 'technical' | 'intent';

export interface EventCombination {
  with: string;
  conclusion: string;
}

export interface EventDefinition {
  event_type:          string;
  business_meaning:    string;
  category:            EventCategory;
  severity:            EventSeverity;
  recommended_action:  string;
  alert_threshold?:    number; // ratio 0–1
  combinations?:       EventCombination[];
}

export const EVENT_DICTIONARY: EventDefinition[] = [
  {
    event_type:         'page_view',
    business_meaning:   'גולש נחת על הדף — נקודת הכניסה לכל הניתוח',
    category:           'engagement',
    severity:           'low',
    recommended_action: 'השווה כמות צפיות לכמות קליקים במודעה — פער גדול מעיד על בעיית טעינה',
  },
  {
    event_type:         'scroll_25',
    business_meaning:   'הגולש עבר את האזור העליון (Above the Fold) — התחיל לקרוא',
    category:           'engagement',
    severity:           'low',
    recommended_action: 'אם פחות מ-60% מגיעים לכאן, הכותרת הראשית לא מספיק מושכת',
    alert_threshold:    0.4,
  },
  {
    event_type:         'scroll_50',
    business_meaning:   'גולש "מתעניין" — הגיע לאמצע התוכן',
    category:           'engagement',
    severity:           'medium',
    recommended_action: 'אם יש נפילה חדה בין scroll_25 ל-scroll_50, הבלוק הראשון משעמם',
    alert_threshold:    0.3,
  },
  {
    event_type:         'scroll_75',
    business_meaning:   'גולש "חם" — הגיע לאזור המחיר / עדויות',
    category:           'intent',
    severity:           'high',
    recommended_action: 'נפילה גדולה כאן מעידה שהמחיר או העדויות מרתיעים',
    alert_threshold:    0.25,
    combinations: [
      { with: 'exit_intent', conclusion: 'הגולש ראה את המחיר וברח — שקול לשנות מבנה תמחור או להוסיף ערבות' },
      { with: 'rage_click',  conclusion: 'יש אלמנט שבור באזור המחיר/עדויות' },
    ],
  },
  {
    event_type:         'scroll_100',
    business_meaning:   'קרא את כל הדף — כוונת רכישה גבוהה מאוד',
    category:           'intent',
    severity:           'high',
    recommended_action: 'אם הגיע ל-100% ולא שלח טופס, ייתכן שה-CTA לא בולט מספיק בסוף הדף',
  },
  {
    event_type:         'time_10s',
    business_meaning:   'הגולש נשאר לפחות 10 שניות — לא סגר מיד בטעות',
    category:           'engagement',
    severity:           'low',
    recommended_action: 'השתמש כמסנן — אל תספור גולשים שעזבו לפני 10 שנ\' בביצועי המודעה',
  },
  {
    event_type:         'time_30s',
    business_meaning:   'גולש "קורא" — השקיע זמן אמיתי בדף',
    category:           'engagement',
    severity:           'medium',
    recommended_action: 'מודעה שמביאה הרבה time_30s אבל מעט form_submit — בעיית תמחור, לא קריאייטיב',
    alert_threshold:    0.15,
  },
  {
    event_type:         'time_60s',
    business_meaning:   'גולש "שוקל ברצינות" — בילה דקה שלמה בדף',
    category:           'intent',
    severity:           'high',
    recommended_action: 'אם יש הרבה time_60s בלי form_submit, הדף חסר אלמנט אמון (ביקורות/ערבות)',
    combinations: [
      { with: 'form_start', conclusion: 'גולש שוקל ומתחיל למלא — גבוה מאוד בכוונה, שלח CAPI ל-Meta' },
    ],
  },
  {
    event_type:         'dwell_on_section',
    business_meaning:   'הגולש עצר על חלק ספציפי יותר מ-5 שניות',
    category:           'engagement',
    severity:           'medium',
    recommended_action: 'זהה איזה section עוצר אנשים — מחזק אם הוא CTA, מדאיג אם הוא מחיר',
  },
  {
    event_type:         'element_in_view',
    business_meaning:   'אלמנט חשוב (מחיר/עדויות) היה בפוקוס ראייה לפחות 2 שניות',
    category:           'engagement',
    severity:           'medium',
    recommended_action: 'השווה element_in_view לform_submit — כמה מ"ראו את המחיר" המירו',
  },
  {
    event_type:         'cta_click',
    business_meaning:   'לחץ על כפתור הנעה לפעולה (וואטסאפ / "קנה עכשיו")',
    category:           'conversion',
    severity:           'high',
    recommended_action: 'CTA clicks גבוהים בלי form_submit — בעיית המשכיות (הדף אחרי ה-CTA)',
  },
  {
    event_type:         'form_start',
    business_meaning:   'הגולש התחיל למלא — כוונת רכישה גבוהה מאוד',
    category:           'intent',
    severity:           'critical',
    recommended_action: 'כל form_start שלא הפך ל-form_submit הוא נטישת טופס — בדוק שמות שדות, מספרם',
    alert_threshold:    0.5,
    combinations: [
      { with: 'form_submit', conclusion: 'המרה מושלמת — מדוד כמה % מform_start הגיעו ל-submit' },
      { with: 'exit_intent', conclusion: 'נטש אחרי שהתחיל למלא — הטופס ארוך מדי או מפחיד' },
    ],
  },
  {
    event_type:         'form_submit',
    business_meaning:   'ליד מוצלח — הגולש השאיר פרטים',
    category:           'conversion',
    severity:           'critical',
    recommended_action: 'זה הKPI הראשי — חשב עלות לליד = ad_spend / מספר form_submit',
  },
  {
    event_type:         'video_play',
    business_meaning:   'הגולש לחץ "play" על הסרטון בדף',
    category:           'engagement',
    severity:           'medium',
    recommended_action: 'אחוז נמוך של video_play = הסרטון לא בולט מספיק (שנה תמונה ממוזערת)',
  },
  {
    event_type:         'video_50',
    business_meaning:   'צפה בחצי הסרטון — מעורבות בינונית',
    category:           'engagement',
    severity:           'medium',
    recommended_action: 'נפילה בין video_play ל-video_50 — ה-10 השניות הראשונות של הסרטון לא מושכות',
  },
  {
    event_type:         'video_90',
    business_meaning:   'צפה בכמעט כל הסרטון — מעורבות גבוהה',
    category:           'intent',
    severity:           'high',
    recommended_action: 'אם video_90 גבוה אבל form_submit נמוך, ה-CTA בסיום הסרטון חלש',
  },
  {
    event_type:         'exit_intent',
    business_meaning:   'העכבר נע לכיוון X הדפדפן — הגולש עומד לעזוב',
    category:           'navigation',
    severity:           'medium',
    recommended_action: 'מדוד באיזה scroll_depth ממוצע קורה exit_intent — זה נקודת הנטישה',
    combinations: [
      { with: 'scroll_75',  conclusion: 'ראה את המחיר וברח — שקול לבנות מחדש את חלק המחיר' },
      { with: 'form_start', conclusion: 'התחיל טופס ונטש — קצר את הטופס לשדה טלפון אחד בלבד' },
      { with: 'time_10s',   conclusion: 'יצא מהר — חוסר התאמה בין המודעה לדף (creative mismatch)' },
    ],
  },
  {
    event_type:         'rage_click',
    business_meaning:   'לחץ 3+ פעמים על אותו אלמנט תוך 500ms — תסכול',
    category:           'ux_problem',
    severity:           'high',
    recommended_action: 'בדוק איזה אלמנט סובל מrage_click — לרוב תמונה שנראית כפתור',
    alert_threshold:    0.1,
    combinations: [
      { with: 'exit_intent', conclusion: 'הדף מתסכל ומגרש גולשים בגלל בעיית UI ספציפית' },
    ],
  },
  {
    event_type:         'text_copy',
    business_meaning:   'הגולש העתיק טקסט (טלפון/כתובת) — כוונת המשך פעולה גבוהה',
    category:           'intent',
    severity:           'high',
    recommended_action: 'גולשים שמעתיקים טלפון הם לידים "עצמאיים" — עקוב מה קרה אחרי זה',
  },
  {
    event_type:         'back_navigation',
    business_meaning:   'לחץ חזור — עזב את הדף חזרה לפלטפורמת הפרסום',
    category:           'navigation',
    severity:           'high',
    recommended_action: 'back_navigation > 30% = חוסר התאמה מודעה-דף. שנה את הקריאייטיב או הכותרת',
    alert_threshold:    0.3,
    combinations: [
      { with: 'time_10s', conclusion: 'יצא תוך 10 שניות דרך "חזור" — מצב חירום: הדף לא רלוונטי לקריאייטיב' },
    ],
  },
  {
    event_type:         'js_error',
    business_meaning:   'שגיאת JavaScript — הדף לא עובד כראוי בדפדפן מסוים',
    category:           'technical',
    severity:           'critical',
    recommended_action: 'js_error > 5% = בעיה טכנית חמורה. בדוק את שם הקובץ והשורה בדוח השגיאות',
    alert_threshold:    0.05,
  },
  {
    event_type:         'broken_image',
    business_meaning:   'תמונה לא נטענה — פוגע ישירות במהימנות הדף',
    category:           'technical',
    severity:           'critical',
    recommended_action: 'כל broken_image הוא בעיה דחופה — דפים עם תמונות שבורות מאבדים 40%+ המרות',
    alert_threshold:    0.01,
  },
];

// Quick lookup map: event_type → definition
export const EVENT_DICT_MAP: Map<string, EventDefinition> =
  new Map(EVENT_DICTIONARY.map(e => [e.event_type, e]));

// Thresholds that trigger alerts
export const ALERT_EVENTS = EVENT_DICTIONARY.filter(e => e.alert_threshold !== undefined);

// Combinations for cross-event analysis
export interface CombinationInsight {
  primary:    string;
  secondary:  string;
  conclusion: string;
}

export const COMBINATION_INSIGHTS: CombinationInsight[] = EVENT_DICTIONARY.flatMap(def =>
  (def.combinations || []).map(c => ({
    primary:   def.event_type,
    secondary: c.with,
    conclusion: c.conclusion,
  }))
);
