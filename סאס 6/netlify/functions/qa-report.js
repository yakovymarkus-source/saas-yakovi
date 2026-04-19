'use strict';
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  const { reportId, jobId } = event.queryStringParameters || {};
  if (!reportId && !jobId) return { statusCode: 400, body: JSON.stringify({ error: 'reportId or jobId required' }) };

  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabaseAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  let query = db.from('qa_reports').select('*').eq('user_id', user.id);
  if (reportId) query = query.eq('id', reportId);
  else          query = query.eq('job_id', jobId);

  const { data: report, error } = await query.single();
  if (error || !report) return { statusCode: 404, body: JSON.stringify({ error: 'QA report not found' }) };

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ report }),
  };
};
