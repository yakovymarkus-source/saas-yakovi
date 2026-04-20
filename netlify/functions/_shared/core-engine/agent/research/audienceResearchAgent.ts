import { AudienceResearch, BusinessProfile, MarketResearch } from '../../domain/campaignBuild';

function buildPersonaLabel(business: BusinessProfile): string {
  if (business.audienceHint?.trim()) return business.audienceHint.trim();
  if (business.goals.primary === 'appointments') return 'ליד חם שמפחד לבזבז זמן על שיחה לא מדויקת';
  if (business.goals.primary === 'sales') return 'קונה ספקן שמחפש ודאות לפני רכישה';
  if (business.goals.primary === 'leads') return 'לקוח עם כאב ברור אבל עם אמון שבור';
  return 'קהל קר שצריך להבין למה זה רלוונטי אליו עכשיו';
}

export async function runAudienceResearch(
  business: BusinessProfile,
  market: MarketResearch
): Promise<AudienceResearch> {
  const personaLabel = buildPersonaLabel(business);
  const educational = market.marketStage === 'educational';
  const surfacePains = [
    `הוא רוצה ${business.targetOutcome} אבל לא סומך על עוד הבטחה כללית.`,
    'הוא מבולבל מעודף מידע ומפחד לבחור לא נכון.',
    'הוא לא רוצה לעבור תהליך ארוך בלי להבין מהר מה יוצא לו מזה.'
  ];
  const deepPains = [
    'הוא חושש שהוא שוב ישקיע כסף ואנרגיה וירגיש מטומטם מול עצמו.',
    'הוא לא רק מחפש פתרון - הוא מחפש דרך להפסיק לאבד שליטה על ההחלטה.',
    'הוא לא רוצה עוד מסר חכם. הוא רוצה משהו שמרגיש בטוח מספיק כדי לזוז.'
  ];
  const objectionsByStage = {
    awareness: ['אני עדיין לא בטוח שזה בכלל העניין שלי.', 'למה לעצור עכשיו ולהתעמק בזה?'],
    consideration: ['איך זה שונה ממה שכבר ניסיתי?', 'למה דווקא אתם ולא עוד שחקן שנשמע דומה?'],
    conversion: [business.pricing.amount ? `למה המחיר ${business.pricing.amount} ${business.pricing.currency}?` : 'כמה זה יעלה לי באמת?', 'מה קורה אם אני נכנס ולא מקבל ערך מהר?']
  };

  return {
    corePersona: {
      label: personaLabel,
      pains: [...surfacePains, ...deepPains],
      surfacePains,
      deepPains,
      desires: [
        `לקבל מסלול ברור ל-${business.targetOutcome}.`,
        'להרגיש שמבינים את הבעיה שלו בלי לנפח סיפורים.',
        'להתקדם מהר בלי להמר על כסף וזמן.'
      ],
      fears: [
        'להוציא כסף ולהישאר באותו מקום.',
        'ליפול לעוד פתרון שנשמע חכם אבל לא מחזיק במציאות.',
        'להתחייב מוקדם מדי לפני שהוא מבין מה באמת קורה כאן.'
      ],
      objections: [...objectionsByStage.consideration, ...objectionsByStage.conversion],
      objectionsByStage,
      triggers: [
        'בהירות מהירה',
        'הוכחה קונקרטית',
        'שפה שמרגישה אמיתית ולא שיווקית מדי',
        educational ? 'חינוך שוק קצר לפני CTA' : 'הבטחה מדויקת עם דחיפות'
      ],
      languagePatterns: [
        'תכלס, מה אני מקבל?',
        'מה ההבדל בינך לבין כל השאר?',
        'איך אני יודע שזה לא עוד בזבוז זמן?',
        'איפה פה החלק שבאמת חוסך לי טעות?'
      ],
      behavioralSignals: [
        'שומר טאבים פתוחים ומשווה הרבה לפני החלטה.',
        'נכנס לדף אבל נבהל כשאין מהר הוכחה או כיוון.',
        'יגיב חזק למסרים שמסדרים לו את הראש לפני שמוכרים לו.'
      ]
    },
    awarenessLevel: educational ? 'solution_aware' : business.pricing.amount && business.pricing.amount < 300 ? 'product_aware' : 'problem_aware',
    emotionalDrivers: ['שליטה', 'בהירות', 'חיסכון בזמן', 'פחד מטעות יקרה'],
    buyingBarriers: ['אמון נמוך', 'שחיקת שוק', 'עודף אפשרויות', 'חשש מהתחייבות']
  };
}
