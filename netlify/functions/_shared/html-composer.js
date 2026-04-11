'use strict';

/**
 * html-composer.js — HTML Composer
 *
 * The final rendering layer. Converts an HTMLBlueprint into complete, valid HTML.
 *
 * Entry point:  composeHTML(blueprint)
 * Returns:      { html, type, template_id, sections_rendered, warnings }
 *
 * Pipeline position:
 *   HTMLBlueprint (from html-blueprint-builder)
 *       → composeHTML()
 *           → renderComponent() per section
 *               → section-specific renderer
 *       → buildPageCSS()
 *       → buildHTMLDocument()
 *   → { html: '<!DOCTYPE html>...', ... }
 *
 * Rules:
 *   - HTML is ONLY generated here — no other file emits markup
 *   - Every value rendered came from blueprint.components[n].props
 *   - Missing required props → visible content placeholder, never broken HTML
 *   - All output is RTL-first (dir="rtl", text-align: right, logical CSS properties)
 *   - CSS is embedded in <style> — single self-contained file, Netlify-ready
 *   - Forms get data-netlify="true" for Netlify form handling
 *   - Image slots render placeholder <div> with data-image-prompt for later injection
 */

// ── Escape helpers ────────────────────────────────────────────────────────────

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);
}

// Escape for HTML attribute values (double-quote safe)
function escAttr(s) {
  if (s == null) return '';
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Safe string or null
const str = (v) => (typeof v === 'string' && v.trim().length > 0) ? v.trim() : null;

// Safe array or null
const arr = (v) => (Array.isArray(v) && v.length > 0) ? v : null;

// Render a visible placeholder for missing content — never hides a gap
function contentPlaceholder(fieldLabel) {
  return `<span class="cp" data-field="${escAttr(fieldLabel)}">[${esc(fieldLabel)}]</span>`;
}

// Image slot placeholder — styled block, carries data-image-prompt for later injection
function imgSlot(altText, prompt, extraClass = '') {
  const alt  = escAttr(str(altText) || 'תמונה');
  const hint = prompt ? ` data-image-prompt="${escAttr(prompt)}"` : '';
  const cls  = ['img-slot', extraClass].filter(Boolean).join(' ');
  return `<div class="${cls}" role="img" aria-label="${alt}"${hint}><span class="img-slot__icon">📷</span><span class="img-slot__label">${esc(str(altText) || 'תמונה')}</span></div>`;
}

// Render a button. Returns empty string if no text.
function btn(text, href, variant = 'primary', size = 'xl', extraClass = '') {
  const t = str(text);
  if (!t) return '';
  const h   = escAttr(str(href) || '#');
  const cls = ['btn', `btn-${variant}`, `btn-${size}`, extraClass].filter(Boolean).join(' ');
  return `<a href="${h}" class="${cls}">${esc(t)}</a>`;
}

// Wrap in a section element with correct background class + data-component attribute
function sectionWrap(id, bgToken, mobileVisible, content) {
  const vis = mobileVisible === false ? ' hidden-mobile' : '';
  return `<section class="section bg-${esc(bgToken || 'default')}${vis}" data-component="${esc(id)}">\n${content}\n</section>`;
}

// Container div based on width intent
function container(widthIntent, content) {
  const cls = widthIntent === 'full'   ? 'con-flush'
            : widthIntent === 'narrow' ? 'con-narrow'
            : 'con';
  return `<div class="${cls}">\n${content}\n</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component Renderers
// Each returns an HTML string. They are pure: same input → same output.
// ─────────────────────────────────────────────────────────────────────────────

// ── HERO ─────────────────────────────────────────────────────────────────────
function renderHero(props, layout, options = {}) {
  const variant   = layout.variant || 'centered';
  const isSplit   = variant.startsWith('split');
  const hasForm   = layout.form_above_fold && options.inlineFormProps;
  const minH      = escAttr(layout.min_height || '70vh');
  const darkText  = layout.background === 'dark' ? ' text-inverse' : '';

  const badge      = str(props.badge_text)    ? `<div class="hero-badge">${esc(props.badge_text)}</div>` : '';
  const headline   = `<h1 class="hero-h1">${str(props.headline) ? esc(props.headline) : contentPlaceholder('כותרת ראשית')}</h1>`;
  const sub        = str(props.subheadline)   ? `<p class="hero-sub">${esc(props.subheadline)}</p>` : '';
  const trust      = str(props.trust_line)    ? `<p class="hero-trust">✓ ${esc(props.trust_line)}</p>` : '';
  const ctaBtn     = btn(props.cta_text || 'התחל עכשיו', props.cta_href || '#lead-form', layout.cta_variant || 'primary', layout.cta_size || 'xl');
  const secCta     = str(props.secondary_cta_text) ? `<span class="hero-sec-cta"><a href="${escAttr(props.secondary_cta_href || '#')}">${esc(props.secondary_cta_text)}</a></span>` : '';

  const contentBlock = `<div class="hero-content${darkText}">
  ${badge}
  ${headline}
  ${sub}
  ${trust}
  <div class="hero-ctas">${ctaBtn}${secCta}</div>
</div>`;

  let imageBlock = '';
  if (isSplit && !hasForm) {
    imageBlock = `<div class="hero-visual">${imgSlot(props.image_alt || 'תמונה ראשית', props._image_prompt, 'hero-img')}</div>`;
  }
  if (hasForm) {
    imageBlock = `<div class="hero-visual hero-form-panel">${renderLeadForm(options.inlineFormProps, { cta_variant: 'primary', cta_size: 'xl', background: 'default' })}</div>`;
  }

  const inner = isSplit || hasForm
    ? `<div class="hero-split">${contentBlock}${imageBlock}</div>`
    : `<div class="hero-center">${contentBlock}</div>`;

  return sectionWrap('hero', layout.background, layout.mobile_visible,
    `<div class="hero-wrap" style="min-height:${minH}">${container(layout.width_intent, inner)}</div>`
  );
}

// ── BANNER STRIP ──────────────────────────────────────────────────────────────
function renderBannerStrip(props, layout) {
  const text    = str(props.text)     || contentPlaceholder('טקסט באנר');
  const ctaBtn  = btn(props.cta_text, props.cta_href || '#lead-form', 'secondary', 'sm');

  return `<div class="banner-strip bg-primary" data-component="banner_strip">
  <div class="con">
    <div class="banner-inner">
      <span class="banner-text">${esc(str(props.text) || '')}${!str(props.text) ? contentPlaceholder('טקסט באנר') : ''}</span>
      ${ctaBtn}
    </div>
  </div>
</div>`;
}

// ── STATS ROW ─────────────────────────────────────────────────────────────────
function renderStatsRow(props, layout) {
  const stats = arr(props.stats);

  const items = stats
    ? stats.map((s) => `<div class="stat-item">
  <span class="stat-num">${esc(str(s.number) || '—')}</span>
  <span class="stat-label">${esc(str(s.label) || '')}</span>
</div>`).join('\n')
    : `<div class="stat-item">${contentPlaceholder('נתוני ביצועים')}</div>`;

  return sectionWrap('stats_row', layout.background || 'muted', layout.mobile_visible,
    container('full', `<div class="stats-row">${items}</div>`)
  );
}

// ── PAIN SECTION ──────────────────────────────────────────────────────────────
function renderPainSection(props, layout) {
  const headline    = str(props.headline) || contentPlaceholder('כותרת Pain');
  const bodyText    = str(props.body_text) ? `<p class="pain-body">${esc(props.body_text)}</p>` : '';
  const painPoints  = arr(props.pain_points);
  const icon        = props.icon_style === 'check' ? '✓' : props.icon_style === 'dot' ? '•' : '✕';
  const conclusion  = str(props.conclusion_text) ? `<p class="pain-conclusion">${esc(props.conclusion_text)}</p>` : '';

  const listItems = painPoints
    ? painPoints.map((p) => `<li class="pain-item"><span class="pain-icon" aria-hidden="true">${icon}</span>${esc(str(p) || '')}</li>`).join('\n')
    : `<li class="pain-item">${contentPlaceholder('נקודת כאב')}</li>`;

  return sectionWrap('pain_section', layout.background || 'alt', layout.mobile_visible,
    container('contained', `<div class="pain-inner">
  <h2 class="section-h2">${typeof headline === 'string' ? esc(headline) : headline}</h2>
  ${bodyText}
  <ul class="pain-list" role="list">${listItems}</ul>
  ${conclusion}
</div>`)
  );
}

// ── MECHANISM SECTION ─────────────────────────────────────────────────────────
function renderMechanismSection(props, layout) {
  const headline   = str(props.headline) ? `<h2 class="section-h2">${esc(props.headline)}</h2>` : `<h2 class="section-h2">${contentPlaceholder('כותרת מנגנון')}</h2>`;
  const sub        = str(props.subheadline) ? `<p class="section-sub">${esc(props.subheadline)}</p>` : '';
  const steps      = arr(props.steps);

  const stepItems = steps
    ? steps.map((s, i) => `<div class="step-item">
  <div class="step-num" aria-hidden="true">${i + 1}</div>
  <div class="step-body">
    <h3 class="step-title">${esc(str(s.title) || '')}</h3>
    ${str(s.description) ? `<p class="step-desc">${esc(s.description)}</p>` : ''}
  </div>
</div>`).join('\n')
    : `<div class="step-item"><div class="step-num">1</div><div class="step-body">${contentPlaceholder('שלב 1')}</div></div>`;

  return sectionWrap('mechanism_section', layout.background || 'default', layout.mobile_visible,
    container('contained', `<div class="mechanism-inner">
  ${headline}
  ${sub}
  <div class="steps-grid">${stepItems}</div>
</div>`)
  );
}

// ── FEATURE CARDS ─────────────────────────────────────────────────────────────
function renderFeatureCards(props, layout) {
  const headline = str(props.headline) ? `<h2 class="section-h2">${esc(props.headline)}</h2>` : '';
  const features = arr(props.features);

  const cards = features
    ? features.map((f) => `<div class="feature-card">
  <h3 class="feature-title">${esc(str(f.title) || '')}</h3>
  ${str(f.description) ? `<p class="feature-desc">${esc(f.description)}</p>` : ''}
</div>`).join('\n')
    : `<div class="feature-card">${contentPlaceholder('יתרון')}</div>`;

  return sectionWrap('feature_cards', layout.background || 'alt', layout.mobile_visible,
    container('contained', `<div class="features-inner">
  ${headline}
  <div class="features-grid">${cards}</div>
</div>`)
  );
}

// ── PROOF SECTION ─────────────────────────────────────────────────────────────
function renderProofSection(props, layout) {
  const headline   = str(props.headline) ? `<h2 class="section-h2 text-inverse">${esc(props.headline)}</h2>` : '';
  const proofItems = arr(props.proof_items);

  const items = proofItems
    ? proofItems.map((item) => `<div class="proof-item">
  ${str(item.value) ? `<div class="proof-value">${esc(item.value)}</div>` : ''}
  <div class="proof-label">${esc(str(item.label) || '')}</div>
  ${str(item.context) ? `<div class="proof-ctx">${esc(item.context)}</div>` : ''}
</div>`).join('\n')
    : `<div class="proof-item">${contentPlaceholder('נתון הוכחה')}</div>`;

  return sectionWrap('proof_section', layout.background || 'dark', layout.mobile_visible,
    container('contained', `<div class="proof-inner">
  ${headline}
  <div class="proof-grid">${items}</div>
</div>`)
  );
}

// ── TESTIMONIALS ──────────────────────────────────────────────────────────────
function renderTestimonials(props, layout) {
  const headline     = str(props.headline) ? `<h2 class="section-h2">${esc(props.headline)}</h2>` : `<h2 class="section-h2">מה אומרים הלקוחות שלנו</h2>`;
  const testimonials = arr(props.testimonials);

  const cards = testimonials
    ? testimonials.map((t) => `<div class="testimonial-card">
  <p class="testimonial-quote">"${esc(str(t.quote) || '')}"</p>
  <div class="testimonial-author">
    <span class="testimonial-name">${esc(str(t.name) || str(t.author) || '')}</span>
    ${str(t.role)   ? `<span class="testimonial-role">${esc(t.role)}</span>` : ''}
    ${str(t.result) ? `<span class="testimonial-result">✓ ${esc(t.result)}</span>` : ''}
  </div>
</div>`).join('\n')
    : `<div class="testimonial-card cp-block">${contentPlaceholder('עדות לקוח — נדרש תוכן אמיתי')}</div>`;

  return sectionWrap('testimonials', layout.background || 'alt', layout.mobile_visible,
    container('contained', `<div class="testimonials-inner">
  ${headline}
  <div class="testimonials-grid">${cards}</div>
</div>`)
  );
}

// ── PRICING BLOCK ─────────────────────────────────────────────────────────────
function renderPricingBlock(props, layout) {
  const headline  = str(props.headline) ? `<h2 class="section-h2">${esc(props.headline)}</h2>` : '';
  const sub       = str(props.subheadline) ? `<p class="section-sub">${esc(props.subheadline)}</p>` : '';
  const urgency   = str(props.urgency_text) ? `<p class="pricing-urgency">${esc(props.urgency_text)}</p>` : '';
  const guarantee = str(props.guarantee_text) ? `<p class="pricing-guarantee">✓ ${esc(props.guarantee_text)}</p>` : '';
  const plans     = arr(props.plans);

  const planCards = plans
    ? plans.map((plan) => {
        const featuresHtml = arr(plan.features)
          ? `<ul class="pricing-features">${plan.features.map((f) => `<li>✓ ${esc(str(f) || '')}</li>`).join('\n')}</ul>`
          : '';
        return `<div class="pricing-card">
  ${str(plan.name)  ? `<div class="pricing-name">${esc(plan.name)}</div>` : ''}
  <div class="pricing-price">${str(plan.price) ? esc(plan.price) : contentPlaceholder('מחיר')}</div>
  ${str(plan.period) ? `<div class="pricing-period">${esc(plan.period)}</div>` : ''}
  ${featuresHtml}
  ${btn(plan.cta_text || 'הצטרף עכשיו', plan.cta_href || '#lead-form', 'primary', 'xl', 'btn-full')}
</div>`;
      }).join('\n')
    : `<div class="pricing-card">${contentPlaceholder('פרטי תמחור — נדרש מחיר')}</div>`;

  return sectionWrap('pricing_block', layout.background || 'default', layout.mobile_visible,
    container('narrow', `<div class="pricing-inner">
  ${headline}
  ${sub}
  ${urgency}
  <div class="pricing-grid">${planCards}</div>
  ${guarantee}
</div>`)
  );
}

// ── FAQ ───────────────────────────────────────────────────────────────────────
function renderFaq(props, layout) {
  const headline  = str(props.headline) ? `<h2 class="section-h2">${esc(props.headline)}</h2>` : `<h2 class="section-h2">שאלות נפוצות</h2>`;
  const questions = arr(props.questions);

  const items = questions
    ? questions.map((q, i) => `<details class="faq-item" ${i === 0 ? 'open' : ''}>
  <summary class="faq-q">${esc(str(q.question) || '')}</summary>
  <div class="faq-a">${str(q.answer) ? esc(q.answer) : contentPlaceholder('תשובה')}</div>
</details>`).join('\n')
    : `<details class="faq-item"><summary class="faq-q">${contentPlaceholder('שאלה')}</summary><div class="faq-a">${contentPlaceholder('תשובה')}</div></details>`;

  return sectionWrap('faq', layout.background || 'alt', layout.mobile_visible,
    container('narrow', `<div class="faq-inner">
  ${headline}
  <div class="faq-list">${items}</div>
</div>`)
  );
}

// ── CTA BLOCK ─────────────────────────────────────────────────────────────────
function renderCtaBlock(props, layout) {
  const isFinal   = layout.is_final;
  const headline  = str(props.headline) ? `<h2 class="cta-h2 text-inverse">${esc(props.headline)}</h2>` : `<h2 class="cta-h2 text-inverse">${contentPlaceholder('כותרת CTA')}</h2>`;
  const subtext   = str(props.subtext)  ? `<p class="cta-sub text-inverse">${esc(props.subtext)}</p>` : '';
  const urgency   = str(props.urgency_text)   ? `<p class="cta-urgency">${esc(props.urgency_text)}</p>` : '';
  const guarantee = str(props.guarantee_text) ? `<p class="cta-guarantee text-inverse-muted">✓ ${esc(props.guarantee_text)}</p>` : '';
  const ctaBtn    = btn(props.button_text || props.cta_text || 'התחל עכשיו', props.button_href || props.cta_href || '#lead-form', layout.cta_variant || 'primary', layout.cta_size || 'xl');

  const stickyClass = layout.sticky_mobile && isFinal ? ' cta-sticky-mobile' : '';

  return sectionWrap('cta_block', 'primary', layout.mobile_visible,
    container('narrow', `<div class="cta-inner${stickyClass}">
  ${headline}
  ${subtext}
  ${ctaBtn}
  ${urgency}
  ${guarantee}
</div>`)
  );
}

// ── LEAD FORM ─────────────────────────────────────────────────────────────────
function renderLeadForm(props, layout) {
  const headline    = str(props.headline) ? `<h2 class="form-h2">${esc(props.headline)}</h2>` : `<h2 class="form-h2">${contentPlaceholder('כותרת טופס')}</h2>`;
  const subtext     = str(props.subtext)  ? `<p class="form-sub">${esc(props.subtext)}</p>` : '';
  const privacy     = str(props.privacy_note) ? `<p class="form-privacy">${esc(props.privacy_note)}</p>` : '';
  const submitText  = str(props.submit_text) || 'שלח לי פרטים';
  const fields      = arr(props.fields) || [
    { type: 'text',  name: 'name',  label: 'שם מלא',     placeholder: 'הכנס/י שם מלא', required: true  },
    { type: 'tel',   name: 'phone', label: 'מספר טלפון',  placeholder: '05X-XXXXXXX',    required: true  },
  ];

  const fieldHtml = fields.map((f) => {
    const reqAttr = f.required ? ' required' : '';
    const ph      = escAttr(str(f.placeholder) || '');
    const lbl     = esc(str(f.label) || f.name);
    const nm      = escAttr(str(f.name) || '');
    const tp      = escAttr(str(f.type) || 'text');
    return `<div class="form-field">
  <label class="form-label" for="field-${nm}">${lbl}</label>
  <input type="${tp}" id="field-${nm}" name="${nm}" placeholder="${ph}" class="form-input" autocomplete="off"${reqAttr}>
</div>`;
  }).join('\n');

  const inlineStyle = layout.background === 'default' ? '' : '';

  return sectionWrap('lead_form', layout.background || 'default', layout.mobile_visible,
    container('narrow', `<div class="form-wrap" id="lead-form">
  ${headline}
  ${subtext}
  <form class="form" action="/" method="POST" data-netlify="true" netlify-honeypot="bot-field" name="lead-capture">
    <input type="hidden" name="form-name" value="lead-capture">
    <p class="form-honeypot" aria-hidden="true"><label>אל תמלא שדה זה: <input name="bot-field"></label></p>
    ${fieldHtml}
    <button type="submit" class="btn btn-primary btn-full">${esc(submitText)}</button>
  </form>
  ${privacy}
</div>`)
  );
}

// ── Component dispatcher ──────────────────────────────────────────────────────

function renderComponent(component, options = {}) {
  const { type, props = {}, layout = {} } = component;

  switch (type) {
    case 'hero':              return renderHero(props, layout, options);
    case 'banner_strip':      return renderBannerStrip(props, layout);
    case 'stats_row':         return renderStatsRow(props, layout);
    case 'pain_section':      return renderPainSection(props, layout);
    case 'mechanism_section': return renderMechanismSection(props, layout);
    case 'feature_cards':     return renderFeatureCards(props, layout);
    case 'proof_section':     return renderProofSection(props, layout);
    case 'testimonials':      return renderTestimonials(props, layout);
    case 'pricing_block':     return renderPricingBlock(props, layout);
    case 'faq':               return renderFaq(props, layout);
    case 'cta_block':         return renderCtaBlock(props, layout);
    case 'lead_form':         return renderLeadForm(props, layout);
    default:
      return `<!-- unknown component: ${esc(type)} -->`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS Builder
// ─────────────────────────────────────────────────────────────────────────────

function buildPageCSS(meta) {
  const fontUrl = meta?.google_fonts_url || '';
  return `
/* ── Reset ─────────────────────────────────────────────── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
img,svg,video,iframe{display:block;max-width:100%}
a{text-decoration:none;color:inherit}
button{cursor:pointer;font:inherit;border:none;background:none}
ul,ol{list-style:none}

/* ── CSS Custom Properties (from design tokens) ─────────── */
:root{
  --c-primary:#1a56db;
  --c-primary-h:#1e429f;
  --c-primary-l:#ebf5ff;
  --c-accent:#e3342f;
  --c-accent-h:#cc1f1a;
  --c-success:#0e9f6e;
  --c-warning:#c27803;
  --c-text:#111827;
  --c-text-sec:#6b7280;
  --c-text-muted:#9ca3af;
  --c-text-inv:#ffffff;
  --c-bg:#ffffff;
  --c-bg-subtle:#f9fafb;
  --c-bg-muted:#f3f4f6;
  --c-bg-dark:#111827;
  --c-bg-dark2:#1f2937;
  --c-border:#e5e7eb;
  --c-border-s:#d1d5db;
  --f-display:"Rubik","Heebo","Arial Hebrew",Arial,sans-serif;
  --f-body:"Heebo","Rubik","Arial Hebrew",Arial,sans-serif;
  --sp-section:80px;
  --sp-section-sm:48px;
  --sp-x:24px;
  --r-sm:0.25rem;
  --r-md:0.5rem;
  --r-lg:0.75rem;
  --r-xl:1rem;
  --shadow-md:0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -2px rgba(0,0,0,.1);
  --shadow-lg:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);
}

/* ── Base ───────────────────────────────────────────────── */
html{font-size:16px;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;scroll-behavior:smooth}
body{
  font-family:var(--f-body);
  color:var(--c-text);
  background:var(--c-bg);
  direction:rtl;
  text-align:right;
  line-height:1.6;
  overflow-x:hidden;
}

/* ── Containers ─────────────────────────────────────────── */
.con{width:100%;max-width:1024px;margin-inline:auto;padding-inline:var(--sp-x)}
.con-narrow{width:100%;max-width:640px;margin-inline:auto;padding-inline:var(--sp-x)}
.con-flush{width:100%;padding-inline:0}

/* ── Sections ───────────────────────────────────────────── */
.section{padding-block:var(--sp-section);width:100%}
.bg-default{background:var(--c-bg)}
.bg-alt{background:var(--c-bg-subtle)}
.bg-muted{background:var(--c-bg-muted)}
.bg-dark{background:var(--c-bg-dark)}
.bg-primary{background:var(--c-primary)}
.hidden-mobile{display:none}

/* ── Typography ─────────────────────────────────────────── */
h1,h2,h3,h4{font-family:var(--f-display);line-height:1.15}
h1{font-size:3rem;font-weight:800}
h2{font-size:1.875rem;font-weight:700;line-height:1.3}
h3{font-size:1.5rem;font-weight:600;line-height:1.3}
h4{font-size:1.25rem;font-weight:600}
p{line-height:1.65;margin-block-end:1em}
p:last-child{margin-block-end:0}
.section-h2{margin-block-end:1.25rem;color:var(--c-text)}
.section-sub{font-size:1.125rem;color:var(--c-text-sec);margin-block-end:2rem}
.text-inverse{color:var(--c-text-inv)!important}
.text-inverse-muted{color:rgba(255,255,255,.8)}

/* ── Buttons ────────────────────────────────────────────── */
.btn{
  display:inline-flex;align-items:center;justify-content:center;
  gap:8px;border:2px solid transparent;border-radius:var(--r-md);
  font-family:var(--f-display);font-weight:700;
  text-decoration:none;transition:all 200ms ease;
  white-space:nowrap;cursor:pointer;
}
.btn-primary{background:var(--c-primary);color:#fff}
.btn-primary:hover{background:var(--c-primary-h)}
.btn-danger{background:var(--c-accent);color:#fff}
.btn-danger:hover{background:var(--c-accent-h)}
.btn-secondary{background:transparent;color:var(--c-primary);border-color:var(--c-primary)}
.btn-secondary:hover{background:var(--c-primary-l)}
.btn-sm{font-size:.875rem;padding:8px 16px}
.btn-base{font-size:1rem;padding:12px 24px}
.btn-lg{font-size:1.125rem;padding:14px 32px;border-radius:var(--r-lg)}
.btn-xl{font-size:1.25rem;padding:16px 40px;border-radius:var(--r-lg)}
.btn-full{font-size:1.125rem;padding:16px 24px;border-radius:var(--r-lg);width:100%;display:flex}

/* ── Hero ───────────────────────────────────────────────── */
.hero-wrap{display:flex;align-items:center;width:100%}
.hero-center{text-align:center;max-width:720px;margin-inline:auto;padding-block:80px}
.hero-center .hero-ctas{justify-content:center}
.hero-split{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:48px;padding-block:80px}
.hero-content{display:flex;flex-direction:column;gap:20px}
.hero-ctas{display:flex;gap:16px;flex-wrap:wrap}
.hero-h1{font-size:3rem;font-weight:800;line-height:1.15;color:var(--c-text)}
.hero-sub{font-size:1.25rem;color:var(--c-text-sec);max-width:520px}
.hero-trust{font-size:.95rem;color:var(--c-success);font-weight:600}
.hero-badge{display:inline-block;background:var(--c-primary-l);color:var(--c-primary);padding:4px 12px;border-radius:9999px;font-size:.875rem;font-weight:600;margin-block-end:8px}
.hero-visual{border-radius:var(--r-xl);overflow:hidden}
.hero-form-panel{background:var(--c-bg);border-radius:var(--r-xl);padding:32px;box-shadow:var(--shadow-lg)}
.hero-form-panel .section{padding-block:0}
.hero-form-panel .form-wrap{padding:0}

/* ── Banner Strip ───────────────────────────────────────── */
.banner-strip{padding-block:12px;width:100%}
.banner-inner{display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap}
.banner-text{color:#fff;font-weight:600;font-size:.95rem}

/* ── Stats Row ──────────────────────────────────────────── */
.section.bg-muted{padding-block:var(--sp-section-sm)}
.stats-row{display:flex;align-items:center;justify-content:center;gap:48px;flex-wrap:wrap;padding-block:8px}
.stat-item{text-align:center}
.stat-num{display:block;font-size:2.25rem;font-weight:800;color:var(--c-primary);font-family:var(--f-display);line-height:1}
.stat-label{display:block;font-size:.875rem;color:var(--c-text-sec);margin-block-start:4px}

/* ── Pain Section ───────────────────────────────────────── */
.pain-inner{max-width:640px;margin-inline:auto;text-align:center}
.pain-body{color:var(--c-text-sec);margin-block-end:1.5rem}
.pain-list{display:flex;flex-direction:column;gap:12px;text-align:right}
.pain-item{display:flex;align-items:baseline;gap:12px;font-size:1.05rem;padding:12px 16px;background:var(--c-bg);border-radius:var(--r-md);border:1px solid var(--c-border)}
.pain-icon{color:var(--c-accent);font-weight:700;flex-shrink:0}
.pain-conclusion{margin-block-start:2rem;font-size:1.125rem;font-weight:600;color:var(--c-primary)}

/* ── Mechanism Section ──────────────────────────────────── */
.mechanism-inner{}
.steps-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;margin-block-start:2rem}
.step-item{display:flex;gap:16px;align-items:flex-start;background:var(--c-bg-subtle);padding:24px;border-radius:var(--r-lg)}
.step-num{flex-shrink:0;width:40px;height:40px;border-radius:50%;background:var(--c-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.125rem;font-family:var(--f-display)}
.step-title{font-size:1rem;font-weight:700;margin-block-end:4px}
.step-desc{font-size:.9rem;color:var(--c-text-sec);margin:0}

/* ── Feature Cards ──────────────────────────────────────── */
.features-inner{}
.features-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;margin-block-start:2rem}
.feature-card{background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-lg);padding:24px;box-shadow:var(--shadow-md)}
.feature-title{font-size:1rem;font-weight:700;margin-block-end:8px}
.feature-desc{font-size:.9rem;color:var(--c-text-sec);margin:0}

/* ── Proof Section ──────────────────────────────────────── */
.proof-inner{text-align:center}
.proof-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:32px;margin-block-start:2rem}
.proof-item{background:var(--c-bg-dark2);border-radius:var(--r-lg);padding:24px;text-align:center}
.proof-value{font-size:2.25rem;font-weight:800;color:var(--c-primary-l);font-family:var(--f-display);line-height:1}
.proof-label{font-size:.9rem;color:rgba(255,255,255,.8);margin-block:8px 4px}
.proof-ctx{font-size:.8rem;color:rgba(255,255,255,.5)}

/* ── Testimonials ───────────────────────────────────────── */
.testimonials-inner{}
.testimonials-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;margin-block-start:2rem}
.testimonial-card{background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-xl);padding:28px;box-shadow:var(--shadow-md)}
.testimonial-quote{font-size:1rem;line-height:1.7;color:var(--c-text);margin-block-end:16px;font-style:italic}
.testimonial-author{display:flex;flex-direction:column;gap:4px}
.testimonial-name{font-weight:700;font-size:.95rem}
.testimonial-role{font-size:.85rem;color:var(--c-text-sec)}
.testimonial-result{font-size:.85rem;color:var(--c-success);font-weight:600}
.cp-block{color:var(--c-text-sec);font-style:italic;padding:24px;text-align:center}

