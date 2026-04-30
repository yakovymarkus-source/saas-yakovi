'use strict';
/**
 * share-create.js
 * POST /.netlify/functions/share-create
 * Body: { shareType, resourceId, title, previewData, expiresInDays? }
 * Returns: { token, url, whatsappUrl }
 */

const { createClient } = require('@supabase/supabase-js');

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const token = (event.headers['authorization'] || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await anon.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { shareType, resourceId, title, previewData, expiresInDays } = body;
  if (!shareType || !resourceId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'shareType + resourceId required' }) };
  }

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
    : null;

  const supabase = db();
  const { data: share, error } = await supabase
    .from('share_tokens')
    .insert({
      user_id:      user.id,
      share_type:   shareType,
      resource_id:  resourceId,
      title:        title || 'שיתוף תוצאות',
      preview_data: previewData || {},
      expires_at:   expiresAt,
    })
    .select('token')
    .single();

  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

  const appUrl   = process.env.APP_URL || process.env.URL || '';
  const shareUrl = `${appUrl}/share/${share.token}`;

  // WhatsApp deep link
  const waText    = encodeURIComponent(`${title || 'תוצאות הקמפיין שלי'} 🎯\n${shareUrl}`);
  const whatsappUrl = `https://wa.me/?text=${waText}`;

  // Generic social share links
  const twitterUrl  = `https://twitter.com/intent/tweet?text=${waText}`;

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      token:        share.token,
      url:          shareUrl,
      whatsappUrl,
      twitterUrl,
    }),
  };
};
