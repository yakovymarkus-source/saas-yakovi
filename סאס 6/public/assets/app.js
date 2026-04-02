/* ════════════════════════════════════════════════════════════════
   CampaignAI — Single-Page Application
   Uses Supabase Auth + custom Netlify Functions API
   ════════════════════════════════════════════════════════════════ */

// ── Config (injected at build or stored in meta tags) ────────────────────────
const CONFIG = {
  supabaseUrl: window.__SUPABASE_URL__ || '',  // set via Netlify env injection
  supabaseKey: window.__SUPABASE_ANON_KEY__ || '',
  apiBase:     '/.netlify/functions',
};

// ── Supabase client ───────────────────────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  user:         null,
  profile:      null,
  subscription: null,
  campaigns:    [],
  currentPage:  'dashboard',
  currentCampaignId: null,
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
async function api(method, path, body) {
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token || '';
  const res = await fetch(`${CONFIG.apiBase}/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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

// ── Shell (sidebar + main) ────────────────────────────────────────────────────
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
  state = { user: null, profile: null, subscription: null, campaigns: [], currentPage: 'dashboard', currentCampaignId: null };
  renderAuth();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let analysis = [];
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      // Load recent analysis results
      const { data } = await sb.from('analysis_results').select('*').eq('user_id', state.user.id)
        .order('created_at', { ascending: false }).limit(5);
      analysis = data || [];
    }
  } catch {}

  const plan   = state.subscription?.plan || 'free';
  const planBadge = { free: 'badge-gray', starter: 'badge-blue', pro: 'badge-green', agency: 'badge-green' };

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">שלום, ${state.profile?.name || 'משתמש'}! 👋</h1>
        <p class="page-subtitle">הנה סקירת הביצועים שלך</p>
      </div>
      <span class="badge ${planBadge[plan] || 'badge-gray'}">${plan.toUpperCase()}</span>
    </div>

    ${!state.profile?.onboardingCompleted ? renderOnboarding() : ''}

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
        <div class="stat-value">${analysis.length ? Math.round(analysis.reduce((s,a) => s + (a.scores?.overall || 0), 0) / analysis.length) : '—'}</div>
      </div>
    </div>

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
}

function renderOnboarding() {
  const steps = [
    { id: 'connect_integration', label: 'חבר אינטגרציה', desc: 'חבר Google Ads, Meta, או GA4', icon: '🔌' },
    { id: 'create_campaign',     label: 'צור קמפיין',    desc: 'הוסף קמפיין לניתוח',           icon: '📢' },
    { id: 'run_first_analysis',  label: 'הרץ ניתוח',     desc: 'קבל תובנות והמלצות',           icon: '🧠' },
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
    toast('המשימה נקלטה, מעבד...', 'success');
    // Poll for result
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

  let analyses = [];
  let recommendations = [];
  let latestVerdict = null;

  try {
    const [analysisRes, recoRes, decisionRes] = await Promise.all([
      sb.from('analysis_results')
        .select('*')
        .eq('user_id', state.user.id)
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(5),
      sb.from('recommendations')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('priority_score', { ascending: false })
        .limit(10),
      sb.from('decision_history')
        .select('verdict, reason, confidence, timestamp')
        .eq('campaign_id', campaignId)
        .order('timestamp', { ascending: false })
        .limit(1),
    ]);
    analyses        = analysisRes.data  || [];
    recommendations = recoRes.data      || [];
    latestVerdict   = decisionRes.data?.[0] || null;
  } catch {}

  const latest = analyses[0];

  const verdictLabel = {
    healthy:           { text: 'בריא',          cls: 'badge-green'  },
    needs_work:        { text: 'דורש שיפור',    cls: 'badge-yellow' },
    critical:          { text: 'קריטי',         cls: 'badge-red'    },
    paused:            { text: 'מושהה',          cls: 'badge-gray'   },
    insufficient_data: { text: 'נתונים חסרים', cls: 'badge-blue'   },
  };

  const scoreLabels = {
    traffic: 'תנועה', ctr: 'CTR', conversion: 'המרה', roas: 'ROAS', coverage: 'כיסוי',
  };

  const vl = latestVerdict
    ? (verdictLabel[latestVerdict.verdict] || { text: latestVerdict.verdict, cls: 'badge-gray' })
    : null;

  const scoresHtml = latest?.scores ? `
    <div class="stats-grid" style="margin-bottom:1rem">
      ${Object.entries(latest.scores).filter(([k]) => k !== 'overall').map(([k, v]) =>
        `<div class="stat-card"><div class="stat-label">${scoreLabels[k] || k}</div><div class="stat-value" style="font-size:1.25rem">${v}/100</div></div>`
      ).join('')}
    </div>` : '';

  const urgencyLabel = { 100: 'דחוף מאוד', 85: 'דחוף', 70: 'גבוה', 65: 'בינוני', 30: 'נמוך' };
  function urgencyText(u) {
    const levels = [100, 85, 70, 65, 30];
    const match = levels.find(l => u >= l);
    return urgencyLabel[match] || 'נמוך';
  }

  const recoHtml = recommendations.length ? `
    <div class="card mt-4">
      <div class="card-title">המלצות לפעולה</div>
      <div class="reco-list">
        ${recommendations.map(r => `
          <div class="reco-item" style="border-right:3px solid ${r.urgency >= 85 ? '#ef4444' : r.urgency >= 65 ? '#f59e0b' : '#6366f1'};padding-right:0.75rem;margin-bottom:1rem">
            <div class="reco-issue" style="font-weight:600;margin-bottom:0.25rem">${r.issue}</div>
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
        </div>
      </div>
      ${scoresHtml}
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
async function renderIntegrations() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let connected = [];
  try {
    const res = await api('GET', 'integration-connect');
    connected = Array.isArray(res) ? res.map(i => i.provider) : [];
  } catch {}

  // Handle OAuth success/error from URL params
  const params = new URLSearchParams(window.location.search);
  if (params.get('connected')) toast(`${params.get('connected')} חובר בהצלחה!`, 'success');
  if (params.get('error'))     toast(`שגיאה: ${params.get('error')}`, 'error');
  window.history.replaceState({}, '', window.location.pathname);

  const integrations = [
    { provider: 'google_ads', name: 'Google Ads', icon: '🟢', desc: 'ניתוח קמפיינים בגוגל' },
    { provider: 'meta',       name: 'Meta Ads',   icon: '🔵', desc: 'פייסבוק ואינסטגרם' },
    { provider: 'ga4',        name: 'Google Analytics 4', icon: '📈', desc: 'ניתוח תנועת אתר' },
  ];

  renderShell(`
    <div class="page-header">
      <h1 class="page-title">אינטגרציות</h1>
      <p class="page-subtitle">חבר את חשבונות הפרסום שלך</p>
    </div>
    <div class="integration-grid">
      ${integrations.map(int => {
        const isConn = connected.includes(int.provider);
        return `
          <div class="integration-card ${isConn ? 'connected' : ''}">
            <div class="integration-header">
              <div class="integration-icon">${int.icon}</div>
              <div>
                <div class="integration-name">${int.name}</div>
                <div class="integration-desc">${int.desc}</div>
              </div>
            </div>
            ${isConn
              ? `<div class="flex items-center justify-between">
                  <span class="badge badge-green">✓ מחובר</span>
                  <button class="btn btn-sm btn-danger" onclick="disconnectIntegration('${int.provider}')">נתק</button>
                </div>`
              : `<button class="btn btn-primary" onclick="connectIntegration('${int.provider}')">חבר</button>`}
          </div>`;
      }).join('')}
    </div>
  `);
}

async function connectIntegration(provider) {
  const { data: { session } } = await sb.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return;

  let nonce;
  try {
    const res = await api('POST', 'oauth-nonce', { provider });
    nonce = res.nonce;
  } catch (err) {
    toast('שגיאה ביצירת חיבור: ' + (err.message || 'נסה שוב'), 'error');
    return;
  }

  const appUrl  = window.location.origin;
  const state64 = btoa(JSON.stringify({ userId, provider, nonce })).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');

  if (provider === 'google_ads' || provider === 'ga4') {
    const clientId    = window.__GOOGLE_CLIENT_ID__ || '';
    const scope       = provider === 'ga4'
      ? 'https://www.googleapis.com/auth/analytics.readonly'
      : 'https://www.googleapis.com/auth/adwords';
    const redirectUri = `${appUrl}/.netlify/functions/oauth-callback-google`;
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state64}&access_type=offline&prompt=consent`;
    window.location.href = url;
  } else if (provider === 'meta') {
    const appId       = window.__META_APP_ID__ || '';
    const redirectUri = `${appUrl}/.netlify/functions/oauth-callback-meta`;
    const scope       = 'ads_read,ads_management,read_insights';
    const url = `https://www.facebook.com/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state64}`;
    window.location.href = url;
  }
}

async function disconnectIntegration(provider) {
  if (!confirm(`נתק ${provider}?`)) return;
  try {
    await api('DELETE', 'integration-connect', { provider });
    toast('האינטגרציה נותקה', 'success');
    navigate('integrations');
  } catch (err) {
    toast(err.message || 'שגיאה', 'error');
  }
}

// ── Billing ───────────────────────────────────────────────────────────────────
async function renderBilling() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('success')) toast('המנוי הופעל בהצלחה! 🎉', 'success');
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
          <ul class="plan-features">
            ${p.features.map(f => `<li>${f}</li>`).join('')}
          </ul>
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
          <button class="btn btn-danger" onclick="deleteAccount()">🗑 מחיקת חשבון</button>
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
    state = { user: null, profile: null, subscription: null, campaigns: [], currentPage: 'dashboard', currentCampaignId: null };
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
function resolveInitialPage() {
  const params = new URLSearchParams(window.location.search);
  // After Stripe checkout redirect
  if (params.has('success') || params.has('canceled') || params.has('session_id')) return 'billing';
  // After OAuth redirect
  if (params.has('connected') || (params.has('error') && window.location.pathname.includes('integrations'))) return 'integrations';
  return 'dashboard';
}

async function boot() {
  const initialPage = resolveInitialPage();

  sb.auth.onAuthStateChange(async (event, session) => {
    if (!session) { renderAuth(); return; }
    state.user = session.user;
    try {
      const [profile, sub] = await Promise.all([
        sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('subscriptions').select('*').eq('user_id', session.user.id).maybeSingle().then(r => r.data),
      ]);
      state.profile      = profile || {};
      state.subscription = sub    || { plan: 'free' };
      const { data: camps } = await sb.from('campaigns').select('id,name').eq('owner_user_id', session.user.id);
      state.campaigns = camps || [];
    } catch {}
    // Navigate to the page implied by URL params (billing success, oauth callback, etc.)
    if (state.currentPage === 'dashboard' && initialPage !== 'dashboard') {
      state.currentPage = initialPage;
    }
    render();
  });

  // Also trigger immediately
  const { data: { session } } = await sb.auth.getSession();
  if (!session) renderAuth();
}

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

boot();
