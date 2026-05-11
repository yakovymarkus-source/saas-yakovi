'use strict';

/**
 * visual-generator.js — Shared DALL-E ad image generation pipeline
 *
 * Used by:
 *   - generate-ad-visual.js  (direct API endpoint)
 *   - campaigner-chat.js     (chat intent: 'creative')
 *
 * Flow:
 *   1. Claude generates an optimized DALL-E prompt + Hebrew copy
 *   2. DALL-E 3 generates the actual image
 *
 * Returns: { imageUrl, headline, subtext, cta, platform } on success
 *          { error: string }                               on failure
 */

// Load .env for local dev
(function () {
  const fs = require('node:fs'), path = require('node:path');
  const p = path.resolve(__dirname, '../../..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
})();

const PLATFORM_NAMES  = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google Display', tiktok: 'TikTok' };
const TYPE_NAMES      = { awareness: 'brand awareness', lead: 'lead generation', conversion: 'conversion/sales', retargeting: 'retargeting' };
const DALLE_SIZES     = { facebook: '1792x1024', instagram: '1024x1024', google: '1792x1024', tiktok: '1024x1792' };

/**
 * generateAdVisual({ platform, type, offer, audience, deal, brand })
 * @returns {{ imageUrl, headline, subtext, cta, platform } | { error: string }}
 */
async function generateAdVisual({ platform = 'facebook', type = 'conversion', offer, audience = '', deal = '', brand = '' }) {
  if (!offer) return { error: 'offer is required' };

  const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
  const openaiKey    = process.env.OPENAI_API_KEY    || '';
  if (!anthropicKey) return { error: 'ANTHROPIC_API_KEY not set' };
  if (!openaiKey)    return { error: 'OPENAI_API_KEY not set' };

  const pName = PLATFORM_NAMES[platform] || 'Facebook';
  const tName = TYPE_NAMES[type]         || 'conversion';
  const size  = DALLE_SIZES[platform]    || '1024x1024';

  // ── Step 1: Claude generates DALL-E prompt + Hebrew copy ───────────────────
  let adCopy;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 700,
        system:     'You are an expert advertising creative director. Return ONLY valid JSON, no explanation.',
        messages: [{
          role:    'user',
          content: `Create a professional ${pName} ad for: "${offer}".
Brand: "${brand || offer}".
Audience: "${audience || 'general Israeli audience'}".
Goal: ${tName}.
Offer/deal: "${deal || 'none'}".

Return JSON:
{
  "dalle_prompt": "A professional, high-quality ${pName} advertisement photo for ${brand || offer}. ${audience ? 'Target audience: ' + audience + '.' : ''} ${deal ? 'Promoting: ' + deal + '.' : ''} Commercial photography style, vibrant colors, clean composition, modern design, no text, no words, no letters in the image. ${platform === 'tiktok' ? 'Vertical format, dynamic, youthful energy.' : platform === 'instagram' ? 'Square format, aesthetic, lifestyle.' : 'Horizontal format, professional, compelling.'} Ultra-realistic, 8K quality.",
  "headline": "כותרת בעברית קצרה ומושכת עד 6 מילים",
  "subtext": "משפט תיאור בעברית 1-2 שורות",
  "cta": "טקסט כפתור קריאה לפעולה"
}`,
        }],
      }),
    });
    clearTimeout(timer);
    const data = await res.json();
    const text = data?.content?.find(b => b.type === 'text')?.text || '';
    const jm   = text.match(/\{[\s\S]*\}/);
    if (!jm) throw new Error('no JSON in Claude response');
    adCopy = JSON.parse(jm[0]);
  } catch (e) {
    console.error('[visual-generator] step1 error:', e.message);
    return { error: `Failed to generate ad copy: ${e.message}` };
  }

  if (!adCopy?.dalle_prompt) return { error: 'Claude did not return a DALL-E prompt' };

  // ── Step 2: DALL-E 3 generates the image ──────────────────────────────────
  let imageUrl;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model:   'dall-e-3',
        prompt:  adCopy.dalle_prompt,
        n:       1,
        size,
        quality: 'standard',
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`DALL-E error ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    imageUrl = data?.data?.[0]?.url;
    if (!imageUrl) throw new Error('No image URL returned');
  } catch (e) {
    console.error('[visual-generator] step2 error:', e.message);
    return { error: `Failed to generate image: ${e.message}` };
  }

  // ── Step 3: Save to Supabase Storage for a permanent URL ──────────────────
  // DALL-E URLs expire in ~1 hour — Storage URL is permanent.
  const permanentUrl = await _saveImageToStorage(imageUrl, platform);

  return {
    imageUrl: permanentUrl,
    headline: adCopy.headline || '',
    subtext:  adCopy.subtext  || '',
    cta:      adCopy.cta      || 'למד עוד',
    platform,
    size,
  };
}

/**
 * _saveImageToStorage — download DALL-E image and upload to Supabase Storage.
 * Falls back to the original DALL-E URL on any error.
 */
async function _saveImageToStorage(dalleUrl, platform) {
  try {
    const { getAdminClient } = require('./supabase');
    const sb = getAdminClient();

    // Download the image from DALL-E (temporary URL, expires in ~1h)
    const imgRes = await fetch(dalleUrl, { signal: AbortSignal.timeout(15000) });
    if (!imgRes.ok) return dalleUrl;

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const fileName = `ad-images/${Date.now()}-${platform}.png`;

    const { error } = await sb.storage
      .from('generated-assets')
      .upload(fileName, buffer, { contentType: 'image/png', upsert: false });

    if (error) {
      console.warn('[visual-generator] storage upload failed (non-fatal):', error.message);
      return dalleUrl;
    }

    const { data } = sb.storage.from('generated-assets').getPublicUrl(fileName);
    return data?.publicUrl || dalleUrl;
  } catch (e) {
    console.warn('[visual-generator] storage save failed (non-fatal):', e.message);
    return dalleUrl; // always fall back to original URL
  }
}

/**
 * detectPlatform(message) — extract platform from Hebrew/English user message
 * Returns: 'facebook' | 'instagram' | 'tiktok' | 'google' | null
 */
function detectPlatform(message) {
  const m = (message || '').toLowerCase();
  if (/פייסבוק|facebook|\bfb\b/.test(m))          return 'facebook';
  if (/אינסטגרם|instagram|\binsta\b/.test(m))      return 'instagram';
  if (/טיקטוק|tiktok|\btiktok\b/.test(m))          return 'tiktok';
  if (/גוגל|google|display|דיספליי/.test(m))       return 'google';
  return null;
}

/**
 * detectAdType(message) — map intent keywords to DALL-E ad type
 */
function detectAdType(message) {
  const m = (message || '').toLowerCase();
  if (/ריטארגט|retarget/.test(m))               return 'retargeting';
  if (/ליד|lead|לידים/.test(m))                 return 'lead';
  if (/מודעות מודעות|awareness|מיתוג/.test(m))  return 'awareness';
  return 'conversion';
}

module.exports = { generateAdVisual, detectPlatform, detectAdType };
