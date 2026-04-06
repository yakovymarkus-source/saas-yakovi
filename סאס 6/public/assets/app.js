/* ════════════════════════════════════════════════════════════════
   CampaignAI — Single-Page Application
   Multi-tenant: every user's data is isolated via their own OAuth tokens.
   API calls go through Netlify Functions (never direct from .env keys).
   ════════════════════════════════════════════════════════════════ */

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
  supabaseUrl: window.__SUPABASE_URL__      || '',
  supabaseKey: window.__SUPABASE_ANON_KEY__ || '',
  apiBase:     '/.netlify/functions',
};

// ── Supabase client ───────────────────────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  user:              null,
  profile:           null,
  subscription:      null,
  campaigns:         [],
  integrations:      [],    // [{provider, connection_status, last_sync_at, account_name}]
  liveStats:         {},    // { google_ads: {metrics,fetchedAt}, ga4: {...}, meta: {...} }
  liveStatsLoading:  false,
  currentPage:       'dashboard',
  currentCampaignId: null,
  accessToken:       null,
};

// ── Router ────────────────────────────────────────────────────────────────────
const routes = {
  dashboard:    renderDashboard,
  campaigns:    renderCampaigns,
  integrations: renderIntegrations,
  billing:      renderBilling,
  settings:     renderSettings,
};

function navigate(page, params = {}) {
  state.currentPage = page;
  Object.assign(state, params);
  render();
}

