# GRAPH_REPORT — CampaignBrain SaaS

**תאריך:** 2026-04-14  
**commit:** `a8d73bfe`  
**confidence:** `high`  
**סוג ריצה:** Full Build (ראשוני)

---

## מה המערכת

SaaS לניתוח קמפיינים פרסומיים (CampaignBrain).  
Stack: Netlify Functions (Node.js CommonJS) + Supabase + Frontend סטטי.

---

## מבנה כללי

```
סאס 6/
├── netlify/functions/          ← Backend (serverless)
│   ├── *.js                    ← 43 endpoints
│   └── _shared/                ← כל הלוגיקה המשותפת
│       ├── [core infrastructure]
│       ├── [business domain]
│       ├── [AI analysis engine]
│       ├── providers/          ← AI providers (Claude/OpenAI/nano-banana)
│       ├── prompt-builders/    ← בוני פרומפטים
│       ├── design-system/      ← עיצוב לדפי נחיתה
│       ├── validators/         ← ולידציה של HTML/תוכן
│       ├── exporters/          ← ייצוא HTML/ZIP
│       ├── integrations/       ← GA4, Google Ads, Meta
│       ├── payments/           ← Stripe + Grow
│       └── authz/              ← הרשאות
├── public/                     ← Frontend סטטי
│   ├── index.html + assets/    ← אפליקציית משתמש
│   └── admin/                  ← פאנל אדמין
├── tests/                      ← unit + integration
└── scripts/                    ← inject-env, smoke-run
```

---

## קבוצות פונקציות (endpoints)

| קבוצה | פונקציות | תלויות מפתח |
|---|---|---|
| **Auth/Account** | account-profile, account-delete, supabase-auth-email | auth, account |
| **Admin** | admin-overview/system/billing/user/users/audit/assets/support/updates | admin-auth, admin-metrics |
| **Billing** | billing-checkout/webhook/portal, payment-pending, activate-payment | payments, email |
| **OAuth/Integrations** | oauth-nonce, oauth-callback-google/meta, integration-connect | token-manager |
| **Ads Sync** | get-ads-data, sync-performance, enqueue/process/trigger-sync, meta-event | integrations, persistence |
| **Campaigner AI** | campaigner-chat, create-campaign, get-economics | orchestrator + כל ה-AI engine |
| **Assets** | serve-asset, asset-feedback, asset-metrics, admin-assets | asset-storage, feedback-loop |
| **Leads** | get/submit/update/delete/export-leads | leads-service |
| **Content** | get-updates, submit-ticket | supabase |
| **GDPR** | gdpr-export | auth, supabase |

---

## המודולים הכי קריטיים (universal deps)

כל פונקציה כמעט תלויה בהם — אם משנים, משפיע על הכל:

- **`_shared/http.js`** — ok / fail / options / respond
- **`_shared/errors.js`** — AppError
- **`_shared/observability.js`** — createRequestContext, buildLogPayload
- **`_shared/supabase.js`** — writeRequestLog, getAdminClient

---

## ה-AI Pipeline (הלב של המערכת)

```
campaigner-chat.js
    └── orchestrator.js
            └── providers/router.js
                    └── providers/registry.js
                            ├── adapters/claude.js
                            ├── adapters/openai.js
                            └── adapters/nano-banana.js
```

**Prompt Builders** (מוזנים ל-orchestrator):
- ad-copy, ad-creative, analysis, issue-explanation, landing-page, iteration-advice

**AI Context Modules** (מוזנים ל-campaigner-chat):
- user-intelligence, learning-engine, business-profile, beginner-mode
- marketing-memory, creative-context-pack, iteration-engine

**Asset Generation Pipeline:**
```
campaigner-chat
    → landing-structure-engine
        → html-blueprint-builder (design-system/*)
            → html-composer (section-content-generator)
                → validators (anti-generic, html, visual)
                    → asset-storage (שמירה ב-Supabase)
```

---

## Payment Flow

```
billing-checkout → payments/index → payments/providers/[stripe|grow]
                                            ↓
                                    billing-webhook
                                            ↓
                                    activate-payment → email (sendActivationEmail)
```

---

## OAuth / Sync Flow

```
oauth-nonce → oauth-callback-[google|meta] → token-manager (supabase)
                                                    ↓
trigger-pending-jobs → enqueue-sync-job → process-sync-job
                                                → integrations/[ga4|google-ads|meta]
```

---

## חלוקת Auth

| סוג | מודול | שימוש |
|---|---|---|
| User JWT | `auth.js → requireAuth` | כל פונקציות המשתמש |
| Admin | `admin-auth.js → requireAdmin` | כל פונקציות admin-* |

---

## מה לא נסרק

- לוגיקה פנימית של הקבצים (רק imports)
- Dynamic `require()` בתוך גוף פונקציות (מסומן ב-graph.json כ-"runtime-only")
- Frontend internals (app.js לא נקרא בפירוט)

---

## כיצד להשתמש בקובץ זה

1. **קרא את הטבלה לפי הקבוצה הרלוונטית**
2. **זהה את ה-shared deps הנדרשים**
3. **פתח רק את הקבצים הספציפיים** — לא את כל התיקייה
4. **בדוק `graph.meta.json`** — אם confidence נמוך, אל תסמוך על הגרף
