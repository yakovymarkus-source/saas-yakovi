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
  const LOG = (msg) => console.log(`[visual-generator] ${new Date().toISOString()} ${msg}`);
  const ERR = (msg) => console.error(`[visual-generator] ${new Date().toISOString()} ERROR: ${msg}`);

  LOG(`START: platform=${platform}, type=${type}, offer="${offer.slice(0,30)}..."`);

  if (!offer) {
    ERR('offer is required');
    return { error: 'offer is required' };
  }

  const openrouterKey = process.env.OPENROUTER_API_KEY || '';
  const anthropicKey  = process.env.ANTHROPIC_API_KEY  || '';
  const openaiKey     = process.env.OPENAI_API_KEY     || '';

  LOG(`Keys status: OpenRouter=${openrouterKey ? '✓' : '✗'}, Anthropic=${anthropicKey ? '✓' : '✗'}, OpenAI=${openaiKey ? '✓' : '✗'}`);

  if (!openrouterKey && !anthropicKey) {
    ERR('OPENROUTER_API_KEY or ANTHROPIC_API_KEY not set');
    return { error: 'OPENROUTER_API_KEY or ANTHROPIC_API_KEY not set' };
  }
  if (!openaiKey) {
    ERR('OPENAI_API_KEY not set');
    return { error: 'OPENAI_API_KEY not set' };
  }

  const pName = PLATFORM_NAMES[platform] || 'Facebook';
  const tName = TYPE_NAMES[type]         || 'conversion';
  const size  = DALLE_SIZES[platform]    || '1024x1024';

  LOG(`Platform: ${pName} (${size}), Type: ${tName}`);

  // ── Step 1: Claude generates DALL-E prompt + Hebrew copy ───────────────────
  LOG('STEP 1: Generating DALL-E prompt with Claude...');
  let adCopy;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);

    const useOpenRouter = !!openrouterKey;
    const apiUrl = useOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.anthropic.com/v1/messages';
    const model = useOpenRouter
      ? (process.env.OPENROUTER_DEFAULT_MODEL || 'anthropic/claude-sonnet-4-5')
      : (process.env.CLAUDE_MODEL || 'claude-sonnet-4-6');

    LOG(`Using ${useOpenRouter ? 'OpenRouter' : 'Anthropic'} API, model: ${model}`);

    const systemPrompt = 'You are an expert advertising creative director. Return ONLY valid JSON, no explanation.';
    const userPrompt   = `Create a professional ${pName} ad for: "${offer}".
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
}`;

    const headers = { 'Content-Type': 'application/json' };
    let body;
    if (useOpenRouter) {
      headers['Authorization'] = `Bearer ${openrouterKey.slice(0,10)}...`;
      body = { model, max_tokens: 700, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] };
    } else {
      headers['x-api-key'] = `${anthropicKey.slice(0,10)}...`;
      headers['anthropic-version'] = '2023-06-01';
      body = { model, max_tokens: 700, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] };
    }

    LOG(`Calling ${apiUrl}...`);
    const res = await fetch(apiUrl, { method: 'POST', signal: ctrl.signal, headers, body: JSON.stringify(body) });
    clearTimeout(timer);

    LOG(`Response status: ${res.status}`);
    if (!res.ok) {
      const errBody = await res.text().catch(() => 'no body');
      ERR(`AI API error ${res.status}: ${errBody.slice(0, 200)}`);
      throw new Error(`AI API error ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    LOG(`Received response, parsing...`);

    const text = useOpenRouter
      ? (data?.choices?.[0]?.message?.content || '')
      : (data?.content?.find(b => b.type === 'text')?.text || '');

    LOG(`Claude response length: ${text.length} chars`);

    const jm = text.match(/\{[\s\S]*\}/);
    if (!jm) {
      ERR(`No JSON found in response: ${text.slice(0,100)}`);
      throw new Error('no JSON in AI response');
    }

    adCopy = JSON.parse(jm[0]);
    LOG(`Parsed ad copy successfully: headline="${adCopy.headline}", dalle_prompt length=${adCopy.dalle_prompt?.length}`);
  } catch (e) {
    ERR(`Step 1 failed: ${e.message}`);
    return { error: `Failed to generate ad copy: ${e.message}` };
  }

  if (!adCopy?.dalle_prompt) {
    ERR('Claude did not return a DALL-E prompt');
    return { error: 'Claude did not return a DALL-E prompt' };
  }

  // ── Step 2: DALL-E 3 generates the image ──────────────────────────────────
  LOG('STEP 2: Calling DALL-E 3 to generate image...');
  let imageUrl;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);

    LOG(`DALL-E prompt: "${adCopy.dalle_prompt.slice(0, 80)}..."`);
    LOG(`Image size: ${size}, Calling https://api.openai.com/v1/images/generations...`);

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${openaiKey.slice(0,10)}...`,
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

    LOG(`DALL-E response status: ${res.status}`);
    if (!res.ok) {
      const errText = await res.text().catch(() => 'no body');
      ERR(`DALL-E error ${res.status}: ${errText.slice(0, 200)}`);
      throw new Error(`DALL-E error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    imageUrl = data?.data?.[0]?.url;

    if (!imageUrl) {
      ERR(`No image URL in response: ${JSON.stringify(data).slice(0, 100)}`);
      throw new Error('No image URL returned');
    }

    LOG(`Image generated successfully, URL length: ${imageUrl.length}`);
  } catch (e) {
    ERR(`Step 2 failed: ${e.message}`);
    return { error: `Failed to generate image: ${e.message}` };
  }

  // ── Step 3: Save to Supabase Storage for a permanent URL ──────────────────
  LOG('STEP 3: Saving image to Supabase Storage...');
  const permanentUrl = await _saveImageToStorage(imageUrl, platform);

  const result = {
    imageUrl: permanentUrl,
    headline: adCopy.headline || '',
    subtext:  adCopy.subtext  || '',
    cta:      adCopy.cta      || 'למד עוד',
    platform,
    size,
  };

  LOG(`SUCCESS: Ad visual generated. URL: ${permanentUrl.slice(0,50)}..., Headline: "${result.headline}"`);
  return result;
}

