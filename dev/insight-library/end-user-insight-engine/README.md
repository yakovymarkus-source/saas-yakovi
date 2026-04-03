# End User Insight Engine

Production-ready CommonJS package that translates raw marketing issues into a strict, deterministic, versioned end-user insight bundle.

## Public API

```js
const {
  buildInsights,
  buildExplanation,
  attachInsightsToAnalysis,
  validateInsight,
  validateFinalBundle,
  CONTRACT_VERSION,
} = require('end-user-insight-engine');
```

Local root consumption works the same way:

```js
const {
  buildInsights,
  attachInsightsToAnalysis,
  CONTRACT_VERSION,
} = require('.');
```

## Exact input schema

### `buildInsights(rawIssues, context)`

`rawIssues` accepts an array of issue-like objects. Non-array input is handled safely and returns an empty translated bundle.

Exact supported issue shape:

```js
[
  {
    issue_code: 'low_ctr',
    // alias supported: code
    severity: 'low' | 'medium' | 'high' | 'critical',
    confidence: 0.91,
    priority_rank: 1,
    metrics: {
      ctr: 0.42
    }
  },
  {
    code: 'high_cpa',
    severity: 'medium',
    confidence: 0.73,
    priority_rank: 2,
    metrics: {
      cpa: 180
    }
  }
]
```

Normalization rules:

- invalid issue entries are ignored during normalization
- duplicate normalized issues are removed deterministically
- missing `severity` defaults to `medium`
- missing `confidence` defaults to `0.5`
- missing `priority_rank` defaults to the issue position
- malformed `metrics` is normalized safely and never crashes the pipeline

### Exact `context` schema

```js
{
  user_level: 'beginner' | 'intermediate' | 'advanced',
  display_mode: 'simple' | 'professional',
  business_type: 'generic' | 'services' | 'ecommerce' | 'lead_generation'
}
```

Defaults:

```js
{
  user_level: 'beginner',
  display_mode: 'simple',
  business_type: 'generic'
}
```

## Exact full output bundle

`buildInsights()` returns this exact top-level contract every time:

```js
{
  primary_insight: {
    id: 'high_cpa:critical:1',
    issue_code: 'high_cpa',
    title: 'המערכת מזהה עלות גבוהה מדי לתוצאה',
    explanation: '...'
  } | null,
  primary_insights: [
    {
      id: 'high_cpa:critical:1',
      issue_code: 'high_cpa',
      title: '...'
    }
  ],
  secondary_insights: [
    {
      id: 'low_ctr:high:2',
      issue_code: 'low_ctr',
      title: '...'
    }
  ],
  low_priority_insights: [],
  lower_priority_insights: [],
  all_insights: [
    {
      id: 'high_cpa:critical:1',
      issue_code: 'high_cpa',
      title: '...'
    },
    {
      id: 'low_ctr:high:2',
      issue_code: 'low_ctr',
      title: '...'
    }
  ],
  skipped_insights: [
    {
      issue_code: 'bad_issue',
      reason: 'Insight validation failed: ...'
    }
  ],
  meta: {
    total_input: 3,
    total_normalized: 3,
    total_processed: 2,
    total_skipped: 1,
    user_level: 'beginner',
    display_mode: 'simple',
    business_type: 'lead_generation',
    deterministic_ordering: true,
    contract_version: '1.0.0'
  }
}
```

## Guaranteed fields vs optional fields

### Guaranteed top-level fields

These fields always exist on the final bundle:

- `primary_insight`
- `primary_insights`
- `secondary_insights`
- `low_priority_insights`
- `lower_priority_insights`
- `all_insights`
- `skipped_insights`
- `meta`

### Optional-by-content fields

These are optional by content, not by schema:

- `primary_insight` can be `null` when no valid insight exists
- every insight array can be empty
- `skipped_insights` can be empty when no translation fails

### Guaranteed fields on every translated insight

Every item inside `all_insights`, `primary_insights`, `secondary_insights`, `low_priority_insights`, and `lower_priority_insights` is validated and guaranteed to include:

