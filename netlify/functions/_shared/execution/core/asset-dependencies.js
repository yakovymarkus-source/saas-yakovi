'use strict';
/**
 * execution/core/asset-dependencies.js
 * Asset Dependency Graph.
 * Defines and validates dependencies between assets.
 * Ensures generation order respects dependencies.
 */

// Dependency graph: key depends on values
const DEPENDENCY_GRAPH = {
  hooks:        [],                                // no dependencies — always first
  cta:          ['hooks'],                         // CTA derived from hooks
  ads:          ['hooks', 'cta'],                  // ads need hooks + CTAs
  scripts:      ['hooks'],                         // scripts need hooks
  landing_page: ['hooks', 'cta'],                  // LP needs hooks + CTAs
  email:        ['hooks', 'cta'],                  // email needs hooks + CTAs
  visual_ads:   ['ads'],                           // visual brief needs text ads
  visual_lp:    ['landing_page'],                  // LP visual needs LP content
  visual_scripts:['scripts'],                      // video brief needs script
};

// Generation order (topological sort result)
const GENERATION_ORDER = [
  'hooks',
  'cta',
  'ads',
  'scripts',
  'landing_page',
  'email',
  'visual_ads',
  'visual_lp',
  'visual_scripts',
];

// What each asset requires from message_core
const MESSAGE_CORE_DEPENDENCIES = {
  ads:          ['headline', 'painLine', 'primaryCta'],
  landing_page: ['headline', 'subheadline', 'painLine', 'primaryCta', 'proofPoints', 'objectionHandlers'],
  email:        ['headline', 'painLine', 'primaryCta'],
  hooks:        ['painLine'],
  scripts:      ['headline', 'painLine', 'primaryCta'],
  cta:          ['primaryCta'],
};

function validateDependencies(requestedAssets, builtAssets) {
  const issues = [];
  const built  = new Set(Object.keys(builtAssets || {}));

  for (const asset of requestedAssets) {
    const deps = DEPENDENCY_GRAPH[asset] || [];
    for (const dep of deps) {
      if (!built.has(dep)) {
        issues.push({
          asset,
          missingDep: dep,
          message:    `נכס "${asset}" תלוי ב-"${dep}" — אבל "${dep}" עדיין לא נוצר`,
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

function sortByDependencies(assetTypes) {
  const requested = new Set(assetTypes || []);
  const ordered   = [];

  // Add dependencies automatically
  for (const asset of [...requested]) {
    const deps = DEPENDENCY_GRAPH[asset] || [];
    for (const dep of deps) {
      if (!requested.has(dep) && !ordered.includes(dep)) {
        // Auto-add implicit dependency (hooks always needed)
        if (dep === 'hooks' || dep === 'cta') {
          ordered.push(dep);
        }
      }
    }
  }

  // Add requested assets in correct order
  for (const asset of GENERATION_ORDER) {
    if (requested.has(asset) && !ordered.includes(asset)) {
      ordered.push(asset);
    }
  }

  return ordered;
}

function checkMessageCoreCoverage(assetTypes, messageCore) {
  const missing = [];

  for (const asset of (assetTypes || [])) {
    const required = MESSAGE_CORE_DEPENDENCIES[asset] || [];
    for (const field of required) {
      if (!messageCore?.[field]) {
        missing.push({ asset, field, message: `נכס "${asset}" דורש "${field}" ב-message_core` });
      }
    }
  }

  return { complete: missing.length === 0, missing };
}

function buildDependencyReport(assetTypes) {
  const report = {};

  for (const asset of (assetTypes || [])) {
    const deps      = DEPENDENCY_GRAPH[asset] || [];
    const mcDeps    = MESSAGE_CORE_DEPENDENCIES[asset] || [];
    report[asset]   = {
      dependsOn:          deps,
      requiresFromCore:   mcDeps,
      generationPriority: GENERATION_ORDER.indexOf(asset),
    };
  }

  return report;
}

module.exports = {
  validateDependencies,
  sortByDependencies,
  checkMessageCoreCoverage,
  buildDependencyReport,
  DEPENDENCY_GRAPH,
  GENERATION_ORDER,
};
