import { VideoScriptPack } from '../../domain/assets';
import { AudienceResearch, BusinessProfile, OfferStrategy, PositioningDecision } from '../../domain/campaignBuild';

export async function runVideoScripts(
  business: BusinessProfile,
  audience: AudienceResearch,
  positioning: PositioningDecision,
  offer: OfferStrategy,
  feedback: string[] = [],
  attempt = 1
): Promise<VideoScriptPack> {
  const cta =
    offer.ctaType === 'book_call' ? 'לקביעת שיחה' :
    offer.ctaType === 'buy_now' ? 'לקנייה עכשיו' :
    offer.ctaType === 'apply_now' ? 'להגשת מועמדות' :
    'להשארת פרטים';

  const repairLine = feedback.length ? feedback.join(' | ') : 'ללא קלישאות וללא מילים חלולות';

  return {
    scripts: [
      {
        format: 'ugc',
        hook: `${audience.corePersona.surfacePains?.[0] ?? audience.corePersona.pains[0]}. זה לא קורה כי ההצעה נשמעת כמו כולם.`,
        body: `${positioning.coreAngle}. ${positioning.uniqueMechanism}. ${business.targetOutcome}. ${repairLine}.`,
        cta,
        shotNotes: ['פתיחה ישירה למצלמה', 'חיתוך מהיר אחרי המשפט הראשון', 'להראות proof קצר לפני ה-CTA'],
        pacing: ['0-2 שניות: כאב חד', '2-8 שניות: מנגנון', '8-15 שניות: proof + CTA'],
        sceneIntent: ['לעצור גלילה', 'לשקף כאב', 'להוביל לצעד הבא']
      },
      {
        format: 'founder',
        hook: 'אני לא מוכר עוד סיסמה. אני מסדר את מה ששבור בדרך להחלטה.',
        body: `${positioning.coreAngle}. ${positioning.promise}. זה בנוי סביב ${offer.ctaType} אחד כי ריבוי אפשרויות שובר המרה.`,
        cta,
        shotNotes: ['שוט סמכותי', 'B-roll של תהליך/ממשק/עבודה', 'סיום חד מול מצלמה'],
        pacing: ['0-3 שניות: הצהרה', '3-10 שניות: הבעיה בשוק', '10-18 שניות: הפתרון והצעד הבא'],
        sceneIntent: ['לייצר סמכות', 'לחדד בידול', 'לסגור עם CTA']
      },
      {
        format: 'direct-response',
        hook: audience.corePersona.objectionsByStage?.conversion?.[0] ?? audience.corePersona.objections[1],
        body: `המחסום הוא לא רק מחיר או זמן. המחסום הוא חוסר ודאות. לכן מראים ${positioning.uniqueMechanism}, הוכחה, ואז ${cta}.`,
        cta,
        shotNotes: ['כותרת objection על המסך', 'מעבר למסך הוכחה/דוגמה', 'CTA'],
        pacing: ['0-2 שניות: objection', '2-9 שניות: תשובה', '9-15 שניות: CTA'],
        sceneIntent: ['לשבור התנגדות', 'להוריד חיכוך', 'להעביר להמרה']
      },
      {
        format: 'testimonial',
        hook: 'הבעיה לא הייתה חוסר רצון. הבעיה הייתה מסר שלא נתן בהירות.',
        body: `לפני כן היה ${audience.corePersona.deepPains?.[0] ?? audience.corePersona.pains[0]}. אחרי שנכנס ${positioning.uniqueMechanism}, הצעד הבא נהיה ברור. ניסיון ${attempt}.`,
        cta,
        shotNotes: ['פנים/voice over של עדות', 'B-roll של לפני/אחרי', 'CTA כתוב'],
        pacing: ['0-3 שניות: before', '3-10 שניות: shift', '10-16 שניות: CTA'],
        sceneIntent: ['לייצר אמון', 'להמחיש שינוי', 'ללחוץ על החלטה']
      }
    ]
  };
}