/* ── Pricing Block ──────────────────────────────────────── */
.pricing-inner{text-align:center}
.pricing-grid{display:flex;justify-content:center;gap:24px;flex-wrap:wrap;margin-block:2rem}
.pricing-card{background:var(--c-bg);border:2px solid var(--c-primary);border-radius:var(--r-xl);padding:40px 32px;min-width:280px;max-width:400px;width:100%}
.pricing-name{font-weight:700;font-size:.875rem;text-transform:uppercase;letter-spacing:.08em;color:var(--c-text-sec);margin-block-end:8px}
.pricing-price{font-size:3rem;font-weight:800;color:var(--c-primary);font-family:var(--f-display);line-height:1;margin-block:12px}
.pricing-period{font-size:.875rem;color:var(--c-text-sec);margin-block-end:20px}
.pricing-features{text-align:right;margin-block:20px;display:flex;flex-direction:column;gap:10px}
.pricing-features li{display:flex;align-items:baseline;gap:8px;font-size:.95rem;color:var(--c-text)}
.pricing-urgency{color:var(--c-accent);font-weight:600;margin-block-end:8px}
.pricing-guarantee{color:var(--c-success);font-weight:600;margin-block-start:16px}

/* ── FAQ ────────────────────────────────────────────────── */
.faq-inner{}
.faq-list{display:flex;flex-direction:column;gap:12px;margin-block-start:2rem}
.faq-item{border:1px solid var(--c-border);border-radius:var(--r-lg);overflow:hidden}
.faq-item summary::-webkit-details-marker{display:none}
.faq-q{
  display:flex;align-items:center;justify-content:space-between;
  padding:18px 20px;cursor:pointer;font-weight:600;font-size:1rem;
  user-select:none;list-style:none;gap:12px;
}
.faq-q::after{content:"＋";font-weight:400;flex-shrink:0;color:var(--c-primary);font-size:1.25rem}
details[open] .faq-q::after{content:"－"}
.faq-a{padding:0 20px 18px;color:var(--c-text-sec);line-height:1.65;font-size:.95rem}

