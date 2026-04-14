'use strict';

/**
 * exporters/html-exporter.js — HTML Export Packager
 *
 * Converts the output of composeHTML() into a structured, file-ready
 * ExportPackage: a flat list of { path, content, encoding } entries
 * that represent a complete downloadable asset folder.
 *
 * This module produces NO ZIP and writes NO files to disk.
 * It only prepares the file list that zip-exporter.js will bundle.
 *
 * Pipeline position:
 *   composeHTML(blueprint)              → ComposeResult
 *       → exportHTML(composeResult)     → ExportPackage
 *           → exportZIP(exportPackage)  → { buffer, base64, filename }
 *
 * Output structure:
 *   index.html      — the HTML page (with externalized <link> to styles.css)
 *   styles.css      — extracted CSS (from the embedded <style> block)
 *   assets/         — placeholder directory for images
 *   assets/README.txt — instructions for replacing image slots
 *   manifest.json   — metadata: type, template, sections, warnings, slots
 *
 * Supports: landing_page_html, banner_html, ad_html, section_html
 */

// ── Regex: extract embedded <style> block ────────────────────────────────────
// Matches the FIRST <style> block — composer always emits exactly one.
const STYLE_BLOCK_RE = /<style>([\s\S]*?)<\/style>/i;

// ── Regex: count image slot placeholders ─────────────────────────────────────
// Counts <div class="img-slot"> elements to report how many images are needed.
const IMG_SLOT_RE = /class="[^"]*img-slot[^"]*"/g;

// ── Regex: detect Netlify forms ───────────────────────────────────────────────
const NETLIFY_FORM_RE = /data-netlify="true"/;

// ─────────────────────────────────────────────────────────────────────────────
// separateStyles — extract CSS and replace with <link> tag
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts the inline <style> block from the HTML, replaces it with a
 * <link rel="stylesheet" href="styles.css"> tag, and returns both parts.
 *
 * If no <style> block is found, html is returned unchanged and css is ''.
 *
 * @param {string} html
 * @returns {{ html: string, css: string }}
 */
function separateStyles(html) {
  const match = STYLE_BLOCK_RE.exec(html);
  if (!match) return { html, css: '' };

  const css     = match[1].trim();
  const linkTag = '<link rel="stylesheet" href="styles.css">';
  const cleanHtml = html.replace(STYLE_BLOCK_RE, linkTag);
  return { html: cleanHtml, css };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildManifest — generate manifest.json content
// ─────────────────────────────────────────────────────────────────────────────

function buildManifest(composeResult, packageFiles, imageSlots, netlifyForms) {
  return {
    schema_version:   '1.0',
    type:             composeResult.type             || 'landing_page_html',
    template_id:      composeResult.template_id      || null,
    created_at:       new Date().toISOString(),
    files:            packageFiles.map((f) => f.path),
    meta: {
      sections_rendered: composeResult.sections_rendered || null,
      warnings:          composeResult.warnings          || [],
      rtl:               true,
      lang:              'he',
      image_slots:       imageSlots,
      netlify_forms:     netlifyForms,
      // Size hints — approximate, useful for progress reporting
      size_hint_kb:      null,   // populated by zip-exporter after compression
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSET README — explains image slot placeholders
// ─────────────────────────────────────────────────────────────────────────────

const ASSETS_README = `
ASSETS DIRECTORY
════════════════

This directory holds visual assets for the landing page.

Image placeholders in index.html have data-image-prompt attributes that
describe the intended image for each slot. Replace each placeholder element
with a real <img> tag pointing to a file in this directory.

HOW TO REPLACE AN IMAGE SLOT
─────────────────────────────
Find in index.html:
  <div class="img-slot ..." role="img" aria-label="תמונה ראשית"
       data-image-prompt="Marketing scene showing...">

Replace with:
  <img src="assets/hero.jpg" alt="תמונה ראשית" class="hero-img" loading="lazy">

RECOMMENDED FORMATS
───────────────────
  Hero images:      1200×800px  WebP or JPEG
  Ad card images:   1080×1080px WebP (1:1) / 1080×1350px (4:5)
  Banner images:    match banner dimensions exactly
  Proof/result:     800×600px   WebP or PNG

NETLIFY DEPLOYMENT
──────────────────
Upload this entire folder as a Netlify site (drag-and-drop or CLI).
Netlify will automatically handle the form submissions if data-netlify="true"
is present on any <form> element.
`.trim();

// ─────────────────────────────────────────────────────────────────────────────
// exportHTML — main function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} composeResult — output of composeHTML():
 *   { html, type, template_id?, sections_rendered?, warnings? }
 *   For banner/ad: add { size_id?, format_id?, width?, height? }
 * @param {object} options
 *   filename      {string}  — base filename without extension (default: derived from type)
 *   separate_css  {boolean} — extract CSS to styles.css (default: true)
 *   include_assets_readme {boolean} — include assets/README.txt (default: true)
 * @returns {ExportPackage}
 */
function exportHTML(composeResult, options = {}) {
  if (!composeResult || typeof composeResult.html !== 'string') {
    throw new Error('exportHTML: composeResult.html must be a string');
  }

  const {
    filename:        filenameOpt     = null,
    separate_css:    separateCss     = true,
    include_assets_readme: includeReadme = true,
  } = options;

  const type       = composeResult.type       || 'landing_page_html';
  const templateId = composeResult.template_id || null;
  const warnings   = composeResult.warnings   || [];

  // ── Derive suggested filename from type ───────────────────────────────────
  const baseFilename = filenameOpt || _deriveFilename(type, composeResult);

  // ── Separate CSS from HTML ────────────────────────────────────────────────
  let htmlContent = composeResult.html;
  let cssContent  = '';

  if (separateCss) {
    const separated = separateStyles(composeResult.html);
    htmlContent = separated.html;
    cssContent  = separated.css;
  }

  // ── Count image slots and Netlify forms ───────────────────────────────────
  const imageSlots   = (composeResult.html.match(IMG_SLOT_RE)  || []).length;
  const netlifyForms = NETLIFY_FORM_RE.test(composeResult.html);

  // ── Build file list ───────────────────────────────────────────────────────
  const files = [];

  // index.html — always first
  files.push({
    path:     'index.html',
    content:  htmlContent,
    encoding: 'utf8',
    mime:     'text/html; charset=utf-8',
  });

  // styles.css — only when CSS was separated (not for banners/ad cards with fixed CSS)
  if (separateCss && cssContent) {
    files.push({
      path:     'styles.css',
      content:  cssContent,
      encoding: 'utf8',
      mime:     'text/css; charset=utf-8',
    });
  }

  // assets/README.txt — explains image slot replacement
  if (includeReadme) {
    files.push({
      path:     'assets/README.txt',
      content:  ASSETS_README,
      encoding: 'utf8',
      mime:     'text/plain; charset=utf-8',
    });
  }

  // assets/.keep — ensures the assets/ directory exists in the ZIP
  files.push({
    path:     'assets/.keep',
    content:  '',
    encoding: 'utf8',
    mime:     'text/plain',
  });

  // manifest.json — always last
  const manifest = buildManifest(composeResult, files, imageSlots, netlifyForms);
  files.push({
    path:     'manifest.json',
    content:  JSON.stringify(manifest, null, 2),
    encoding: 'utf8',
    mime:     'application/json; charset=utf-8',
  });

  return {
    files,
    filename:         baseFilename,
    type,
    template_id:      templateId,
    sections_rendered: composeResult.sections_rendered || null,
    image_slots:      imageSlots,
    netlify_forms:    netlifyForms,
    warnings,
    created_at:       manifest.created_at,
    // Banner / ad card extras
    ...(composeResult.width  ? { width:  composeResult.width  } : {}),
    ...(composeResult.height ? { height: composeResult.height } : {}),
    ...(composeResult.size_id   ? { size_id:   composeResult.size_id   } : {}),
    ...(composeResult.format_id ? { format_id: composeResult.format_id } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// exportMultiple — batch export several ComposeResults into one package
// Useful when exporting all banner sizes or all ad formats at once.
// Each HTML file is stored as assets/{id}/index.html.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {object[]} composeResults — array of ComposeResult objects, each with an id field
 * @param {object}   options
 *   filename {string} — base filename for the ZIP (default: 'export-package')
 * @returns {ExportPackage}  — files[] contains all assets in sub-directories
 */
function exportMultiple(composeResults, options = {}) {
  if (!Array.isArray(composeResults) || composeResults.length === 0) {
    throw new Error('exportMultiple: composeResults must be a non-empty array');
  }

  const baseFilename = options.filename || 'export-package';
  const allFiles     = [];
  const manifests    = [];
  let totalWarnings  = [];

  for (const result of composeResults) {
    const id        = result.id || result.size_id || result.format_id || result.type || 'asset';
    const pkg       = exportHTML(result, { separate_css: false, include_assets_readme: false });
    totalWarnings   = totalWarnings.concat(pkg.warnings || []);

    // Prefix all file paths with the asset id sub-directory
    for (const file of pkg.files) {
      if (file.path === 'manifest.json') continue; // single manifest at root
      allFiles.push({
        ...file,
        path: `${id}/${file.path}`,
      });
    }
    manifests.push({ id, type: result.type, filename: `${id}/index.html` });
  }

  // Root manifest
  const rootManifest = {
    schema_version: '1.0',
    type:           'multi-asset',
    created_at:     new Date().toISOString(),
    assets:         manifests,
    total_files:    allFiles.length + 1,
    warnings:       totalWarnings,
  };

  allFiles.push({
    path:     'manifest.json',
    content:  JSON.stringify(rootManifest, null, 2),
    encoding: 'utf8',
    mime:     'application/json; charset=utf-8',
  });

  return {
    files:    allFiles,
    filename: baseFilename,
    type:     'multi-asset',
    warnings: totalWarnings,
    created_at: rootManifest.created_at,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _deriveFilename(type, result) {
  if (type === 'banner_html')   return `banner-${result.size_id   || 'rectangle'}`;
  if (type === 'ad_html')       return `ad-card-${result.format_id || 'square'}`;
  if (type === 'section_html')  return `section-${result.component_type || 'block'}`;
  // landing_page_html — use template_id if available
  if (result.template_id) return result.template_id;
  return 'landing-page';
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = { exportHTML, exportMultiple, separateStyles };