// ── API helper ────────────────────────────────────────────────────────────────
// All requests carry the user's Supabase JWT.
// Netlify Functions validate this token and look up the user's own OAuth credentials.
// No .env API keys are ever exposed to or used by the frontend.
async function api(method, path, body) {
  const token = state.accessToken || '';
  const res = await fetch(`${CONFIG.apiBase}/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json.data ?? json;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container') || (() => {
    const el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    document.body.appendChild(el);
    return el;
  })();
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function renderAuth() {
  document.getElementById('app').innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-logo">
          <h1>🧠 CampaignAI</h1>
          <p>ניתוח קמפיינים חכם בעזרת AI</p>
        </div>
        <div class="auth-tabs">
          <div class="auth-tab active" data-tab="login">כניסה</div>
          <div class="auth-tab" data-tab="signup">הרשמה</div>
        </div>
        <form id="auth-form">
          <div class="form-group">
            <label class="form-label">אימייל</label>
            <input class="form-input" type="email" id="auth-email" placeholder="you@example.com" required />
          </div>
          <div class="form-group" id="name-group" style="display:none">
            <label class="form-label">שם מלא</label>
            <input class="form-input" type="text" id="auth-name" placeholder="ישראל ישראלי" />
          </div>
          <div class="form-group">
            <label class="form-label">סיסמה</label>
            <input class="form-input" type="password" id="auth-password" placeholder="לפחות 8 תווים" required />
          </div>
          <div id="auth-error" class="form-error" style="display:none"></div>
          <button type="submit" class="btn btn-primary mt-4" id="auth-submit">כניסה</button>
        </form>
      </div>
    </div>`;

  let mode = 'login';
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.tab;
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.getElementById('name-group').style.display = mode === 'signup' ? '' : 'none';
      document.getElementById('auth-submit').textContent  = mode === 'signup' ? 'הרשמה' : 'כניסה';
    });
  });

  document.getElementById('auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn   = document.getElementById('auth-submit');
    const email = document.getElementById('auth-email').value.trim();
    const pass  = document.getElementById('auth-password').value;
    const name  = document.getElementById('auth-name')?.value.trim();
    const errEl = document.getElementById('auth-error');
    btn.disabled = true; btn.textContent = 'טוען...';
    errEl.style.display = 'none';
    try {
      if (mode === 'signup') {
        const { error } = await sb.auth.signUp({ email, password: pass, options: { data: { name } } });
        if (error) throw error;
        toast('נרשמת בהצלחה! בדוק את האימייל לאימות.', 'success');
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
      }
    } catch (err) {
      errEl.textContent = err.message || 'שגיאה בכניסה';
      errEl.style.display = '';
      btn.disabled = false; btn.textContent = mode === 'signup' ? 'הרשמה' : 'כניסה';
    }
  });
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function renderShell(content) {
  const navItems = [
    { id: 'dashboard',    icon: '📊', label: 'דשבורד' },
    { id: 'campaigns',    icon: '📢', label: 'קמפיינים' },
    { id: 'integrations', icon: '🔌', label: 'אינטגרציות' },
    { id: 'billing',      icon: '💳', label: 'חיוב' },
    { id: 'settings',     icon: '⚙️', label: 'הגדרות' },
  ];
  const initials = (state.profile?.name || state.user?.email || '?').charAt(0).toUpperCase();
  document.getElementById('app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-logo">Campaign<span>AI</span></div>
        <nav class="sidebar-nav">
          ${navItems.map(n => `
            <div class="nav-item ${state.currentPage === n.id ? 'active' : ''}" data-page="${n.id}">
              <span class="nav-icon">${n.icon}</span> ${n.label}
            </div>`).join('')}
        </nav>
        <div class="sidebar-footer">
          <div class="flex items-center gap-2">
            <div class="user-avatar">${initials}</div>
            <div style="flex:1;overflow:hidden">
              <div class="text-sm font-semibold" style="color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.profile?.name || 'משתמש'}</div>
              <div class="text-xs text-muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${state.user?.email || ''}</div>
            </div>
            <button onclick="handleLogout()" class="btn btn-sm btn-secondary" style="font-size:0.75rem">יציאה</button>
          </div>
        </div>
      </aside>
      <main class="main-content" id="page-content">${content}</main>
    </div>`;
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.page));
  });
}

async function handleLogout() {
  await sb.auth.signOut();
  state = { user: null, profile: null, subscription: null, campaigns: [], integrations: [], liveStats: {}, liveStatsLoading: false, currentPage: 'dashboard', currentCampaignId: null, accessToken: null };
  renderAuth();
}

// ── Live stats loader ─────────────────────────────────────────────────────────
/**
 * Fetch live metrics for each connected provider via /get-ads-data.
 * This calls through the Netlify Function using the user's JWT.
 * The function decrypts the user's own OAuth tokens server-side —
 * no API keys are ever in the frontend or .env.
 */
async function loadLiveStats(forceRefresh = false) {
  const connectedProviders = (state.integrations || [])
    .filter(i => i.connection_status === 'active')
    .map(i => i.provider);

  if (!connectedProviders.length) return;

  state.liveStatsLoading = true;
  const results = {};

  await Promise.allSettled(
    connectedProviders.map(async (provider) => {
      try {
        const data = await api('POST', 'get-ads-data', { provider, forceRefresh });
        results[provider] = data;
      } catch (err) {
        results[provider] = { error: err.message };
      }
    })
  );

  state.liveStats        = results;
  state.liveStatsLoading = false;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let analysis = [];
  try {
    const { data } = await sb.from('analysis_results')
      .select('*')
      .eq('user_id', state.user.id)
      .order('created_at', { ascending: false })
      .limit(5);
    analysis = data || [];
  } catch {}

  // Load integrations list if not already loaded
  if (!state.integrations.length) {
    try {
      const res = await api('GET', 'integration-connect');
      state.integrations = Array.isArray(res) ? res : [];
    } catch {}
  }

  const plan      = state.subscription?.plan || 'free';
  const planBadge = { free: 'badge-gray', starter: 'badge-blue', pro: 'badge-green', agency: 'badge-green' };
  const connectedCount = state.integrations.filter(i => i.connection_status !== 'revoked').length;

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">שלום, ${state.profile?.name || 'משתמש'}! 👋</h1>
        <p class="page-subtitle">הנה סקירת הביצועים שלך</p>
      </div>
      <span class="badge ${planBadge[plan] || 'badge-gray'}">${plan.toUpperCase()}</span>
    </div>

    ${!state.profile?.onboarding_completed ? renderOnboarding() : ''}

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">קמפיינים פעילים</div>
        <div class="stat-value">${state.campaigns.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">ניתוחים השבוע</div>
        <div class="stat-value">${analysis.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">ציון ממוצע</div>
        <div class="stat-value">${analysis.length ? Math.round(analysis.reduce((s, a) => s + (a.scores?.overall || 0), 0) / analysis.length) : '—'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">אינטגרציות פעילות</div>
        <div class="stat-value">${connectedCount}</div>
      </div>
    </div>

    ${connectedCount > 0 ? `
    <div class="card mb-4">
      <div class="card-title flex items-center justify-between">
        <span>📡 נתונים חיים</span>
        <button class="btn btn-sm btn-secondary" onclick="refreshLiveStats()" id="refresh-stats-btn">רענן</button>
      </div>
      <div id="live-stats-container">${renderLiveStatsContent()}</div>
    </div>` : ''}

    ${analysis.length > 0 ? `
    <div class="card">
      <div class="card-title">ניתוחים אחרונים</div>
      <div class="campaign-list">
        ${analysis.map(a => {
          const camp = state.campaigns.find(c => c.id === a.campaign_id);
          return `
          <div class="campaign-item" onclick="showCampaignDetail('${a.campaign_id}')" style="cursor:pointer">
            <div>
              <div class="campaign-name">${camp?.name || a.campaign_id}</div>
              <div class="campaign-meta">${new Date(a.created_at).toLocaleDateString('he-IL')}</div>
            </div>
            <div class="flex items-center gap-2">
              ${renderScoreBadge(a.scores?.overall || 0)}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : `
    <div class="card text-center" style="padding:3rem">
      <div style="font-size:3rem;margin-bottom:1rem">🚀</div>
      <h3 class="font-semibold mb-2">אין עדיין ניתוחים</h3>
      <p class="text-muted mb-4">חבר את חשבונות הפרסום שלך וצור קמפיין ראשון</p>
      <button class="btn btn-primary" style="width:auto;padding:0.625rem 1.5rem" onclick="navigate('integrations')">חבר אינטגרציות</button>
    </div>`}
  `);

  // Fetch live stats in background after render
  if (connectedCount > 0 && !state.liveStatsLoading) {
    loadLiveStats().then(() => {
      const container = document.getElementById('live-stats-container');
      if (container) container.innerHTML = renderLiveStatsContent();
    });
  }
}

function renderLiveStatsContent() {
  const providers = {
    google_ads: { label: 'Google Ads', icon: '🟢' },
    ga4:        { label: 'GA4',        icon: '📈' },
    meta:       { label: 'Meta Ads',   icon: '🔵' },
  };

  if (state.liveStatsLoading) {
    return '<div class="text-muted text-sm" style="padding:1rem">טוען נתונים חיים...</div>';
  }

  const connected = (state.integrations || []).filter(i => i.connection_status !== 'revoked');
  if (!connected.length) {
    return '<div class="text-muted text-sm" style="padding:1rem">אין אינטגרציות פעילות</div>';
  }

  return `<div class="stats-grid" style="margin-top:0.5rem">
    ${connected.map(integ => {
      const p    = providers[integ.provider] || { label: integ.provider, icon: '🔗' };
      const data = state.liveStats[integ.provider];
      if (!data) {
        return `
          <div class="stat-card" style="min-width:0">
            <div class="stat-label">${p.icon} ${p.label}</div>
            <div class="text-muted text-xs">לא נטען</div>
          </div>`;
      }
      if (data.error) {
        return `
          <div class="stat-card" style="min-width:0">
            <div class="stat-label">${p.icon} ${p.label}</div>
            <div class="text-xs" style="color:#ef4444">${data.error}</div>
          </div>`;
      }

      const metrics = Array.isArray(data.metrics) ? data.metrics : [];
      const totalClicks  = metrics.reduce((s, r) => s + (r.clicks       || 0), 0);
      const totalImpress = metrics.reduce((s, r) => s + (r.impressions   || 0), 0);
      const totalSpend   = metrics.reduce((s, r) => s + (r.spend || r.costMicros / 1e6 || 0), 0);
      const totalConv    = metrics.reduce((s, r) => s + (r.conversions   || 0), 0);

      return `
        <div class="stat-card" style="min-width:0">
          <div class="stat-label">${p.icon} ${p.label}</div>
          <div style="font-size:0.8rem;margin-top:0.5rem">
            <div class="flex justify-between"><span class="text-muted">קליקים</span><strong>${totalClicks.toLocaleString()}</strong></div>
            <div class="flex justify-between"><span class="text-muted">חשיפות</span><strong>${totalImpress.toLocaleString()}</strong></div>
            ${totalSpend > 0 ? `<div class="flex justify-between"><span class="text-muted">הוצאה</span><strong>$${totalSpend.toFixed(0)}</strong></div>` : ''}
            ${totalConv > 0  ? `<div class="flex justify-between"><span class="text-muted">המרות</span><strong>${totalConv.toLocaleString()}</strong></div>` : ''}
          </div>
          <div class="text-xs text-muted" style="margin-top:0.5rem">
            ${data.cached ? '📦 מהמטמון' : '🔄 עכשיו'}
            ${data.fetchedAt ? ' · ' + new Date(data.fetchedAt).toLocaleTimeString('he-IL') : ''}
          </div>
        </div>`;
    }).join('')}
  </div>`;
}

async function refreshLiveStats() {
  const btn = document.getElementById('refresh-stats-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'מרענן...'; }
  const container = document.getElementById('live-stats-container');
  if (container) container.innerHTML = '<div class="text-muted text-sm" style="padding:1rem">טוען נתונים חיים...</div>';
  await loadLiveStats(true);
  if (container) container.innerHTML = renderLiveStatsContent();
  if (btn) { btn.disabled = false; btn.textContent = 'רענן'; }
}

function renderOnboarding() {
  const steps = [
    { label: 'חבר אינטגרציה', desc: 'חבר Google Ads, Meta, או GA4', icon: '🔌' },
    { label: 'צור קמפיין',    desc: 'הוסף קמפיין לניתוח',           icon: '📢' },
    { label: 'הרץ ניתוח',     desc: 'קבל תובנות והמלצות',           icon: '🧠' },
  ];
  return `
    <div class="card mb-4">
      <div class="card-title">🎯 תחילת דרך</div>
      <div class="onboarding-steps">
        ${steps.map((s, i) => `
          <div class="onboarding-step">
            <div class="step-circle">${i + 1}</div>
            <div class="step-content">
              <h3>${s.icon} ${s.label}</h3>
              <p>${s.desc}</p>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderScoreBadge(score) {
  const cls = score >= 70 ? 'badge-green' : score >= 45 ? 'badge-yellow' : 'badge-red';
  return `<span class="badge ${cls}">${score}/100</span>`;
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
async function renderCampaigns() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  try {
    const { data } = await sb.from('campaigns').select('*').eq('owner_user_id', state.user.id).order('created_at', { ascending: false });
    state.campaigns = data || [];
  } catch {}

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">קמפיינים</h1>
        <p class="page-subtitle">נהל ונתח את הקמפיינים שלך</p>
      </div>
      <button class="btn btn-primary" style="width:auto" onclick="showAddCampaignModal()">+ קמפיין חדש</button>
    </div>
    <div class="campaign-list">
      ${state.campaigns.length > 0 ? state.campaigns.map(c => `
        <div class="campaign-item" onclick="showCampaignDetail('${c.id}')">
          <div>
            <div class="campaign-name">${c.name}</div>
            <div class="campaign-meta">נוצר: ${new Date(c.created_at).toLocaleDateString('he-IL')}</div>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();runAnalysis('${c.id}')">הרץ ניתוח</button>
          </div>
        </div>`).join('') : `
        <div class="card text-center" style="padding:3rem">
          <div style="font-size:2.5rem;margin-bottom:1rem">📢</div>
          <p class="text-muted">עדיין אין קמפיינים. הוסף אחד כדי להתחיל.</p>
        </div>`}
    </div>
  `);
}

function showAddCampaignModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h2 class="modal-title">קמפיין חדש</h2>
      <div class="form-group">
        <label class="form-label">שם הקמפיין</label>
        <input class="form-input" id="new-campaign-name" placeholder="למשל: Black Friday 2025" />
      </div>
      <div class="flex gap-2 mt-4">
        <button class="btn btn-primary" onclick="addCampaign()">שמור</button>
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">ביטול</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function addCampaign() {
  const name = document.getElementById('new-campaign-name')?.value.trim();
  if (!name) return;
  const btn = document.querySelector('.modal-box .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'שומר...'; }
  try {
    const campaign = await api('POST', 'create-campaign', { name });
    state.campaigns = [...state.campaigns, campaign];
    document.querySelector('.modal-overlay')?.remove();
    toast('הקמפיין נוצר!', 'success');
    navigate('campaigns');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'שמור'; }
    toast(err.message || 'שגיאה', 'error');
  }
}

async function runAnalysis(campaignId) {
  try {
    toast('מריץ ניתוח...', 'info');
    const job = await api('POST', 'enqueue-sync-job', { campaignId });
    toast('המשימה נקלטה — מושך נתונים חיים ומנתח...', 'success');
    pollJobStatus(job.jobId, campaignId);
  } catch (err) {
    toast(err.message || 'שגיאה בהרצת ניתוח', 'error');
  }
}

async function pollJobStatus(jobId, campaignId) {
  let attempts = 0;
  const poll = async () => {
    attempts++;
    try {
      const { data } = await sb.from('sync_jobs').select('status,result_payload').eq('id', jobId).maybeSingle();
      if (data?.status === 'done') {
        toast('הניתוח הסתיים!', 'success');
        showCampaignDetail(campaignId);
        return;
      }
      if (data?.status === 'failed') {
        toast('הניתוח נכשל', 'error');
        return;
      }
      if (attempts < 20) setTimeout(poll, 3000);
    } catch {}
  };
  setTimeout(poll, 3000);
}

// ── Campaign Detail ───────────────────────────────────────────────────────────
async function showCampaignDetail(campaignId) {
  state.currentCampaignId = campaignId;
  const campaign = state.campaigns.find(c => c.id === campaignId) || { id: campaignId, name: campaignId };
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  let analyses = [], recommendations = [], latestVerdict = null;
  try {
    const [analysisRes, recoRes, decisionRes] = await Promise.all([
      sb.from('analysis_results').select('*').eq('user_id', state.user.id).eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(5),
      sb.from('recommendations').select('*').eq('campaign_id', campaignId).order('priority_score', { ascending: false }).limit(10),
      sb.from('decision_history').select('verdict, reason, confidence, timestamp').eq('campaign_id', campaignId).order('timestamp', { ascending: false }).limit(1),
    ]);
    analyses        = analysisRes.data  || [];
    recommendations = recoRes.data      || [];
    latestVerdict   = decisionRes.data?.[0] || null;
  } catch {}

  const latest = analyses[0];
  const verdictLabel = {
    healthy:           { text: 'בריא',         cls: 'badge-green'  },
    needs_work:        { text: 'דורש שיפור',   cls: 'badge-yellow' },
    critical:          { text: 'קריטי',        cls: 'badge-red'    },
    paused:            { text: 'מושהה',         cls: 'badge-gray'   },
    'no-traffic':      { text: 'אין תנועה',    cls: 'badge-yellow' },
    insufficient_data: { text: 'נתונים חסרים', cls: 'badge-blue'   },
  };
  const scoreLabels = { traffic: 'תנועה', ctr: 'CTR', conversion: 'המרה', roas: 'ROAS', coverage: 'כיסוי' };
  const vl = latestVerdict ? (verdictLabel[latestVerdict.verdict] || { text: latestVerdict.verdict, cls: 'badge-gray' }) : null;

  const scoresHtml = latest?.scores ? `
    <div class="stats-grid" style="margin-bottom:1rem">
      ${Object.entries(latest.scores).filter(([k]) => k !== 'overall').map(([k, v]) =>
        `<div class="stat-card"><div class="stat-label">${scoreLabels[k] || k}</div><div class="stat-value" style="font-size:1.25rem">${v}/100</div></div>`
      ).join('')}
    </div>` : '';

  function urgencyText(u) {
    if (u >= 90) return 'קריטי'; if (u >= 75) return 'דחוף'; if (u >= 60) return 'גבוה'; if (u >= 40) return 'בינוני'; return 'נמוך';
  }

  const recoHtml = recommendations.length ? `
    <div class="card mt-4">
      <div class="card-title">המלצות לפעולה</div>
      <div class="reco-list">
        ${recommendations.map(r => `
          <div style="border-right:3px solid ${r.urgency >= 85 ? '#ef4444' : r.urgency >= 65 ? '#f59e0b' : '#6366f1'};padding-right:0.75rem;margin-bottom:1rem">
            <div style="font-weight:600;margin-bottom:0.25rem">${r.issue}</div>
            <div class="text-sm text-muted" style="margin-bottom:0.25rem">${r.root_cause}</div>
            <div class="text-sm" style="margin-bottom:0.25rem"><strong>פעולה:</strong> ${r.action}</div>
            <div class="text-sm" style="margin-bottom:0.25rem"><strong>תוצאה צפויה:</strong> ${r.expected_impact}</div>
            <div class="flex gap-2 mt-1">
              <span class="badge ${r.urgency >= 85 ? 'badge-red' : r.urgency >= 65 ? 'badge-yellow' : 'badge-blue'}" style="font-size:0.7rem">דחיפות: ${urgencyText(r.urgency)}</span>
              <span class="badge badge-gray" style="font-size:0.7rem">מאמץ: ${r.effort <= 25 ? 'נמוך' : r.effort <= 50 ? 'בינוני' : 'גבוה'}</span>
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  // Raw metrics from latest analysis
  const metricsHtml = latest?.metrics && Object.keys(latest.metrics).length ? `
    <div class="card mt-4">
      <div class="card-title">מדדים גולמיים</div>
      <div class="stats-grid" style="margin-top:0.5rem">
        ${latest.metrics.impressions !== undefined ? `<div class="stat-card"><div class="stat-label">חשיפות</div><div class="stat-value" style="font-size:1rem">${Number(latest.metrics.impressions).toLocaleString()}</div></div>` : ''}
        ${latest.metrics.clicks !== undefined      ? `<div class="stat-card"><div class="stat-label">קליקים</div><div class="stat-value" style="font-size:1rem">${Number(latest.metrics.clicks).toLocaleString()}</div></div>` : ''}
        ${latest.metrics.spend > 0                ? `<div class="stat-card"><div class="stat-label">הוצאה</div><div class="stat-value" style="font-size:1rem">$${Number(latest.metrics.spend).toFixed(0)}</div></div>` : ''}
        ${latest.metrics.conversions > 0          ? `<div class="stat-card"><div class="stat-label">המרות</div><div class="stat-value" style="font-size:1rem">${Number(latest.metrics.conversions).toLocaleString()}</div></div>` : ''}
        ${latest.metrics.roas > 0                 ? `<div class="stat-card"><div class="stat-label">ROAS</div><div class="stat-value" style="font-size:1rem">${Number(latest.metrics.roas).toFixed(2)}x</div></div>` : ''}
        ${latest.metrics.ctr > 0                  ? `<div class="stat-card"><div class="stat-label">CTR</div><div class="stat-value" style="font-size:1rem">${(Number(latest.metrics.ctr) * 100).toFixed(2)}%</div></div>` : ''}
      </div>
    </div>` : '';

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <button class="btn btn-sm btn-secondary mb-2" onclick="navigate('campaigns')">← חזור לקמפיינים</button>
        <h1 class="page-title">${campaign.name}</h1>
        <p class="page-subtitle">ID: ${campaignId}</p>
      </div>
      <button class="btn btn-primary" style="width:auto" onclick="runAnalysis('${campaignId}')">הרץ ניתוח חדש</button>
    </div>

    ${latest ? `
    <div class="card mb-4">
      <div class="card-title flex items-center justify-between">
        <span>ניתוח אחרון</span>
        <span class="text-sm text-muted">${new Date(latest.created_at).toLocaleString('he-IL')}</span>
      </div>
      <div class="flex items-center gap-4 mb-4">
        <div class="score-ring-wrapper">
          <div class="score-ring">
            <svg width="80" height="80" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="#e2e8f0" stroke-width="7"/>
              <circle cx="40" cy="40" r="34" fill="none" stroke="#6366f1" stroke-width="7"
                stroke-dasharray="${(latest.scores?.overall || 0) * 2.136} 213.6"
                stroke-linecap="round"/>
            </svg>
            <div class="score-ring-text">${latest.scores?.overall || 0}</div>
          </div>
          <div>
            <div class="font-bold text-sm">ציון כולל</div>
            <div class="text-xs text-muted">מתוך 100</div>
          </div>
        </div>
        <div class="flex-1">
          ${renderScoreBadge(latest.scores?.overall || 0)}
          ${vl ? `<div class="mt-2"><span class="badge ${vl.cls}">${vl.text}</span></div>` : ''}
          ${latestVerdict?.reason ? `<div class="text-sm text-muted mt-2">${latestVerdict.reason}</div>` : ''}
          <div class="text-xs text-muted mt-2">ביטחון: ${latest.confidence || 0}%</div>
        </div>
      </div>
      ${scoresHtml}
      ${metricsHtml}
      ${recoHtml}
    </div>` : `
    <div class="card text-center" style="padding:3rem">
      <div style="font-size:2.5rem;margin-bottom:1rem">🔍</div>
      <p class="text-muted mb-4">אין עדיין ניתוח לקמפיין הזה.</p>
      <button class="btn btn-primary" style="width:auto;padding:0.625rem 1.5rem" onclick="runAnalysis('${campaignId}')">הרץ ניתוח ראשון</button>
    </div>`}

    ${analyses.length > 1 ? `
    <div class="card">
      <div class="card-title">היסטוריית ניתוחים</div>
      <div class="campaign-list">
        ${analyses.slice(1).map(a => `
          <div class="campaign-item" style="cursor:default">
            <div>
              <div class="campaign-name">${new Date(a.created_at).toLocaleString('he-IL')}</div>
              <div class="campaign-meta">ביטחון: ${a.confidence}%</div>
            </div>
            ${renderScoreBadge(a.scores?.overall || 0)}
          </div>`).join('')}
      </div>
    </div>` : ''}
  `);
}

// ── Integrations ──────────────────────────────────────────────────────────────
/**
 * This page manages the per-user OAuth connections.
 * Clicking "חבר" triggers a full server-side OAuth flow:
 *   1. Frontend calls /oauth-nonce (creates a CSRF token tied to this user)
 *   2. Frontend redirects to Google/Meta consent screen with state={userId, provider, nonce}
 *   3. Provider redirects to /.netlify/functions/oauth-callback-{provider}
 *   4. The callback exchanges the authorization code for tokens SERVER-SIDE
 *   5. Tokens are AES-256-GCM encrypted and stored in user_integrations (Supabase)
 *   6. The user is redirected back to /integrations?connected=<provider>
 *
 * The authorization code and refresh/access tokens NEVER touch the frontend.
 */
async function renderIntegrations() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  try {
    const res = await api('GET', 'integration-connect');
    state.integrations = Array.isArray(res) ? res : [];
  } catch {}

  // Handle OAuth redirect result
  const params = new URLSearchParams(window.location.search);
  if (params.get('connected')) toast(`${params.get('connected')} חובר בהצלחה! 🎉`, 'success');
  if (params.get('error'))     toast(`שגיאה: ${params.get('error')}`, 'error');
  window.history.replaceState({}, '', window.location.pathname);

  const integrationDefs = [
    { provider: 'google_ads', name: 'Google Ads',          icon: '🟢', desc: 'ניתוח קמפיינים בגוגל' },
    { provider: 'meta',       name: 'Meta Ads',            icon: '🔵', desc: 'פייסבוק ואינסטגרם' },
    { provider: 'ga4',        name: 'Google Analytics 4',  icon: '📈', desc: 'ניתוח תנועת אתר' },
  ];

  const connectedMap = new Map(state.integrations.map(i => [i.provider, i]));

  const statusBadge = (integ) => {
    if (!integ) return '';
    if (integ.connection_status === 'error')   return '<span class="badge badge-red" style="font-size:0.7rem">שגיאה</span>';
    if (integ.connection_status === 'expired') return '<span class="badge badge-yellow" style="font-size:0.7rem">פג תוקף</span>';
    return '<span class="badge badge-green" style="font-size:0.7rem">✓ פעיל</span>';
  };

  renderShell(`
    <div class="page-header">
      <h1 class="page-title">אינטגרציות</h1>
      <p class="page-subtitle">חבר את חשבונות הפרסום שלך — כל חשבון שמור מוצפן בנפרד לכל משתמש</p>
    </div>
    <div class="integration-grid">
      ${integrationDefs.map(def => {
        const integ  = connectedMap.get(def.provider);
        const isConn = !!integ;
        return `
          <div class="integration-card ${isConn ? 'connected' : ''}">
            <div class="integration-header">
              <div class="integration-icon">${def.icon}</div>
              <div>
                <div class="integration-name">${def.name}</div>
                <div class="integration-desc">${def.desc}</div>
              </div>
            </div>
            ${isConn ? `
              <div class="flex items-center justify-between mb-2">
                ${statusBadge(integ)}
                <button class="btn btn-sm btn-danger" onclick="disconnectIntegration('${def.provider}')">נתק</button>
              </div>
              ${integ.account_name ? `<div class="text-xs text-muted">חשבון: ${integ.account_name}</div>` : ''}
              ${integ.last_sync_at ? `<div class="text-xs text-muted">סנכרון: ${new Date(integ.last_sync_at).toLocaleString('he-IL')}</div>` : ''}
              ${integ.last_error   ? `<div class="text-xs" style="color:#ef4444;margin-top:0.25rem">שגיאה: ${integ.last_error}</div>` : ''}
              ${(integ.connection_status === 'error' || integ.connection_status === 'expired')
                ? `<button class="btn btn-sm btn-primary mt-2" onclick="connectIntegration('${def.provider}')">חבר מחדש</button>` : ''}
            ` : `<button class="btn btn-primary" onclick="connectIntegration('${def.provider}')">חבר</button>`}
          </div>`;
      }).join('')}
    </div>

    <div class="card mt-6" style="background:#f8fafc;border:1px solid #e2e8f0">
      <div class="card-title" style="font-size:0.875rem">🔐 אבטחת הנתונים שלך</div>
      <p class="text-sm text-muted">
        כל token מאוחסן מוצפן עם AES-256-GCM ייחודי לחשבונך.
        הטוקנים לעולם לא נחשפים לדפדפן — קריאות ה-API מתבצעות מהשרת בלבד.
        הפרדת הנתונים בין משתמשים מובטחת ע"י Row Level Security ב-Supabase.
      </p>
    </div>
  `);
}

async function connectIntegration(provider) {
  const { data: { session } } = await sb.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) { toast('עליך להיות מחובר', 'error'); return; }

  let nonce;
  try {
    const res = await api('POST', 'oauth-nonce', { provider });
    nonce = res.nonce;
  } catch (err) {
    toast('שגיאה ביצירת חיבור: ' + (err.message || 'נסה שוב'), 'error');
    return;
  }

  const appUrl  = window.location.origin;
  const state64 = btoa(JSON.stringify({ userId, provider, nonce }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  if (provider === 'google_ads' || provider === 'ga4') {
    const clientId    = window.__GOOGLE_CLIENT_ID__ || '';
    const scope       = provider === 'ga4'
      ? 'https://www.googleapis.com/auth/analytics.readonly'
      : 'https://www.googleapis.com/auth/adwords';
    const redirectUri = `${appUrl}/.netlify/functions/oauth-callback-google`;
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state64}&access_type=offline&prompt=consent`;
    window.location.href = url;
  } else if (provider === 'meta') {
    const appId       = window.__META_APP_ID__ || '';
    const redirectUri = `${appUrl}/.netlify/functions/oauth-callback-meta`;
    const scope       = 'ads_read,ads_management,read_insights';
    const url = `https://www.facebook.com/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state64}`;
    window.location.href = url;
  }
}

async function disconnectIntegration(provider) {
  if (!confirm(`נתק ${provider}? תצטרך להתחבר מחדש כדי להמשיך.`)) return;
  try {
    await api('DELETE', 'integration-connect', { provider });
    state.integrations = state.integrations.filter(i => i.provider !== provider);
    toast('האינטגרציה נותקה', 'success');
    navigate('integrations');
  } catch (err) {
    toast(err.message || 'שגיאה', 'error');
  }
}

// ── Billing ───────────────────────────────────────────────────────────────────
async function renderBilling() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('success'))  toast('המנוי הופעל בהצלחה! 🎉', 'success');
  if (params.get('canceled')) toast('החיוב בוטל', 'info');
  window.history.replaceState({}, '', window.location.pathname);

  const plans = [
    { id: 'starter', name: 'Starter', price: '29', priceVar: '__STRIPE_PRICE_STARTER__',
      features: ['3 קמפיינים', '30 ניתוחים ביום', 'GA4 + Meta + Google Ads', 'תמיכה באימייל'] },
    { id: 'pro', name: 'Pro', price: '79', priceVar: '__STRIPE_PRICE_PRO__', popular: true,
      features: ['15 קמפיינים', '200 ניתוחים ביום', 'כל האינטגרציות', 'תמיכה עדיפות', 'ייצוא נתונים'] },
    { id: 'agency', name: 'Agency', price: '199', priceVar: '__STRIPE_PRICE_AGENCY__',
      features: ['קמפיינים ללא הגבלה', 'ניתוחים ללא הגבלה', 'ניהול צוות', 'API גישה', 'SLA 99.9%'] },
  ];

  const currentPlan = state.subscription?.plan || 'free';
  renderShell(`
    <div class="page-header">
      <h1 class="page-title">תוכניות וחיוב</h1>
      <p class="page-subtitle">תוכנית נוכחית: <strong>${currentPlan.toUpperCase()}</strong></p>
    </div>
    ${currentPlan !== 'free' ? `
    <div class="card mb-4 flex items-center justify-between">
      <div>
        <div class="font-semibold">ניהול המנוי שלך</div>
        <div class="text-sm text-muted">עדכון כרטיס אשראי, ביטול מנוי, היסטוריית חשבוניות</div>
      </div>
      <button class="btn btn-secondary" onclick="openBillingPortal()">פורטל חיוב ↗</button>
    </div>` : ''}
    <div class="plan-grid">
      ${plans.map(p => `
        <div class="plan-card ${p.popular ? 'popular' : ''}">
          ${p.popular ? '<div class="plan-popular-badge">פופולרי</div>' : ''}
          <div class="plan-name">${p.name}</div>
          <div class="plan-price">$${p.price}<span>/חודש</span></div>
          <ul class="plan-features">${p.features.map(f => `<li>${f}</li>`).join('')}</ul>
          ${currentPlan === p.id
            ? `<button class="btn btn-secondary w-full" disabled>התוכנית הנוכחית</button>`
            : `<button class="btn btn-primary w-full" onclick="startCheckout('${p.priceVar}')">בחר ${p.name}</button>`}
        </div>`).join('')}
    </div>
  `);
}

async function startCheckout(priceVar) {
  const priceId = window[priceVar] || '';
  if (!priceId) { toast('הגדרת המחיר חסרה', 'error'); return; }
  try {
    const { url } = await api('POST', 'billing-checkout', { priceId });
    window.location.href = url;
  } catch (err) {
    toast(err.message || 'שגיאה בהתחלת תשלום', 'error');
  }
}

async function openBillingPortal() {
  try {
    const { url } = await api('POST', 'billing-portal', {});
    window.location.href = url;
  } catch (err) {
    toast(err.message || 'שגיאה בפתיחת פורטל', 'error');
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function renderSettings() {
  renderShell(`
    <div class="page-header">
      <h1 class="page-title">הגדרות</h1>
    </div>
    <div class="flex flex-col gap-6">
      <div class="card">
        <div class="card-title">פרופיל</div>
        <form onsubmit="saveProfile(event)">
          <div class="form-group">
            <label class="form-label">שם מלא</label>
            <input class="form-input" id="profile-name" value="${state.profile?.name || ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">אימייל</label>
            <input class="form-input" type="email" id="profile-email" value="${state.profile?.email || ''}" />
          </div>
          <button type="submit" class="btn btn-primary" style="width:auto">שמור שינויים</button>
        </form>
      </div>
      <div class="card">
        <div class="card-title">פרטיות ונתונים (GDPR)</div>
        <p class="text-sm text-muted mb-4">הורד עותק של כל הנתונים שלנו עליך.</p>
        <div class="flex gap-2">
          <button class="btn btn-secondary" onclick="exportData()">📥 ייצוא נתונים</button>
          <button class="btn btn-danger"    onclick="deleteAccount()">🗑 מחיקת חשבון</button>
        </div>
      </div>
    </div>
  `);
}

async function saveProfile(e) {
  e.preventDefault();
  try {
    const updates = {
      name:  document.getElementById('profile-name').value.trim(),
      email: document.getElementById('profile-email').value.trim(),
    };
    const profile = await api('PUT', 'account-profile', updates);
    state.profile = profile;
    toast('הפרופיל עודכן!', 'success');
  } catch (err) {
    toast(err.message || 'שגיאה', 'error');
  }
}

async function exportData() {
  try {
    toast('מכין את הנתונים...', 'info');
    const data = await api('POST', 'gdpr-export', {});
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `my-data-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('הנתונים יורדים!', 'success');
  } catch (err) {
    toast(err.message || 'שגיאה בייצוא', 'error');
  }
}

async function deleteAccount() {
  const confirmed = prompt('כדי למחוק את החשבון, הקלד DELETE:');
  if (confirmed !== 'DELETE') return;
  try {
    await api('POST', 'account-delete', { confirmation: 'DELETE' });
    toast('החשבון נמחק.', 'info');
    await sb.auth.signOut();
    state = { user: null, profile: null, subscription: null, campaigns: [], integrations: [], liveStats: {}, liveStatsLoading: false, currentPage: 'dashboard', currentCampaignId: null, accessToken: null };
    renderAuth();
  } catch (err) {
    toast(err.message || 'שגיאה', 'error');
  }
}

// ── Main render ───────────────────────────────────────────────────────────────
async function render() {
  const fn = routes[state.currentPage] || renderDashboard;
  await fn();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function keepAlive() {
  setInterval(() => {
    fetch(window.__SUPABASE_URL__ + '/rest/v1/profiles?select=id&limit=1', {
      headers: {
        'apikey':        window.__SUPABASE_ANON_KEY__,
        'Authorization': 'Bearer ' + window.__SUPABASE_ANON_KEY__,
      }
    }).catch(() => {});
  }, 4 * 60 * 1000);
}

function resolveInitialPage() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('success') || params.has('canceled') || params.has('session_id')) return 'billing';
  if (params.has('connected') || (params.has('error') && window.location.search)) return 'integrations';
  return 'dashboard';
}

async function boot() {
  const initialPage = resolveInitialPage();

  await fetch(window.__SUPABASE_URL__ + '/rest/v1/', {
    headers: { 'apikey': window.__SUPABASE_ANON_KEY__ }
  }).catch(() => {});

  sb.auth.onAuthStateChange(async (event, session) => {
    if (!session) { renderAuth(); return; }

    state.user        = session.user;
    state.accessToken = session.access_token;

    try {
      const [profile, sub] = await Promise.all([
        sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('subscriptions').select('*').eq('user_id', session.user.id).maybeSingle().then(r => r.data),
      ]);
      state.profile      = profile || {};
      state.subscription = sub    || { plan: 'free' };

      const { data: camps } = await sb.from('campaigns').select('id,name').eq('owner_user_id', session.user.id);
      state.campaigns = camps || [];
    } catch {
      state.profile      = {};
      state.subscription = { plan: 'free' };
      state.campaigns    = [];
    } finally {
      if (state.currentPage === 'dashboard' && initialPage !== 'dashboard') {
        state.currentPage = initialPage;
      }
      render();
    }
  });

  setTimeout(() => {
    if (document.querySelector('.loading-screen')) renderAuth();
  }, 8000);

  keepAlive();
}

// ── Expose to HTML event handlers ─────────────────────────────────────────────
window.navigate              = navigate;
window.handleLogout          = handleLogout;
window.showAddCampaignModal  = showAddCampaignModal;
window.addCampaign           = addCampaign;
window.runAnalysis           = runAnalysis;
window.showCampaignDetail    = showCampaignDetail;
window.connectIntegration    = connectIntegration;
window.disconnectIntegration = disconnectIntegration;
window.startCheckout         = startCheckout;
window.openBillingPortal     = openBillingPortal;
window.saveProfile           = saveProfile;
window.exportData            = exportData;
window.deleteAccount         = deleteAccount;
window.refreshLiveStats      = refreshLiveStats;

boot();