```js
{
  id: 'low_ctr:high:1',
  issue_code: 'low_ctr',
  title: '...',
  explanation: '...',
  action: '...',
  severity: 'high',
  professional_label: '...',
  simple_label: '...',
  simple_summary: '...',
  business_impact: '...',
  likely_causes: ['...'],
  first_action: '...',
  learn_more: {
    term: 'CTR',
    definition: '...'
  },
  confidence: 0.91,
  priority: 1,
  user_level: 'beginner',
  display_mode: 'simple',
  meta: {
    generated_by: 'insight_engine_v1',
    fallback_mode: 'dictionary' | 'template' | 'safe_fallback',
    business_type: 'lead_generation',
    internal_metrics: {}
  }
}
```

## `contract_version` guarantee

`meta.contract_version` is mandatory and deterministic.

Rules:

- it is always present in the final output bundle
- it is versioned explicitly to prevent silent schema drift
- current contract version is exposed publicly as `CONTRACT_VERSION`
- the validator rejects a final bundle when `meta.contract_version` is missing or does not match the package contract

## Skipped insight behavior

Skipped insights are preserved, not dropped silently.

Rules:

- a broken translated insight does **not** crash the entire pipeline
- failed translations are recorded in `skipped_insights`
- `meta.total_skipped === skipped_insights.length`
- `meta.total_processed === all_insights.length`
- `primary_insight`, when present, always matches `primary_insights[0]`

## Adapter guarantee

### `attachInsightsToAnalysis(analysisResult, context)`

The adapter preserves the original analysis payload and attaches the **full translated bundle with zero data loss** under `translated_insights`.

Explicit guarantee: the adapter preserves the **FULL bundle**. It does not collapse, trim, or silently drop these fields when present:

- `all_insights`
- `primary_insights`
- `secondary_insights`
- `low_priority_insights`
- `lower_priority_insights`
- `primary_insight`
- `skipped_insights`
- `meta`

Exact adapter output shape:

```js
{
  ...analysisResult,
  translated_insights: {
    primary_insight: { ... } | null,
    primary_insights: [{ ... }],
    secondary_insights: [{ ... }],
    low_priority_insights: [{ ... }],
    lower_priority_insights: [{ ... }],
    all_insights: [{ ... }],
    skipped_insights: [{ issue_code: '...', reason: '...' }],
    meta: {
      total_input: 0,
      total_normalized: 0,
      total_processed: 0,
      total_skipped: 0,
      user_level: 'beginner',
      display_mode: 'simple',
      business_type: 'generic',
      deterministic_ordering: true,
      contract_version: '1.0.0'
    }
  }
}
```

## Root usage examples

### CommonJS `require()`

```js
const { attachInsightsToAnalysis, CONTRACT_VERSION } = require('.');

const analysis = {
  account_id: 'acc_1',
  issues: [
    { issue_code: 'low_ctr', severity: 'high', confidence: 0.9, priority_rank: 1 },
    { issue_code: 'high_cpa', severity: 'medium', confidence: 0.7, priority_rank: 2 }
  ]
};

const result = attachInsightsToAnalysis(analysis, {
  user_level: 'beginner',
  display_mode: 'simple',
  business_type: 'lead_generation'
});

console.log(CONTRACT_VERSION);
console.log(result.translated_insights.meta.contract_version);
console.log(result.translated_insights.primary_insight);
```

### ESM-style import from CommonJS package

```js
import pkg from 'end-user-insight-engine';

const { buildInsights, CONTRACT_VERSION } = pkg;
const result = buildInsights([
  { issue_code: 'low_ctr', severity: 'high', confidence: 0.93, priority_rank: 1 }
], {
  user_level: 'beginner',
  display_mode: 'simple',
  business_type: 'generic'
});

console.log(CONTRACT_VERSION);
console.log(result.meta.contract_version);
```

## Validation guarantees

Final bundle validation enforces:

- arrays are real arrays before any `.length`-based checks
- `meta.total_processed === all_insights.length`
- `meta.total_skipped === skipped_insights.length`
- `primary_insight === primary_insights[0]` when both exist
- no `undefined` values in the final bundle
- no `null` leakage inside validated insights or skipped records
- every validated insight includes `id`, `title`, `explanation`, `priority`, and `severity`
- `meta.contract_version` must exist and match the exported package contract version

## Run

```bash
npm test
npm run coverage
```

## Coverage discipline

`npm run coverage` executes real Node test coverage and enforces thresholds.

Current enforced minimums:

- lines: `90%`
- functions: `90%`

If real measured coverage drops below either threshold, the command fails.
