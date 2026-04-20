'use strict';
/**
 * execution/core/asset-decomposer.js
 * Asset Decomposition & Transformation.
 * Breaks large assets into smaller reusable pieces.
 * Transforms one asset format into another.
 *
 * Operations:
 *   decompose  — LP → hooks, ad → CTAs, script → clips
 *   transform  — LP → ads, ad → WhatsApp, hook → variations
 */

// ── Decomposition ──────────────────────────────────────────────────────────────

function decomposeAsset(assetType, asset, options) {
  const decomposers = {
    landing_page: _decomposeLandingPage,
    ads:          _decomposeAd,
    scripts:      _decomposeScript,
    email:        _decomposeEmail,
  };

  const fn = decomposers[assetType];
  if (!fn) return { pieces: [], count: 0, sourceType: assetType };

  return fn(asset, options);
}

function _decomposeLandingPage(lp, options) {
  const sections = lp?.content?.sections || lp?.sections || {};
  const pieces   = [];

  // Extract hooks from hero + pain sections
  if (sections.hero?.headline) {
    pieces.push({ type: 'hook', subtype: 'headline', text: sections.hero.headline });
  }
  if (sections.pain_block?.headline) {
    pieces.push({ type: 'hook', subtype: 'pain', text: sections.pain_block.headline });
  }
  if (sections.solution?.headline) {
    pieces.push({ type: 'hook', subtype: 'solution', text: sections.solution.headline });
  }

  // Extract CTAs
  if (sections.hero?.cta)    pieces.push({ type: 'cta', text: sections.hero.cta, location: 'hero' });
  if (sections.cta?.button)  pieces.push({ type: 'cta', text: sections.cta.button, location: 'cta' });
  if (sections.offer?.guarantee) pieces.push({ type: 'trust_signal', text: sections.offer.guarantee });

  // Extract proofs for social content
  if (sections.proof) {
    const p = sections.proof;
    if (p.stat) pieces.push({ type: 'stat', text: p.stat });
    if (p.testimonial_placeholder) pieces.push({ type: 'testimonial_placeholder', text: p.testimonial_placeholder });
  }

  // Extract FAQs for content posts
  if (sections.faq?.questions) {
    sections.faq.questions.forEach((q, i) => {
      pieces.push({ type: 'faq_item', index: i, question: q.q, answer: q.a });
    });
  }

  // Mini ads (hero headline + CTA)
  if (sections.hero?.headline && sections.hero?.cta) {
    pieces.push({
      type:   'mini_ad',
      text:   sections.hero.headline,
      cta:    sections.hero.cta,
      source: 'lp_hero',
    });
  }

  return { pieces, count: pieces.length, sourceType: 'landing_page' };
}

function _decomposeAd(ad, options) {
  const a      = ad?.text || ad;
  const pieces = [];

  // Extract hook variations from headline
  if (a?.headline) {
    pieces.push({ type: 'hook', text: a.headline, source: 'headline' });
    // Generate hook variations
    const hookVariations = _generateHookVariations(a.headline);
    hookVariations.forEach(v => pieces.push({ type: 'hook_variation', text: v }));
  }

  // Extract CTA variations
  if (a?.cta_button) {
    pieces.push({ type: 'cta', text: a.cta_button, source: 'cta_button' });
    const ctaVariations = _generateCtaVariations(a.cta_button);
    ctaVariations.forEach(v => pieces.push({ type: 'cta_variation', text: v }));
  }

  // WhatsApp message format
  if (a?.primary_text) {
    pieces.push({
      type:    'whatsapp',
      text:    _toWhatsApp(a.headline, a.primary_text, a.cta_button),
      source:  'ad_whatsapp',
    });
  }

  return { pieces, count: pieces.length, sourceType: 'ad' };
}

function _decomposeScript(script, options) {
  const pieces = [];
  const sections = ['hook', 'problem', 'solution', 'proof', 'cta'];

  for (const section of sections) {
    if (script?.[section]?.text) {
      pieces.push({
        type:       'clip',
        section,
        text:       script[section].text,
        duration:   script[section].duration_sec,
        standalone: section === 'hook' || section === 'cta',
      });
    }
  }

  // Extract short-form hook (first 15 words from hook)
  if (script?.hook?.text) {
    const shortHook = script.hook.text.split(' ').slice(0, 15).join(' ');
    pieces.push({ type: 'short_hook', text: shortHook, source: 'script_hook' });
  }

  // Caption for social media
  if (script?.caption) {
    pieces.push({ type: 'caption', text: script.caption });
  }

  return { pieces, count: pieces.length, sourceType: 'script' };
}

