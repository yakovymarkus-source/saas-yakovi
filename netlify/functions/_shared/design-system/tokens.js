'use strict';

/**
 * design-system/tokens.js — Design Tokens
 *
 * Single source of truth for all visual values used by the HTML Composer.
 * Every spacing, color, font, and layout decision traces back here.
 *
 * Rules:
 *   - No HTML here. Pure values only.
 *   - RTL-safe: logical properties where possible (inline-start/end vs left/right)
 *   - All pixel values as numbers — the composer adds units
 *   - Hebrew-safe font stacks only
 */

// ── Spacing ───────────────────────────────────────────────────────────────────
// 4px base unit. Names match usage semantics, not just size.

const SPACING = Object.freeze({
  0:    0,
  px:   1,
  0.5:  2,
  1:    4,
  1.5:  6,
  2:    8,
  2.5:  10,
  3:    12,
  4:    16,
  5:    20,
  6:    24,
  7:    28,
  8:    32,
  10:   40,
  12:   48,
  14:   56,
  16:   64,
  20:   80,
  24:   96,
  28:   112,
  32:   128,

  // Semantic aliases — used by components
  section_y:     80,   // vertical padding for full sections
  section_y_sm:  48,   // compact sections
  container_x:   24,   // horizontal page padding (mobile)
  container_x_md: 48,  // horizontal page padding (tablet+)
  gap_cards:     24,   // gap between card elements
  gap_stack:     16,   // gap between stacked elements
});

// ── Typography ────────────────────────────────────────────────────────────────
// rem-based. 1rem = 16px baseline.
// Hebrew fonts: Rubik, Heebo, Assistant, David Libre — all Google-hosted, RTL-safe.

const TYPOGRAPHY = Object.freeze({
  fontFamily: {
    // Primary display — headlines, CTAs. Rubik is the cleanest Hebrew display font.
    display: '"Rubik", "Heebo", "Arial Hebrew", Arial, sans-serif',
    // Body text — readable at small sizes. Heebo lighter weights work well.
    body:    '"Heebo", "Rubik", "Arial Hebrew", Arial, sans-serif',
    // Numbers, stats, data — neutral, not Hebrew-weighted
    mono:    '"IBM Plex Mono", "Courier New", monospace',
  },

  fontSize: {
    xs:   '0.75rem',    // 12px — captions, fine print
    sm:   '0.875rem',   // 14px — labels, meta
    base: '1rem',       // 16px — body text baseline
    lg:   '1.125rem',   // 18px — large body, intro text
    xl:   '1.25rem',    // 20px — subheadings
    '2xl': '1.5rem',    // 24px — section headings
    '3xl': '1.875rem',  // 30px — large headings
    '4xl': '2.25rem',   // 36px — page-level headings
    '5xl': '3rem',      // 48px — hero headlines
    '6xl': '3.75rem',   // 60px — display/impact headlines
    '7xl': '4.5rem',    // 72px — max display size
  },

  fontWeight: {
    light:    300,
    regular:  400,
    medium:   500,
    semibold: 600,
    bold:     700,
    extrabold: 800,
    black:    900,
  },

  lineHeight: {
    tight:   1.15,   // headlines — Hebrew needs slightly tighter
    snug:    1.3,
    normal:  1.5,    // body text
    relaxed: 1.6,    // long-form reading
    loose:   1.8,
  },

  letterSpacing: {
    tight:  '-0.02em',
    normal: '0',
    wide:   '0.04em',
    wider:  '0.08em',
  },
});

// ── Colors ────────────────────────────────────────────────────────────────────
// Semantic + palette. Palette is neutral; semantic tokens apply meaning.
// Composers use semantic tokens — never raw palette directly.