/* ── CTA Block ──────────────────────────────────────────── */
.cta-inner{text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px;padding:20px 0}
.cta-h2{font-size:2.25rem;font-weight:800;line-height:1.2}
.cta-sub{font-size:1.1rem;max-width:520px}
.cta-urgency{font-size:.9rem;color:rgba(255,255,255,.85)}
.cta-guarantee{font-size:.875rem}

/* ── Lead Form ──────────────────────────────────────────── */
.form-wrap{background:var(--c-bg);border-radius:var(--r-xl);padding:40px;box-shadow:var(--shadow-lg);border:1px solid var(--c-border)}
.form-h2{margin-block-end:8px}
.form-sub{color:var(--c-text-sec);margin-block-end:24px}
.form{display:flex;flex-direction:column;gap:16px}
.form-field{display:flex;flex-direction:column;gap:6px}
.form-label{font-size:.875rem;font-weight:600;color:var(--c-text)}
.form-input{
  padding:12px 16px;border:1.5px solid var(--c-border-s);border-radius:var(--r-md);
  font-size:1rem;font-family:var(--f-body);color:var(--c-text);background:var(--c-bg);
  direction:rtl;text-align:right;width:100%;transition:border-color 200ms;
}
.form-input:focus{outline:none;border-color:var(--c-primary)}
.form-input::placeholder{color:var(--c-text-muted)}
.form-privacy{font-size:.8rem;color:var(--c-text-muted);text-align:center;margin-block-start:8px}
.form-honeypot{display:none!important;visibility:hidden;position:absolute;left:-9999px}