function _decomposeEmail(email, options) {
  const e      = email?.content || email;
  const pieces = [];

  if (e?.subject)  pieces.push({ type: 'subject_line', text: e.subject });
  if (e?.preview)  pieces.push({ type: 'preview_text', text: e.preview });
  if (e?.cta_text) pieces.push({ type: 'cta', text: e.cta_text, source: 'email' });
  if (e?.ps_line)  pieces.push({ type: 'ps', text: e.ps_line });

  // First sentence as hook
  if (e?.body) {
    const firstSentence = e.body.split(/[.!?]/)[0];
    if (firstSentence?.length > 10) {
      pieces.push({ type: 'hook', text: firstSentence, source: 'email_body' });
    }
  }

  return { pieces, count: pieces.length, sourceType: 'email' };
}

// ── Transformation ──────────────────────────────────────────────────────────────

function transformAsset({ fromType, toType, asset, brief }) {
  const key = `${fromType}→${toType}`;
  const transformers = {
    'landing_page→ads':    _lpToAds,
    'landing_page→email':  _lpToEmail,
    'ads→whatsapp':        _adToWhatsApp,
    'hooks→variations':    _hooksToVariations,
    'ads→hooks':           _adToHooks,
  };

  const fn = transformers[key];
  if (!fn) return { transformed: null, note: `Transformation ${key} not supported` };

  return { transformed: fn(asset, brief), sourceType: fromType, targetType: toType };
}

function _lpToAds(lp, brief) {
  const sections = lp?.content?.sections || lp?.sections || {};
  return {
    headline:     sections.hero?.headline || '',
    primary_text: sections.pain_block?.body || sections.solution?.body || '',
    cta_button:   sections.hero?.cta || sections.cta?.button || '',
    description:  sections.solution?.mechanism || '',
    source:       'lp_transform',
  };
}

function _lpToEmail(lp, brief) {
  const sections = lp?.content?.sections || lp?.sections || {};
  return {
    subject:  sections.hero?.headline || '',
    preview:  sections.pain_block?.headline || '',
    greeting: `היי,`,
    body:     [
      sections.pain_block?.body || '',
      sections.solution?.body || '',
      sections.proof?.stat || '',
    ].filter(Boolean).join('\n\n'),
    cta_text: sections.cta?.button || sections.hero?.cta || '',
    ps_line:  sections.offer?.guarantee || '',
    source:   'lp_email_transform',
  };
}

function _adToWhatsApp(ad, brief) {
  const a = ad?.text || ad;
  return _toWhatsApp(a?.headline, a?.primary_text, a?.cta_button);
}

function _hooksToVariations(hooks, brief) {
  const allHooks = Array.isArray(hooks) ? hooks : [hooks];
  const variations = [];
  for (const hook of allHooks) {
    const text = hook?.text || hook;
    variations.push(
      { variation: 'question',  text: text.endsWith('?') ? text : text + '?' },
      { variation: 'statement', text: text.replace('?', '.') },
      { variation: 'short',     text: text.split(' ').slice(0, 8).join(' ') + '...' },
    );
  }
  return variations;
}

function _adToHooks(ad, brief) {
  const a = ad?.text || ad;
  const hooks = [];
  if (a?.headline) hooks.push({ type: 'headline_hook', text: a.headline });
  if (a?.primary_text) {
    const first = a.primary_text.split(/[.!?]/)[0];
    if (first?.length > 5) hooks.push({ type: 'body_hook', text: first });
  }
  return hooks;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _generateHookVariations(headline) {
  if (!headline) return [];
  return [
    `❓ ${headline.replace('!', '?')}`,
    `💡 ${headline}`,
  ].filter(Boolean);
}

function _generateCtaVariations(cta) {
  if (!cta) return [];
  const SOFT_VARIANTS = { 'קנה עכשיו': 'גלה עוד', 'הצטרף': 'בדוק בחינם', 'התחל': 'צפה איך' };
  return [SOFT_VARIANTS[cta] || null, `← ${cta}`].filter(Boolean);
}

function _toWhatsApp(headline, body, cta) {
  const parts = [];
  if (headline) parts.push(`*${headline}*`);
  if (body) parts.push(body.slice(0, 200));
  if (cta)  parts.push(`👉 ${cta}`);
  return parts.join('\n\n');
}

module.exports = {
  decomposeAsset,
  transformAsset,
};
