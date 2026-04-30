'use strict';
/**
 * quick-analyze.js
 * POST /api/quick-analyze
 * Body: { url: string }
 * Returns instant URL analysis for onboarding wizard (60-second value).
 * No auth required — pre-login analysis.
 */

const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const http  = require('http');

const CHECKS = [
  { id: 'https',        weight: 10, label: 'חיבור מאובטח (HTTPS)',         tip: 'הוסף SSL לדף שלך' },
  { id: 'speed',        weight: 20, label: 'מהירות טעינה',                  tip: 'דחוס תמונות והסר סקריפטים לא נחוצים' },
  { id: 'cta_visible',  weight: 25, label: 'כפתור CTA ברור',                tip: 'הוסף כפתור גדול ובולט בחלק העליון' },
  { id: 'mobile',       weight: 20, label: 'מותאם למובייל',                  tip: 'וודא שהדף נראה טוב בפלאפון' },
  { id: 'form',         weight: 15, label: 'טופס לידים',                    tip: 'הוסף טופס קצר לאיסוף לידים' },
  { id: 'headline',     weight: 10, label: 'כותרת ברורה',                   tip: 'נסח כותרת שמסבירה מה אתה מציע' },
];

function fetchUrl(url) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ ok: false, ms: 9999, html: '' }), 5000);
    const start   = Date.now();
    const lib     = url.startsWith('https') ? https : http;
    try {
      lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 CampaignAI-Analyzer/1.0' } }, (res) => {
        clearTimeout(timeout);
        const ms = Date.now() - start;
        let html = '';
        res.on('data', chunk => { html += chunk; if (html.length > 50000) html = html.slice(0, 50000); });
        res.on('end',  () => resolve({ ok: res.statusCode < 400, ms, html, status: res.statusCode }));
      }).on('error', () => { clearTimeout(timeout); resolve({ ok: false, ms: 9999, html: '' }); });
    } catch {
      clearTimeout(timeout);
      resolve({ ok: false, ms: 9999, html: '' });
    }
  });
}

function analyzeHtml(html, ms, isHttps) {
  const h = html.toLowerCase();
  const scores = {};

  scores.https = isHttps ? 10 : 0;
  scores.speed = ms < 1500 ? 20 : ms < 3000 ? 12 : ms < 5000 ? 5 : 0;

  // CTA detection: button with common action words
  const ctaRx = /\b(הזמן|הירשם|קנה|נסה|התחיל|register|signup|buy|order|start|get started|join|book|schedule|contact|צור קשר|שלח|submit)\b/i;
  scores.cta_visible = (/<button|<a[^>]+btn|class="[^"]*btn/i.test(html) && ctaRx.test(html)) ? 25 : 0;

  // Mobile: viewport meta
  scores.mobile = /name=["']viewport["']/i.test(html) ? 20 : 0;

  // Form
  scores.form = /<form|<input[^>]+type=["']?(email|text|tel)/i.test(html) ? 15 : 0;

  // Headline: h1 or og:title
  scores.headline = (/<h1/i.test(html) || /og:title/i.test(html)) ? 10 : 0;

  const total = Object.values(scores).reduce((a, b) => a + b, 0);

  const issues = CHECKS
    .filter(c => !scores[c.id])
    .map(c => ({ id: c.id, label: c.label, tip: c.tip, points: c.weight }));

  const passed = CHECKS
    .filter(c => scores[c.id] > 0)
    .map(c => c.label);

  return { total, scores, issues, passed };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let url;
  try {
    const body = JSON.parse(event.body || '{}');
    url = (body.url || '').trim();
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!url) return { statusCode: 400, body: JSON.stringify({ error: 'url required' }) };

  // Normalize URL
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const isHttps = url.startsWith('https');

  const { ok, ms, html } = await fetchUrl(url);

  if (!ok && !html) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        score: 0,
        issues: CHECKS.map(c => ({ id: c.id, label: c.label, tip: c.tip, points: c.weight })),
        passed: [],
        loadMs: ms,
        message: 'לא ניתן לגשת לדף. ודא שהכתובת נכונה.',
      }),
    };
  }

  const { total, issues, passed } = analyzeHtml(html, ms, isHttps);
  const grade = total >= 80 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : 'D';
  const topFix = issues.sort((a, b) => b.points - a.points)[0] || null;

  // Save to Supabase for later use (fire-and-forget, no auth)
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    await supabase.from('quick_analysis_cache').upsert(
      { url, score: total, grade, issues: JSON.stringify(issues), analyzed_at: new Date().toISOString() },
      { onConflict: 'url', ignoreDuplicates: false }
    );
  } catch { /* non-critical */ }

  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: true, score: total, grade, issues, passed, loadMs: ms, topFix }),
  };
};
