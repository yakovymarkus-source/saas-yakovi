'use strict';

function titleFromIssue(code) {
  return String(code || 'unknown_issue')
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function buildPatternTemplate(issueCode) {
  const code = String(issueCode || '').toLowerCase();

  if (code.startsWith('low_') && code.includes('rate')) {
    return {
      professional_label: titleFromIssue(code),
      simple_label: 'היחס נמוך מהבריא',
      simple_summary: 'משהו בתהליך עובד חלש מדי, ולכן מעט מדי אנשים מתקדמים לשלב הבא.',
      likely_causes: [
        'המסר לא מספיק ברור.',
        'יש חיכוך בדרך לפעולה.',
        'הקהל או ההצעה לא מספיק מדויקים.'
      ],
      business_impact: {
        generic: 'המערכת משקיעה תנועה או חשיפה, אבל מעט מדי ממנה הופך לתוצאה עסקית.'
      },
      first_action: 'זהה את השלב שבו אנשים נופלים ושפר קודם רק אותו.',
      learn_more: {
        term: titleFromIssue(code),
        definition: 'מדד שמראה איזה חלק מהאנשים באמת ממשיכים לשלב הבא.'
      }
    };
  }

  if (code.startsWith('high_') && (code.includes('cost') || code.includes('cpa') || code.includes('cpl'))) {
    return {
      professional_label: titleFromIssue(code),
      simple_label: 'העלות גבוהה מדי',
      simple_summary: 'אתה מקבל תוצאה, אבל משלם עליה יותר מדי.',
      likely_causes: [
        'קהל יקר או לא מדויק.',
        'מודעה חלשה.',
        'המרה נמוכה אחרי הקליק.'
      ],
      business_impact: {
        generic: 'קשה להישאר רווחי כשכל תוצאה עולה יותר מדי.'
      },
      first_action: 'אל תגדיל תקציב לפני שאתה מוריד את העלות דרך קהל, מסר או דף.',
      learn_more: {
        term: titleFromIssue(code),
        definition: 'מדד עלות שמראה כמה כסף נדרש כדי לקבל תוצאה.'
      }
    };
  }

  if (code.includes('mismatch')) {
    return {
      professional_label: titleFromIssue(code),
      simple_label: 'יש חוסר התאמה בתהליך',
      simple_summary: 'מה שמושך את האנשים לא תואם מספיק למה שמחכה להם אחר כך.',
      likely_causes: [
        'פער בין המודעה לדף.',
        'המסר מושך קהל לא נכון.',
        'הציפייה שנוצרת לא תואמת את ההמשך.'
      ],
      business_impact: {
        generic: 'הכסף הולך על תנועה שנשברת בדרך במקום להתקדם.'
      },
      first_action: 'וודא שהמודעה, הדף וההצעה מדברים בדיוק על אותו דבר.',
      learn_more: {
        term: titleFromIssue(code),
        definition: 'פער בין חלקי המשפך שמוריד ביצועים.'
      }
    };
  }

  if (code.includes('tracking') || code.includes('measurement')) {
    return {
      professional_label: titleFromIssue(code),
      simple_label: 'המדידה לא מספיק יציבה',
      simple_summary: 'הנתונים לא מספיק ברורים כדי לסמוך עליהם עד הסוף.',
      likely_causes: [
        'אירועים חסרים.',
        'הטמעה חלקית.',
        'פער בין מערכות מדידה.'
      ],
      business_impact: {
        generic: 'קשה לדעת מה באמת עובד ומה לא, ולכן ההחלטות נפגעות.'
      },
      first_action: 'בדוק קודם את המדידה של הפעולה העסקית הראשית ביותר.',
      learn_more: {
        term: titleFromIssue(code),
        definition: 'קשיי מדידה שמקשים להבין את התמונה האמיתית.'
      }
    };
  }

  return null;
}

module.exports = { buildPatternTemplate, titleFromIssue };
