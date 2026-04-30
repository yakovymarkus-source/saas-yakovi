'use strict';

// Hidden layer — numerology + zodiac. Never surfaced to the user.
// Used only to calibrate push style, timing, and communication approach.

const NUMEROLOGY = {
  1:  { pushStyle: 'direct',      motivation: 'הישגים והובלה',     strengths: ['יוזמה', 'עצמאות'],    weaknesses: ['עקשנות', 'בדידות'] },
  2:  { pushStyle: 'gentle',      motivation: 'הרמוניה ושיתוף',    strengths: ['דיפלומטיה', 'רגישות'], weaknesses: ['חוסר החלטיות', 'תלות'] },
  3:  { pushStyle: 'energetic',   motivation: 'ביטוי ויצירה',      strengths: ['יצירתיות', 'כריזמה'],  weaknesses: ['פיזור', 'שטחיות'] },
  4:  { pushStyle: 'structured',  motivation: 'יציבות ובנייה',     strengths: ['משמעת', 'אמינות'],     weaknesses: ['נוקשות', 'פחד מסיכון'] },
  5:  { pushStyle: 'variety',     motivation: 'חופש ושינוי',       strengths: ['הסתגלות', 'אנרגיה'],   weaknesses: ['חוסר יציבות', 'אימפולסיביות'] },
  6:  { pushStyle: 'caring',      motivation: 'עזרה ואחריות',      strengths: ['מסירות', 'אמפתיה'],    weaknesses: ['פרפקציוניזם', 'הקרבה עצמית'] },
  7:  { pushStyle: 'analytical',  motivation: 'הבנה עומק',         strengths: ['ניתוח', 'אינטואיציה'], weaknesses: ['בידוד', 'ניתוח יתר'] },
  8:  { pushStyle: 'results',     motivation: 'הצלחה וכוח',        strengths: ['שאפתנות', 'עסקיות'],   weaknesses: ['חומרנות', 'שליטה'] },
  9:  { pushStyle: 'purpose',     motivation: 'השפעה ומשמעות',     strengths: ['חכמה', 'חמלה'],        weaknesses: ['פיזור', 'ויתור מוקדם'] },
  11: { pushStyle: 'visionary',   motivation: 'השראה וחזון',       strengths: ['אינטואיציה', 'רגישות'], weaknesses: ['חרדה', 'ספק עצמי'] },
  22: { pushStyle: 'ambitious',   motivation: 'בניית מורשת',       strengths: ['משמעת', 'חזון גדול'],  weaknesses: ['לחץ', 'שאפתנות יתר'] },
  33: { pushStyle: 'nurturing',   motivation: 'תרומה ושירות',      strengths: ['ריפוי', 'לימוד'],      weaknesses: ['מרטירולוגיה', 'עומס'] },
};

const ZODIAC = {
  aries:       { approach: 'ישיר ומלא אנרגיה',        avoid: 'הסברים ארוכים' },
  taurus:      { approach: 'פרקטי ויציב',             avoid: 'לחץ וחיפזון' },
  gemini:      { approach: 'מגוון ומשתנה',            avoid: 'שגרה ומונוטוניות' },
  cancer:      { approach: 'חם ותומך',                avoid: 'קרירות ומרחק' },
  leo:         { approach: 'מעריך ומחזק',             avoid: 'ביקורת ללא הכרה' },
  virgo:       { approach: 'מפורט ומדויק',            avoid: 'עמימות וחוסר סדר' },
  libra:       { approach: 'שיתופי ומאוזן',           avoid: 'לחץ לקבלת החלטות מהירה' },
  scorpio:     { approach: 'עמוק וכנה',               avoid: 'שטחיות' },
  sagittarius: { approach: 'מעורר השראה ומרחיב',      avoid: 'הגבלות' },
  capricorn:   { approach: 'ממוקד יעדים ותוצאות',     avoid: 'בזבוז זמן' },
  aquarius:    { approach: 'חדשני וחשיבה קדימה',      avoid: 'קונבנציונליות' },
  pisces:      { approach: 'אמפתי ואינטואיטיבי',      avoid: 'גסות ופרגמטיות יתר' },
};

function reduceToSingleDigit(n) {
  if (n === 11 || n === 22 || n === 33) return n;
  if (n <= 9) return n;
  return reduceToSingleDigit(String(n).split('').reduce((s, d) => s + parseInt(d, 10), 0));
}

function calcLifePath(birthDate) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  const sum = d.getDate() + (d.getMonth() + 1) + d.getFullYear();
  return reduceToSingleDigit(sum);
}

function calcZodiac(birthDate) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if ((m === 3 && day >= 21) || (m === 4 && day <= 19)) return 'aries';
  if ((m === 4 && day >= 20) || (m === 5 && day <= 20)) return 'taurus';
  if ((m === 5 && day >= 21) || (m === 6 && day <= 20)) return 'gemini';
  if ((m === 6 && day >= 21) || (m === 7 && day <= 22)) return 'cancer';
  if ((m === 7 && day >= 23) || (m === 8 && day <= 22)) return 'leo';
  if ((m === 8 && day >= 23) || (m === 9 && day <= 22)) return 'virgo';
  if ((m === 9 && day >= 23) || (m === 10 && day <= 22)) return 'libra';
  if ((m === 10 && day >= 23) || (m === 11 && day <= 21)) return 'scorpio';
  if ((m === 11 && day >= 22) || (m === 12 && day <= 21)) return 'sagittarius';
  if ((m === 12 && day >= 22) || (m === 1 && day <= 19)) return 'capricorn';
  if ((m === 1 && day >= 20) || (m === 2 && day <= 18)) return 'aquarius';
  return 'pisces';
}

function isHighEnergyDay(lifePath) {
  if (!lifePath) return false;
  const profile = NUMEROLOGY[lifePath];
  if (!profile) return false;
  const today = new Date().getDate();
  // High energy days are when day-of-month reduces to same life path number
  return reduceToSingleDigit(today) === (lifePath > 9 ? reduceToSingleDigit(lifePath) : lifePath);
}

function getPersonalityHints(birthDate) {
  if (!birthDate) return null;

  const lifePath = calcLifePath(birthDate);
  const zodiac   = calcZodiac(birthDate);

  const num  = NUMEROLOGY[lifePath] || NUMEROLOGY[9];
  const zod  = ZODIAC[zodiac]       || ZODIAC.aries;
  const highEnergy = isHighEnergyDay(lifePath);

  return [
    `המשתמש מונע על ידי: ${num.motivation}. כוון את השיחה לכיוון הזה.`,
    `נקודות חוזק שכדאי לחזק: ${num.strengths.join(', ')}.`,
    `נקודות עיוורון שכדאי לחפות עליהן בעדינות: ${num.weaknesses.join(', ')}.`,
    `גישת תקשורת אופטימלית: ${zod.approach}.`,
    `הימנע מ: ${zod.avoid}.`,
    highEnergy
      ? 'היום הוא יום אנרגיה גבוהה — טוב לדחוף לסגירות ולפעולה.'
      : 'היום הוא יום אנרגיה רגילה — תמוך ונחה, אל תלחץ יתר.',
  ].join('\n');
}

module.exports = { getPersonalityHints, calcLifePath, calcZodiac };
