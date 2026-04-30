'use strict';

/**
 * generate-content.js
 * POST /generate-content
 * Body: { type, title, goal, audience, offer, userId, businessProfile }
 * Returns: { id, title }
 *
 * Generates an HTML landing page with AI and saves to generated_assets.
 */

const { ok, fail, options } = require('./_shared/http');
const { requireAuth }       = require('./_shared/auth');
const { parseJsonBody }     = require('./_shared/request');
const { saveAsset }         = require('./_shared/asset-storage');
const OpenRouterAdapter     = require('./_shared/providers/adapters/openrouter');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST only', 405);

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail('UNAUTHORIZED', e.message, 401); }

  let body;
  try { body = parseJsonBody(event); } catch { return fail('BAD_REQUEST', 'invalid JSON', 400); }

  const { title, goal = '', audience = '', offer = '', businessProfile } = body;
  if (!title?.trim()) return fail('BAD_REQUEST', 'title is required', 400);

  const bpContext = businessProfile
    ? `שם העסק: ${businessProfile.business_name || ''}
מוצר/שירות: ${businessProfile.offer || offer || ''}
קהל יעד: ${businessProfile.target_audience || audience || ''}
בעיה שנפתרת: ${businessProfile.problem_solved || ''}`
    : `כותרת: ${title}\nמטרה: ${goal}\nקהל יעד: ${audience}\nהצעה: ${offer}`;

  const prompt = {
    system: 'אתה מומחה לבניית דפי נחיתה בעברית. צור HTML מלא, מעוצב, RTL, responsive. השתמש ב-Tailwind CSS מ-CDN. כתוב רק HTML — ללא הסברים, ללא markdown.',
    user: `צור דף נחיתה מקצועי ב-HTML עבור:

${bpContext}

מטרת הדף: ${goal || 'יצירת לידים'}
כותרת הדף: ${title}

דרישות:
- HTML מלא כולל <!DOCTYPE html>, <head> עם Tailwind CDN, <body>
- כיוון RTL, שפה עברית
- עיצוב מודרני ומשכנע
- כולל: כותרת ראשית, תיאור הצעת ערך, יתרונות (3-4), טופס יצירת קשר פשוט
- כפתור CTA בולט
- mobile-friendly`,
  };

  try {
    const raw = await OpenRouterAdapter.execute('creative', prompt, {
      model: 'anthropic/claude-sonnet-4-5',
      temperature: 0.7,
      max_tokens: 4000,
    });

    const html = raw.choices?.[0]?.message?.content || '';
    if (!html.includes('<html') && !html.includes('<!DOCTYPE')) {
      return fail('AI_ERROR', 'AI did not return valid HTML', 500);
    }

    const { assetId } = await saveAsset({
      userId: user.id,
      html,
      title: title.trim(),
      composeResult: { type: 'landing_page_html' },
      ttlDays: 365,
    });

    return ok({ id: assetId, title: title.trim() });
  } catch (err) {
    console.error('[generate-content] error:', err);
    return fail('GENERATE_FAILED', err.message || 'שגיאה ביצירת הדף', 500);
  }
};