const COLORS = Object.freeze({

  // ── Semantic tokens ────────────────────────────────────────────────────────
  semantic: {
    // Primary action — CTA buttons, key links, highlights
    primary:          '#1a56db',
    primary_hover:    '#1e429f',
    primary_light:    '#ebf5ff',
    primary_contrast: '#ffffff',   // text on primary bg

    // Accent — urgency, alerts, strong emphasis
    accent:           '#e3342f',
    accent_hover:     '#cc1f1a',
    accent_light:     '#fff5f5',
    accent_contrast:  '#ffffff',

    // Success — positive outcomes, checkmarks, proof
    success:          '#0e9f6e',
    success_light:    '#f3faf7',
    success_contrast: '#ffffff',

    // Warning — urgency without alarm
    warning:          '#c27803',
    warning_light:    '#fdf6b2',
    warning_contrast: '#1f2937',

    // Neutral text hierarchy
    text_primary:    '#111827',   // body text, headlines
    text_secondary:  '#6b7280',   // subtext, meta
    text_muted:      '#9ca3af',   // captions, disabled
    text_inverse:    '#ffffff',   // text on dark bg

    // Backgrounds
    bg_base:         '#ffffff',
    bg_subtle:       '#f9fafb',   // section alternation
    bg_muted:        '#f3f4f6',   // cards, inputs
    bg_dark:         '#111827',   // dark sections
    bg_dark_subtle:  '#1f2937',

    // Borders
    border_default:  '#e5e7eb',
    border_strong:   '#d1d5db',
    border_focus:    '#1a56db',
  },

  // ── Raw palette (reference only — use semantic tokens) ────────────────────
  gray: {
    50:  '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },

  blue: {
    50:  '#ebf5ff',
    100: '#e1effe',
    400: '#76a9fa',
    500: '#3f83f8',
    600: '#1c64f2',
    700: '#1a56db',
    800: '#1e429f',
    900: '#233876',
  },

  red: {
    50:  '#fff5f5',
    400: '#f98080',
    500: '#f05252',
    600: '#e02424',
    700: '#c81e1e',
  },

  green: {
    50:  '#f3faf7',
    400: '#31c48d',
    500: '#0e9f6e',
    600: '#057a55',
  },
});

// ── Border Radius ─────────────────────────────────────────────────────────────

const BORDER_RADIUS = Object.freeze({
  none:  '0',
  sm:    '0.25rem',    // 4px
  base:  '0.375rem',   // 6px
  md:    '0.5rem',     // 8px
  lg:    '0.75rem',    // 12px
  xl:    '1rem',       // 16px
  '2xl': '1.5rem',     // 24px
  '3xl': '2rem',       // 32px
  full:  '9999px',     // pill / circle
});

// ── Shadows ───────────────────────────────────────────────────────────────────

const SHADOWS = Object.freeze({
  none:  'none',
  sm:    '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  base:  '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
  md:    '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
  lg:    '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
  xl:    '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
});

// ── Breakpoints ───────────────────────────────────────────────────────────────
// Mobile-first. All values are min-width thresholds in px.

const BREAKPOINTS = Object.freeze({
  xs:  320,    // small phones
  sm:  480,    // phones landscape / large phones
  md:  768,    // tablets
  lg:  1024,   // small desktops / landscape tablet
  xl:  1280,   // desktops
  '2xl': 1440, // large desktops
});

// ── Container Widths ──────────────────────────────────────────────────────────

const CONTAINERS = Object.freeze({
  narrow:  '640px',    // focused content: lead forms, single CTAs
  base:    '768px',    // standard content width
  wide:    '1024px',   // marketing pages
  full:    '1280px',   // max-width marketing layout
  flush:   '100%',     // edge-to-edge
});

// ── Button Styles ─────────────────────────────────────────────────────────────
// Schema for button rendering. Composers use these to produce consistent buttons.

const BUTTONS = Object.freeze({
  variants: {
    primary: {
      bg:           'semantic.primary',
      bg_hover:     'semantic.primary_hover',
      text:         'semantic.primary_contrast',
      border:       'transparent',
      shadow:       'md',
    },
    secondary: {
      bg:           'transparent',
      bg_hover:     'semantic.primary_light',
      text:         'semantic.primary',
      border:       'semantic.primary',
      shadow:       'none',
    },
    danger: {
      bg:           'semantic.accent',
      bg_hover:     'semantic.accent_hover',
      text:         'semantic.accent_contrast',
      border:       'transparent',
      shadow:       'md',
    },
    ghost: {
      bg:           'transparent',
      bg_hover:     'semantic.bg_muted',
      text:         'semantic.text_primary',
      border:       'semantic.border_default',
      shadow:       'none',
    },
    dark: {
      bg:           'colors.gray.900',
      bg_hover:     'colors.gray.800',
      text:         'semantic.text_inverse',
      border:       'transparent',
      shadow:       'md',
    },
  },

  sizes: {
    sm:   { fontSize: 'sm',   paddingY: '8px',  paddingX: '16px', radius: 'md'  },
    base: { fontSize: 'base', paddingY: '12px', paddingX: '24px', radius: 'md'  },
    lg:   { fontSize: 'lg',   paddingY: '14px', paddingX: '32px', radius: 'lg'  },
    xl:   { fontSize: 'xl',   paddingY: '16px', paddingX: '40px', radius: 'lg'  },
    full: { fontSize: 'lg',   paddingY: '16px', paddingX: '24px', radius: 'lg', width: '100%' },
  },
});

// ── RTL Configuration ─────────────────────────────────────────────────────────
// All HTML templates assume RTL by default (Hebrew market).
// Explicit overrides available for mixed layouts.

const RTL = Object.freeze({
  // Document-level
  dir:        'rtl',
  lang:       'he',

  // Logical property mappings — use these instead of left/right
  // so LTR override works without rewriting CSS
  inlineStart: 'right',   // in RTL: "start" = right side
  inlineEnd:   'left',    // in RTL: "end" = left side
  textAlign:   'right',

  // Font rendering — Hebrew text needs slightly different hinting
  fontSmoothing:   'antialiased',
  textRendering:   'optimizeLegibility',

  // Hebrew-safe line height adjustment (Hebrew ascenders/descenders differ from Latin)
  hebrewLineHeightAdjust: 1.1,   // multiply base lineHeight by this for Hebrew headlines

  // Google Fonts — preconnect + Hebrew subset
  googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700;800;900&family=Heebo:wght@300;400;500;600;700;800;900&display=swap&subset=hebrew',
});

// ── Z-index Scale ─────────────────────────────────────────────────────────────

const Z_INDEX = Object.freeze({
  below:   -1,
  base:     0,
  raised:   10,
  dropdown: 100,
  sticky:   200,
  overlay:  300,
  modal:    400,
  toast:    500,
});

// ── Animation ─────────────────────────────────────────────────────────────────
// Minimal — marketing pages should not over-animate.

const ANIMATION = Object.freeze({
  duration: {
    fast:   '150ms',
    base:   '200ms',
    slow:   '300ms',
    slower: '500ms',
  },
  easing: {
    ease:     'ease',
    in:       'ease-in',
    out:      'ease-out',
    in_out:   'ease-in-out',
    bounce:   'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
});

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  SPACING,
  TYPOGRAPHY,
  COLORS,
  BORDER_RADIUS,
  SHADOWS,
  BREAKPOINTS,
  CONTAINERS,
  BUTTONS,
  RTL,
  Z_INDEX,
  ANIMATION,
};