/* ── Image Slots ────────────────────────────────────────── */
.img-slot{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:var(--c-bg-muted);border:2px dashed var(--c-border-s);
  border-radius:var(--r-lg);min-height:300px;gap:8px;
}
.hero-img{min-height:400px}
.img-slot__icon{font-size:2rem;opacity:.4}
.img-slot__label{font-size:.875rem;color:var(--c-text-muted)}

/* ── Content Placeholders ───────────────────────────────── */
.cp{display:inline-block;background:var(--c-bg-muted);border:1.5px dashed var(--c-border-s);border-radius:4px;padding:3px 8px;color:var(--c-text-sec);font-style:italic;font-size:.9em}

/* ── Responsive (mobile-first) ───────────────────────────── */
@media(max-width:768px){
  h1,.hero-h1{font-size:2rem}
  h2,.section-h2,.cta-h2{font-size:1.5rem}
  .section{padding-block:var(--sp-section-sm);padding-inline:16px}
  .hero-wrap{min-height:unset!important}
  .hero-split{grid-template-columns:1fr;gap:32px;padding-block:48px}
  .hero-visual{order:2}
  .hero-content{order:1}
  .hero-ctas .btn-xl,.hero-ctas .btn-lg{width:100%}
  .stats-row{gap:24px}
  .stat-num{font-size:1.75rem}
  .steps-grid,.features-grid{grid-template-columns:1fr}
  .proof-grid{grid-template-columns:repeat(2,1fr)}
  .testimonials-grid{grid-template-columns:1fr}
  .pricing-grid{flex-direction:column;align-items:center}
  .hero-form-panel{padding:24px}
  .form-wrap{padding:24px}
  .btn-xl{width:100%}
  .cta-h2{font-size:1.5rem}
}
@media(max-width:480px){
  h1,.hero-h1{font-size:1.75rem}
  .proof-grid{grid-template-columns:1fr}
}
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixed-size CSS for banners and ad cards
// ─────────────────────────────────────────────────────────────────────────────