/**
 * _saveImageToStorage — download DALL-E image and upload to Supabase Storage.
 * Falls back to the original DALL-E URL on any error.
 */
async function _saveImageToStorage(dalleUrl, platform) {
  const LOG = (msg) => console.log(`[visual-generator.storage] ${new Date().toISOString()} ${msg}`);
  const ERR = (msg) => console.error(`[visual-generator.storage] ${new Date().toISOString()} ERROR: ${msg}`);

  LOG(`Saving image from DALL-E to Supabase Storage...`);
  try {
    LOG('Loading Supabase admin client...');
    const { getAdminClient } = require('./supabase');
    const sb = getAdminClient();

    // Download the image from DALL-E (temporary URL, expires in ~1h)
    LOG(`Downloading image from DALL-E URL (${dalleUrl.slice(0,50)}...)`);
    const imgRes = await fetch(dalleUrl, { signal: AbortSignal.timeout(15000) });
    if (!imgRes.ok) {
      ERR(`Failed to download image: ${imgRes.status}. Using original URL.`);
      return dalleUrl;
    }

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const fileName = `ad-images/${Date.now()}-${platform}.png`;
    LOG(`Downloaded ${buffer.length} bytes. Uploading as ${fileName}...`);

    const { error } = await sb.storage
      .from('generated-assets')
      .upload(fileName, buffer, { contentType: 'image/png', upsert: false });

    if (error) {
      ERR(`Storage upload failed (non-fatal): ${error.message}. Using original URL.`);
      return dalleUrl;
    }

    LOG(`Uploaded to storage. Generating public URL...`);
    const { data } = sb.storage.from('generated-assets').getPublicUrl(fileName);
    const publicUrl = data?.publicUrl || dalleUrl;
    LOG(`Public URL: ${publicUrl.slice(0,50)}...`);
    return publicUrl;
  } catch (e) {
    ERR(`Storage save failed (non-fatal): ${e.message}. Falling back to DALL-E URL.`);
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
