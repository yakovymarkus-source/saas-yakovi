# CHANGE_SUMMARY

## ריצה נוכחית

**תאריך:** 2026-04-14T16:02:07+03:00  
**commit:** `a8d73bfe2d7ec98fb463ec16819c0eb8a2860e95`  
**סוג:** Full Build — ראשוני (אין ריצה קודמת)  
**confidence:** high

---

## שינויים שזוהו (מה ה-git status הראה)

### קבצים מעודכנים (Modified):
- `netlify/functions/_shared/email.js`
- `netlify/functions/_shared/orchestrator.js`
- `netlify/functions/_shared/providers/adapters/claude.js`
- `netlify/functions/_shared/providers/config.js`
- `netlify/functions/_shared/providers/contract.js`
- `netlify/functions/admin-users.js`
- `netlify/functions/business-profile.js`
- `netlify/functions/campaigner-chat.js`
- `public/admin/app.css`
- `public/admin/app.js`
- `public/admin/index.html`
- `public/assets/app.css`
- `public/assets/app.js`
- `public/index.html`
- `scripts/inject-env.js`

### קבצים חדשים (Untracked — לא היו בגרסה קודמת):
- `netlify/functions/_shared/asset-storage.js`
- `netlify/functions/_shared/creative-context-pack.js`
- `netlify/functions/_shared/design-system/` (תיקייה חדשה)
- `netlify/functions/_shared/exporters/` (תיקייה חדשה)
- `netlify/functions/_shared/feedback-loop.js`
- `netlify/functions/_shared/html-blueprint-builder.js`
- `netlify/functions/_shared/html-composer.js`
- `netlify/functions/_shared/iteration-engine.js`
- `netlify/functions/_shared/landing-structure-engine.js`
- `netlify/functions/_shared/leads-service.js`
- `netlify/functions/_shared/marketing-memory.js`
- `netlify/functions/_shared/product-context.js`
- `netlify/functions/_shared/section-content-generator.js`
- `netlify/functions/_shared/validators/` (תיקייה חדשה)

---

## השפעה על המבנה

| שינוי | רמת השפעה |
|---|---|
| מודולים חדשים ב-_shared (asset generation pipeline) | **גבוהה** — הוסף pipeline שלם |
| שינוי ב-orchestrator, providers (claude, config, contract) | **גבוהה** — ליבת ה-AI pipeline |
| שינוי ב-email.js | **בינונית** — משפיע על billing-webhook, activate-payment |
| שינוי ב-campaigner-chat.js | **גבוהה** — הפונקציה המרכזית |
| שינוי ב-business-profile.js (function) | **בינונית** |
| שינוי ב-admin-users.js | **נמוכה** |
| שינוי ב-frontend (public/) | **ללא השפעה על backend** |

---

## הערות

- זוהי ריצת Full Build ראשונה — אין Diff לגרף קודם
- בריצות הבאות: להריץ Partial Update על האזור שהשתנה בלבד
- הקבצים החדשים (untracked) עדיין לא ב-git — לבדוק אם צריך commit

---

*הגרף הבא יתעדכן רק כאשר יהיה שינוי מבני (ראה חוקי Graphify)*
