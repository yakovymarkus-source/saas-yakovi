'use strict';
require('./_shared/env');

const { ok, fail, options } = require('./_shared/http');
const { requireAuth } = require('./_shared/auth');
const { parseJsonBody } = require('./_shared/request');
const { getAdminClient } = require('./_shared/supabase');

/**
 * POST /save-copy-variants
 * Save copy variants as text file to assets table
 * Body: { copyVariants: [{label, headline, body, cta}, ...] }
 */
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();
  if (event.httpMethod !== 'POST') return fail('METHOD_NOT_ALLOWED', 'POST only', 405);

  let user;
  try { user = await requireAuth(event); } catch (e) { return fail('UNAUTHORIZED', e.message, 401); }

  let body;
  try { body = parseJsonBody(event); } catch { return fail('BAD_REQUEST', 'invalid JSON', 400); }

  const { copyVariants } = body;
  if (!Array.isArray(copyVariants) || copyVariants.length === 0) {
    return fail('BAD_REQUEST', 'copyVariants array is required', 400);
  }

  try {
    // Create formatted text content
    const textContent = copyVariants
      .map(v => `📌 ${v.label || 'וריאציה'}\n\n${v.headline || ''}\n\n${v.body || ''}\n\n${v.cta || ''}`)
      .join('\n\n' + '='.repeat(50) + '\n\n');

    const sb = getAdminClient();
    const fileName = `copywriting/${Date.now()}-variants.txt`;

    // Upload to storage
    const { error: uploadErr } = await sb.storage
      .from('generated-assets')
      .upload(fileName, new TextEncoder().encode(textContent), { contentType: 'text/plain' });

    if (uploadErr) throw uploadErr;

    // Get public URL
    const { data: urlData } = sb.storage.from('generated-assets').getPublicUrl(fileName);
    const fileUrl = urlData.publicUrl;

    // Save to assets table
    const { error: dbErr } = await sb.from('assets').insert({
      user_id: user.id,
      name: `קופי וריאציות — ${new Date().toLocaleDateString('he-IL')}`,
      type: 'document',
      category: 'copywriting',
      url: fileUrl,
      size_bytes: textContent.length,
    });

    if (dbErr) throw dbErr;

    return ok({ message: 'Copy variants saved successfully', url: fileUrl });
  } catch (err) {
    console.error('[save-copy-variants]', err.message);
    return fail('DATABASE_ERROR', 'Failed to save copy variants', 500);
  }
};
