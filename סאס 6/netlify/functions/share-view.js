'use strict';
/**
 * share-view.js
 * GET /.netlify/functions/share-view?token=xxx
 * Public endpoint — no auth required
 * Returns the shared preview data
 */

const { createClient } = require('@supabase/supabase-js');

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };
  if (event.httpMethod !== 'GET')  return { statusCode: 405, body: 'Method Not Allowed' };

  const shareToken = event.queryStringParameters?.token;
  if (!shareToken) return { statusCode: 400, body: JSON.stringify({ error: 'token required' }) };

  const supabase = db();
  const { data: share, error } = await supabase
    .from('share_tokens')
    .select('token, share_type, resource_id, title, preview_data, views, expires_at, created_at')
    .eq('token', shareToken)
    .maybeSingle();

  if (error || !share) return { statusCode: 404, body: JSON.stringify({ error: 'Share not found' }) };
  if (share.expires_at && new Date(share.expires_at) < new Date()) {
    return { statusCode: 410, body: JSON.stringify({ error: 'Share link expired' }) };
  }

  // Increment view count (fire-and-forget)
  supabase.from('share_tokens').update({ views: (share.views || 0) + 1 }).eq('token', shareToken).then(() => {});

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, share }),
  };
};
