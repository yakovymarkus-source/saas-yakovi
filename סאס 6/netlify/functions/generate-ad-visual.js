'use strict';
require('./_shared/env');

const { ok, fail, options } = require('./_shared/http');
const { requireAuth }       = require('./_shared/auth');
const { parseJsonBody }     = require('./_shared/request');

/**
 * POST /generate-ad-visual
 * Body: { platform, type, offer, audience, deal, brand }
 * Returns: { imageUrl, headline, subtext, cta, platform }
 *
 * Step 1: Claude generates an optimized DALL-E prompt + Hebrew ad copy
 * Step 2: DALL-E 3 generates the actual ad image
 */

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST only', 405);

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail('UNAUTHORIZED', e.message, 401); }

  let body;
  try { body = parseJsonBody(event); } catch { return fail('BAD_REQUEST', 'invalid JSON', 400); }

  const { platform = 'facebook', type = 'conversion', offer = '', audience = '', deal = '', brand = '' } = body;
  if (!offer) return fail('BAD_REQUEST', 'offer is required', 400);

  // Read API keys fresh from .env to bypass netlify dev caching
  let anthropicKey = process.env.ANTHROPIC_API_KEY || '';
  let openaiKey    = process.env.OPENAI_API_KEY    || '';
  try {
    const _fs = require('node:fs'), _path = require('node:path');
    const _envFile = _path.resolve(__dirname, '../..', '.env');
    if (_fs.existsSync(_envFile)) {
      for (const _line of _fs.readFileSync(_envFile, 'utf8').split('\n')) {
        const _m1 = _line.match(/^ANTHROPIC_API_KEY=(.+)/); if (_m1) anthropicKey = _m1[1].trim();
        const _m2 = _line.match(/^OPENAI_API_KEY=(.+)/);    if (_m2) openaiKey    = _m2[1].trim();
      }
    }
  } catch {}

  if (!anthropicKey) return fail('CONFIGURATION_ERROR', 'ANTHROPIC_API_KEY not set', 500);
  if (!openaiKey)    return fail('CONFIGURATION_ERROR', 'OPENAI_API_KEY not set', 500);

  const platformNames = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google Display', tiktok: 'TikTok' };
  const typeNames     = { awareness: 'brand awareness', lead: 'lead generation', conversion: 'conversion/sales', retargeting: 'retargeting' };
  const dalleSize     = { facebook: '1792x1024', instagram: '1024x1024', google: '1792x1024', tiktok: '1024x1792' };

  // ── Step 1: Claude generates DALL-E prompt + Hebrew copy ──────────────────
  let adCopy;
  try {
    const ctrl1 = new AbortController();
    const t1    = setTimeout(() => ctrl1.abort(), 15000);
    const r1 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl1.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 600,
        system: 'You are an expert advertising creative director. Return ONLY valid JSON, no explanation.',
        messages: [{ role: 'user', content: `Create a professional ${platformNames[platform] || 'Facebook'} ad for: "${offer}". Brand: "${brand || offer}". Audience: "${audience || 'general Israeli audience'}". Goal: ${typeNames[type] || 'conversion'}. Offer/deal: "${deal || 'none'}".

Return JSON:
{
  "dalle_prompt": "A professional, high-quality ${platformNames[platform]} advertisement photo for ${brand || offer}. ${audience ? 'Target audience: ' + audience + '.' : ''} ${deal ? 'Promoting: ' + deal + '.' : ''} Commercial photography style, vibrant colors, clean composition, modern design, no text, no words, no letters in the image. ${platform === 'tiktok' ? 'Vertical format, dynamic, youthful energy.' : platform === 'instagram' ? 'Square format, aesthetic, lifestyle.' : 'Horizontal format, professional, compelling.'} Ultra-realistic, 8K quality.",
  "headline": "כותרת בעברית קצרה ומושכת עד 6 מילים",
  "subtext": "משפט תיאור בעברית 1-2 שורות",
  "cta": "טקסט כפתור קריאה לפעולה"
}` }],
      }),
    });
    clearTimeout(t1);
    const d1   = await r1.json();
    const text = d1?.content?.find(b => b.type === 'text')?.text || '';
    const jm   = text.match(/\{[\s\S]*\}/);
    if (!jm) throw new Error('no JSON in Claude response');
    adCopy = JSON.parse(jm[0]);
  } catch (e) {
    console.error('[generate-ad-visual] step1 error:', e.message);
    return fail('AI_ERROR', `Failed to generate ad copy: ${e.message}`, 500);
  }

  if (!adCopy?.dalle_prompt) return fail('AI_ERROR', 'Claude did not return a DALL-E prompt', 500);

  // ── Step 2: DALL-E 3 generates the image ─────────────────────────────────
  let imageUrl;
  try {
    const ctrl2 = new AbortController();
    const t2    = setTimeout(() => ctrl2.abort(), 30000);
    const r2 = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal: ctrl2.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model:   'dall-e-3',
        prompt:  adCopy.dalle_prompt,
        n:       1,
        size:    dalleSize[platform] || '1024x1024',
        quality: 'standard',
      }),
    });
    clearTimeout(t2);
    if (!r2.ok) {
      const errText = await r2.text().catch(() => '');
      throw new Error(`DALL-E error ${r2.status}: ${errText.slice(0, 200)}`);
    }
    const d2 = await r2.json();
    imageUrl = d2?.data?.[0]?.url;
    if (!imageUrl) throw new Error('No image URL returned');
  } catch (e) {
    console.error('[generate-ad-visual] step2 error:', e.message);
    return fail('AI_ERROR', `Failed to generate image: ${e.message}`, 500);
  }

  return ok({
    imageUrl,
    headline: adCopy.headline || '',
    subtext:  adCopy.subtext  || '',
    cta:      adCopy.cta      || 'למד עוד',
    platform,
    brand:    brand || offer,
  });
};