function buildBannerCSS(width, height) {
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{
  width:${width}px;height:${height}px;overflow:hidden;
  font-family:"Rubik","Heebo",Arial,sans-serif;
  background:#1a56db;color:#fff;
  direction:rtl;text-align:right;
  display:flex;align-items:center;
}
.banner-wrap{
  width:100%;height:100%;
  display:flex;align-items:center;justify-content:space-between;
  padding:0 20px;gap:12px;
}
.banner-logo{font-weight:800;font-size:${Math.max(12, Math.floor(height * 0.22))}px;white-space:nowrap}
.banner-text{font-size:${Math.max(11, Math.floor(height * 0.18))}px;font-weight:600;flex:1;line-height:1.2;text-align:center}
.banner-cta{background:#fff;color:#1a56db;border-radius:6px;padding:${Math.floor(height * 0.12)}px ${Math.floor(height * 0.18)}px;font-weight:800;font-size:${Math.max(10, Math.floor(height * 0.15))}px;white-space:nowrap;flex-shrink:0}
.cp{border:1px dashed rgba(255,255,255,.5);padding:2px 6px;font-style:italic;font-size:.85em}
`.trim();
}

function buildAdCardCSS(width, height) {
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{
  width:${width}px;height:${height}px;overflow:hidden;
  font-family:"Rubik","Heebo",Arial,sans-serif;
  direction:rtl;text-align:right;
  background:#111827;color:#fff;
}
.card-wrap{
  width:${width}px;height:${height}px;
  position:relative;display:flex;flex-direction:column;
  justify-content:flex-end;padding:${Math.floor(height * 0.05)}px;
}
.card-bg{position:absolute;inset:0;background:var(--c-bg-muted,#1f2937)}
.card-content{position:relative;z-index:2;background:rgba(0,0,0,.55);border-radius:12px;padding:${Math.floor(height * 0.04)}px}
.card-headline{font-size:${Math.floor(width * 0.06)}px;font-weight:800;line-height:1.2;margin-block-end:${Math.floor(height * 0.025)}px}
.card-sub{font-size:${Math.floor(width * 0.038)}px;opacity:.85;margin-block-end:${Math.floor(height * 0.03)}px}
.card-cta{display:inline-block;background:#1a56db;color:#fff;border-radius:8px;padding:${Math.floor(height * 0.025)}px ${Math.floor(height * 0.04)}px;font-weight:700;font-size:${Math.floor(width * 0.04)}px}
.img-slot{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#1f2937;font-size:3rem;opacity:.3}
.cp{border:1px dashed rgba(255,255,255,.4);padding:2px 6px;font-style:italic;font-size:.85em}
`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML Document builder
// ─────────────────────────────────────────────────────────────────────────────

function buildHTMLDocument(bodyHTML, css, meta) {
  const lang    = escAttr(meta?.lang   || 'he');
  const dir     = escAttr(meta?.dir    || 'rtl');
  const fontUrl = str(meta?.google_fonts_url);

  const fontLinks = fontUrl
    ? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${escAttr(fontUrl)}" rel="stylesheet">`
    : '';

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(meta?.page_title || 'Landing Page')}</title>
${fontLinks}
<style>
${css}
</style>
</head>
<body>
${bodyHTML}
</body>
</html>`.trim();
}

function buildBannerDocument(innerHTML, css, width, height) {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<style>${css}</style>
</head>
<body>
${innerHTML}
</body>
</html>`.trim();
}

function buildAdCardDocument(innerHTML, css) {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<style>${css}</style>
</head>
<body>
${innerHTML}
</body>
</html>`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Compose functions — one per output type
// ─────────────────────────────────────────────────────────────────────────────

// ── Full landing page ─────────────────────────────────────────────────────────
function _composeLandingPage(blueprint) {
  const { meta, components, cta_strategy } = blueprint;
  const warnings = [];

  // Find inline-hero form (rendered inside hero, skip in main loop)
  const inlineFormComp = components.find(
    (c) => c.type === 'lead_form' && c.props?.position === 'inline-hero'
  );
  const skipOrders = inlineFormComp ? new Set([inlineFormComp.order]) : new Set();

  const sorted = [...components].sort((a, b) => a.order - b.order);

  const sectionHtml = sorted
    .filter((c) => !skipOrders.has(c.order))
    .map((c) => {
      const opts = (c.type === 'hero' && inlineFormComp)
        ? { inlineFormProps: inlineFormComp.props }
        : {};
      return renderComponent(c, opts);
    })
    .join('\n\n');

  // Collect validation warnings
  sorted.forEach((c) => {
    if (c.validation && !c.validation.valid) {
      warnings.push(...(c.validation.errors || []));
    }
  });

  const css  = buildPageCSS(meta);
  const html = buildHTMLDocument(sectionHtml, css, meta);

  return {
    html,
    type:             'landing_page_html',
    template_id:      blueprint.template_id,
    sections_rendered: sorted.length - skipOrders.size,
    warnings,
  };
}

// ── Banner ad (fixed-size) ────────────────────────────────────────────────────
function _composeBanner(blueprint, sizeId = 'rectangle') {
  const SIZE_MAP = {
    leaderboard: { width: 728,  height: 90  },
    rectangle:   { width: 300,  height: 250 },
    skyscraper:  { width: 160,  height: 600 },
    billboard:   { width: 970,  height: 250 },
    square:      { width: 250,  height: 250 },
  };
  const size = SIZE_MAP[sizeId] || SIZE_MAP.rectangle;

  const bannerComp = (blueprint.components || []).find((c) => c.type === 'banner_strip');
  const props = bannerComp?.props || {};

  const text    = str(props.text)     || contentPlaceholder('טקסט באנר');
  const ctaText = str(props.cta_text) || 'לחץ כאן';

  const innerHTML = `<div class="banner-wrap">
  <div class="banner-logo">[לוגו]</div>
  <div class="banner-text">${typeof text === 'string' ? esc(text) : text}</div>
  <div class="banner-cta">${esc(ctaText)}</div>
</div>`;

  const css  = buildBannerCSS(size.width, size.height);
  const html = buildBannerDocument(innerHTML, css, size.width, size.height);

  return {
    html,
    type:    'banner_html',
    size_id: sizeId,
    width:   size.width,
    height:  size.height,
    warnings: [],
  };
}

// ── Ad card / offer card (fixed-format) ───────────────────────────────────────
function _composeAdCard(blueprint, formatId = 'square') {
  const FORMAT_MAP = {
    square:   { width: 1080, height: 1080 },
    portrait: { width: 1080, height: 1350 },
    story:    { width: 1080, height: 1920 },
  };
  const fmt = FORMAT_MAP[formatId] || FORMAT_MAP.square;

  const heroComp = (blueprint.components || []).find((c) => c.type === 'hero');
  const ctaComp  = (blueprint.components || []).find((c) => c.type === 'cta_block');
  const props    = heroComp?.props || {};

  const headline = str(props.headline) ? esc(props.headline) : contentPlaceholder('כותרת');
  const sub      = str(props.subheadline) ? `<div class="card-sub">${esc(props.subheadline)}</div>` : '';
  const ctaText  = str(props.cta_text) || str(ctaComp?.props?.button_text) || 'לחץ כאן';

  const innerHTML = `<div class="card-wrap">
  <div class="card-bg">${imgSlot('תמונת מוצר', props._image_prompt)}</div>
  <div class="card-content">
    <div class="card-headline">${typeof headline === 'string' ? headline : headline}</div>
    ${sub}
    <div class="card-cta">${esc(ctaText)}</div>
  </div>
</div>`;

  const css  = buildAdCardCSS(fmt.width, fmt.height);
  const html = buildAdCardDocument(innerHTML, css);

  return {
    html,
    type:      'ad_html',
    format_id: formatId,
    width:     fmt.width,
    height:    fmt.height,
    warnings:  [],
  };
}

// ── Single section fragment (no document wrapper) ─────────────────────────────
function _composeSectionHTML(component) {
  if (!component) return { html: '', type: 'section_html', warnings: [] };
  const html = renderComponent(component);
  const warnings = (component.validation && !component.validation.valid)
    ? component.validation.errors || []
    : [];
  return { html, type: 'section_html', component_type: component.type, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// composeHTML — main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {HTMLBlueprint} blueprint   — from buildHTMLBlueprint()
 * @param {object}        options
 *   type      {string}  — override output type ('landing_page_html'|'banner_html'|'ad_html'|'section_html')
 *   size_id   {string}  — for banners:   'leaderboard'|'rectangle'|'skyscraper'|'billboard'|'square'
 *   format_id {string}  — for ad cards:  'square'|'portrait'|'story'
 *   component {object}  — for section_html: the single component to render
 * @returns {{ html, type, template_id?, sections_rendered?, warnings }}
 */
function composeHTML(blueprint, options = {}) {
  if (!blueprint) {
    throw new Error('composeHTML: blueprint is required');
  }

  const templateId = options.type || blueprint.template_id || 'lp-conversion-rtl';

  if (templateId === 'banner-basic-rtl') {
    return _composeBanner(blueprint, options.size_id);
  }
  if (templateId === 'ad-html-card-rtl') {
    return _composeAdCard(blueprint, options.format_id);
  }
  if (templateId === 'section-block' || templateId === 'hero-only' || options.type === 'section_html') {
    return _composeSectionHTML(options.component || (blueprint.components || [])[0]);
  }

  // Default: full landing page
  return _composeLandingPage(blueprint);
}

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  composeHTML,
  renderComponent,      // exposed for testing individual components
  buildPageCSS,         // exposed for CSS inspection / override
  buildHTMLDocument,    // exposed for custom document wrappers
};
