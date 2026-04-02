# Campaign OS Extension

This package extends the existing `campaign-brain-saas` codebase with a deterministic Campaign Operating System layer.

## Added flow
- `POST /api/campaigns/:id/build`
- `POST /api/campaigns/:id/assets/landing-page`
- `POST /api/campaigns/:id/assets/ads`
- `POST /api/campaigns/:id/assets/video-scripts`
- `POST /api/campaigns/:id/optimize`

## New modules
- `src/agent/*` campaign orchestrator + sub-agents
- `src/engine/campaignRulesEngine.ts`
- `src/engine/explainLikeHuman.ts`
- `src/engine/verdictEngine.ts`
- `src/engine/promptComposer.ts`
- `src/engine/schemaValidator.ts`
- `src/domain/*`
- `src/repositories/*`
- `src/services/campaignBuildService.ts`
- `src/routes/*`

## DB migrations
Apply the updated `db/schema.sql` before using the new endpoints.

## Example request body for build/assets
```json
{
  "business": {
    "businessName": "Acme Growth",
    "category": "SaaS",
    "productType": "service",
    "offer": "Done-for-you growth engine",
    "pricing": { "currency": "USD", "amount": 2500, "model": "monthly" },
    "targetOutcome": "more qualified demos",
    "audienceHint": "B2B founders with weak pipeline quality",
    "currentAssets": {},
    "constraints": ["No fake urgency", "No exaggerated claims"],
    "budget": { "monthly": 5000, "testBudget": 1200 },
    "goals": { "primary": "appointments", "cpaTarget": 80 }
  }
}
```

## Example optimize body
```json
{
  "ctr": 0.7,
  "cpc": 2.4,
  "cpa": 120,
  "bounceRate": 78,
  "roas": 0.9
}
```
