import { BusinessProfile, MarketResearch } from '../../domain/campaignBuild';

function categoryPatterns(category: string): string[] {
  if (/b2b|saas|software|app/i.test(category)) {
    return [
      'המתחרים מדברים בפיצ’רים ובדשבורדים במקום בהפסד עסקי או רווח תפעולי.',
      'הרבה דפים מבטיחים אוטומציה אבל לא מסבירים מה נחתך מהכאוס היומיומי.',
      'שוק ה-SaaS נוטה לשפה קרה מדי ולכן מסר שמתרגם מורכבות להחלטה עסקית בולט מהר.'
    ];
  }
  if (/coach|consult|service|agency|marketing/i.test(category)) {
    return [
      'רוב המתחרים מוכרים מומחיות כללית לפני שהם מגדירים למי בדיוק לא.',
      'השוק עמוס בהבטחות טרנספורמציה בלי הוכחה תפעולית או תהליך עבודה.',
      'הרבה שירותים נשמעים דומים כי כולם משתמשים באותו אוצר מילים של צמיחה ותוצאות.'
    ];
  }
  if (/course|education|training/i.test(category)) {
    return [
      'שחקני הקטגוריה דוחפים תוכן חינמי, ואז קופצים מהר מדי למכירה בלי לסנן רצינות.',
      'הבטחות של קיצור דרך שוחקות אמון ולכן הוכחת מתודולוגיה חשובה יותר מהייפ.',
      'רוב הדפים מסבירים מה יש בתוך הקורס ולא מה ישתנה בחיי הלקוח.'
    ];
  }
  return [
    'רוב המתחרים מוכרים הבטחה לפני שהם מוכיחים תהליך.',
    'המסרים בשוק נשענים על כאב כללי ולא על מנגנון חד.',
    'רוב הדפים דוחפים CTA מוקדם מדי בלי לבנות אמון.'
  ];
}

export async function runMarketResearch(business: BusinessProfile): Promise<MarketResearch> {
  const lowerCategory = business.category.toLowerCase();
  const amount = business.pricing.amount ?? 0;
  const stage: MarketResearch['marketStage'] =
    business.productType === 'course'
      ? 'educational'
      : amount > 3000
        ? 'mature'
        : business.goals.primary === 'awareness'
          ? 'growing'
          : 'red_ocean';

  const competitorPatterns = categoryPatterns(lowerCategory);

  const commonOffers = business.productType === 'service'
    ? ['שיחת ייעוץ', 'פגישת אבחון', 'הצעת מחיר']
    : business.productType === 'course'
      ? ['וובינר', 'מדריך חינמי', 'קורס ליבה']
      : ['הנחה לפתיחה', 'באנדל', 'דמו קצר'];

  const saturatedClaims = /b2b|saas|software|app/i.test(lowerCategory)
    ? ['הכול במקום אחד', 'סקייל בלי כאב ראש', 'אוטומציה מלאה בלי מאמץ']
    : business.productType === 'course'
      ? ['כל אחד יכול', 'שיטה פשוטה ומהירה', 'מ-0 לתוצאה בזמן קצר']
      : ['הפתרון הכי טוב בשוק', 'יותר לקוחות תוך זמן קצר', 'שיטה פשוטה שכל אחד יכול'];

  const whitespaceOpportunities = [
    `למסגר את ${business.offer} כמנגנון ולא כעוד ${business.productType}.`,
    'להסביר מה נשבר בדרך הקיימת ולמה הלקוח נתקע גם אחרי שניסה דברים אחרים.',
    'להעביר את השיחה מהבטחה עמומה להחלטה עסקית/אישית עם סיבה לפעול עכשיו.'
  ];

  if (/b2b|saas|software|app/i.test(lowerCategory)) {
    whitespaceOpportunities.unshift('לתרגם מורכבות עסקית לשפה של הפסד/רווח, לא לפיצ’רים.');
  }

  if (business.productType === 'course') {
    whitespaceOpportunities.unshift('להוביל במבנה של חינוך קצר + סינון רצינות לפני CTA כבד.');
  }

  const pricingBands = amount > 0
    ? {
        low: Math.max(1, Math.round(amount * 0.65)),
        mid: Math.round(amount),
        high: Math.round(amount * (stage === 'mature' ? 1.8 : 1.35))
      }
    : business.productType === 'service'
      ? { low: 300, mid: 1200, high: 3000 }
      : business.productType === 'course'
        ? { low: 49, mid: 199, high: 599 }
        : { low: 100, mid: 500, high: 1500 };

  const marketRisks = [
    'שוק רווי מסרים דומים.',
    'קהל שכבר ראה הבטחות דומות ונשחק מאמון.',
    business.budget.monthly && business.budget.monthly < 3000
      ? 'תקציב נמוך מחייב דיוק אכזרי. אין מקום לפיזור.'
      : 'אם לא תהיה אחידות בין מודעה, דף והצעה - הקמפיין יישרף.'
  ];

  return {
    marketStage: stage,
    competitorPatterns,
    commonOffers,
    saturatedClaims,
    whitespaceOpportunities,
    pricingBands,
    marketRisks
  };
}
