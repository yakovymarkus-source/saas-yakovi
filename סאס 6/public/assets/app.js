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
  admin:        renderAdmin,
};

// ── Plan definitions (mirrors billing.js PLANS) ───────────────────────────────
const PLAN_LIMITS = {
  free:       { assetsLimit: 5,   campaignLimit: 0,        label: 'חינמי' },
  early_bird: { assetsLimit: 50,  campaignLimit: 1,        label: 'Early Bird' },
  starter:    { assetsLimit: 30,  campaignLimit: 3,        label: 'Starter' },
  pro:        { assetsLimit: 500, campaignLimit: 20,       label: 'Pro' },
  agency:     { assetsLimit: null, campaignLimit: null,    label: 'Agency' },
};
function getPlanLimits(plan) { return PLAN_LIMITS[plan] || PLAN_LIMITS.free; }
function getPlanLabel(plan)  { return PLAN_LIMITS[plan]?.label || plan.toUpperCase(); }

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
      <div class="auth-promo-panel">
        <div class="auth-promo-logo">🧠 CampaignAI</div>
        <h2 class="auth-promo-headline">הכלי שהפרסומאי הישראלי חיכה לו</h2>
        <p class="auth-promo-sub">ניתוח מודעות בזמן אמת, המלצות AI בעברית, ובניית נכסים שיווקיים מנצחים — הכל במקום אחד.</p>
        <div class="auth-promo-features">
          <div class="auth-promo-feature">
            <div class="auth-promo-feature-icon">📝</div>
            <div class="auth-promo-feature-text">
              <strong>תסריטי מודעות</strong>
              <span>כתיבה אוטומטית לפייסבוק, אינסטגרם ויוטיוב</span>
            </div>
          </div>
          <div class="auth-promo-feature">
            <div class="auth-promo-feature-icon">📊</div>
            <div class="auth-promo-feature-text">
              <strong>ניתוח ביצועים חכם</strong>
              <span>זיהוי בעיות CTR, ROAS, CPA בזמן אמת</span>
            </div>
          </div>
          <div class="auth-promo-feature">
            <div class="auth-promo-feature-icon">🎯</div>
            <div class="auth-promo-feature-text">
              <strong>אסטרטגיית פנל שלמה</strong>
              <span>מחקר שוק, מתחרים וסגמנטציה</span>
            </div>
          </div>
          <div class="auth-promo-feature">
            <div class="auth-promo-feature-icon">🚀</div>
            <div class="auth-promo-feature-text">
              <strong>Early Bird ₪10 לחודש</strong>
              <span>הטבת השקה מוגבלת לנרשמים הראשונים</span>
            </div>
          </div>
        </div>
      </div>
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
    { id: 'campaigns',    icon: '🎯', label: 'נכסים שיווקיים' },
    { id: 'integrations', icon: '🔌', label: 'אינטגרציות' },
    { id: 'billing',      icon: '💳', label: 'חיוב' },
    { id: 'settings',     icon: '⚙️', label: 'הגדרות' },
    ...(state.profile?.is_admin ? [{ id: 'admin', icon: '🛡️', label: 'ניהול' }] : []),
  ];
  const initials  = (state.profile?.name || state.user?.email || '?').charAt(0).toUpperCase();
  const sidebarPlan = state.subscription?.plan || 'free';
  document.getElementById('app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <div class="sidebar-logo-badge">🧠</div>
          Campaign<span>AI</span>
        </div>
        <nav class="sidebar-nav">
          ${navItems.map(n => `
            <div class="nav-item ${state.currentPage === n.id ? 'active' : ''}" data-page="${n.id}">
              <span class="nav-icon">${n.icon}</span><span class="nav-label">${n.label}</span>
            </div>`).join('')}
        </nav>
        <div class="sidebar-footer">
          <div class="flex items-center gap-2">
            <div class="user-avatar">${initials}</div>
            <div style="flex:1;overflow:hidden;min-width:0">
              <div class="text-sm font-semibold truncate" style="color:white">${state.profile?.name || 'משתמש'}</div>
              <div class="plan-pill">${getPlanLabel(sidebarPlan)}</div>
            </div>
            <button onclick="handleLogout()" class="btn btn-sm btn-secondary" style="font-size:0.75rem;flex-shrink:0">יציאה</button>
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

// ── Donut SVG helper (real data, no fakes) ────────────────────────────────────
function renderDonutSVG(used, max) {
  if (!max || max === Infinity) return '';
  const pct    = Math.min(100, Math.round((used / max) * 100));
  const r      = 26;
  const circ   = +(2 * Math.PI * r).toFixed(1);
  const fill   = +(circ * pct / 100).toFixed(1);
  const color  = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#6366f1';
  return `<svg width="68" height="68" viewBox="0 0 68 68" style="flex-shrink:0">
    <circle cx="34" cy="34" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="7"/>
    <circle cx="34" cy="34" r="${r}" fill="none" stroke="${color}" stroke-width="7"
      stroke-dasharray="${circ}" stroke-dashoffset="${+(circ - fill).toFixed(1)}"
      stroke-linecap="round" transform="rotate(-90 34 34)"/>
    <text x="34" y="38" text-anchor="middle" font-size="12" font-weight="800" fill="#1e293b">${pct}%</text>
  </svg>`;
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

  const plan          = state.subscription?.plan          || 'free';
  const paymentStatus = state.subscription?.payment_status || 'none';
  const planBadge = { free: 'badge-gray', early_bird: 'badge-blue', starter: 'badge-blue', pro: 'badge-green', agency: 'badge-green' };
  const connectedCount = state.integrations.filter(i => i.connection_status !== 'revoked').length;
  const limits     = getPlanLimits(plan);
  const assetsUsed = analysis.length;                       // last 5 results as proxy
  const assetsMax  = limits.assetsLimit || 5;
  const assetsPct  = Math.min(100, Math.round((assetsUsed / assetsMax) * 100));
  const isFree     = plan === 'free' && paymentStatus !== 'pending';

  renderShell(`
    ${isFree ? `
    <div class="promo-banner">
      <div class="promo-banner-main">
        <span style="font-size:0.9rem;font-weight:600">🎁 הטבת השקה: מסלול Early Bird ב-₪10 בלבד לכל החיים!</span>
        <button class="btn btn-sm" style="background:white;color:#4f46e5;font-weight:700"
          onclick="navigate('billing')">שדרגו עכשיו →</button>
      </div>
      <div class="promo-banner-sub">
        כבר שילמתם?
        <button onclick="claimPayment()" class="promo-claim-link">לחצו כאן להפעלת החשבון</button>
      </div>
    </div>` : ''}

    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">שלום, ${state.profile?.name || 'משתמש'}! 👋</h1>
        <p class="page-subtitle">הנה סקירת הביצועים שלך</p>
      </div>
      <span class="badge ${planBadge[plan] || 'badge-gray'}">${getPlanLabel(plan)}</span>
    </div>

    ${!state.profile?.onboarding_completed ? renderOnboarding() : ''}

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">נכסים פעילים</div>
        <div class="stat-value">${state.campaigns.length}</div>
      </div>
      <div class="stat-card" style="cursor:default">
        <div class="stat-label">נכסים שיווקיים (30 יום)</div>
        <div style="display:flex;align-items:center;gap:0.75rem;margin-top:0.5rem">
          ${renderDonutSVG(assetsUsed, assetsMax)}
          <div>
            <div class="stat-value" style="font-size:1.25rem">${assetsUsed}${assetsMax !== Infinity ? ' / ' + assetsMax : ''}</div>
            <div class="text-xs text-muted" style="margin-top:0.1rem">ב-30 יום האחרונים</div>
            ${assetsMax !== Infinity ? `<div class="usage-bar-track" style="width:72px;margin-top:0.35rem">
              <div class="usage-bar-fill ${assetsPct >= 90 ? 'danger' : assetsPct >= 70 ? 'warning' : 'normal'}" style="width:${assetsPct}%"></div>
            </div>` : ''}
          </div>
        </div>
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
    <div class="card">
      <div class="empty-state">
        <div class="empty-state-icon">🚀</div>
        <h3 class="empty-state-title">מוכנים להשיק נכס שיווקי מנצח?</h3>
        <p class="empty-state-desc">בנו אסטרטגיה, מסרים, תסריטים ולוגיקת דף נחיתה<br>חברו את חשבונות הפרסום שלכם להתחלה</p>
        ${getPlanLimits(plan).campaignLimit === 0
          ? `<button class="btn btn-gradient" style="width:auto;padding:0.75rem 2.25rem;font-size:1rem" onclick="navigate('billing')">שדרגו ליצירת נכסים שיווקיים →</button>`
          : `<button class="btn btn-gradient" style="width:auto;padding:0.75rem 2.25rem;font-size:1rem" onclick="navigate('campaigns')">צרו נכס שיווקי ראשון →</button>`}
      </div>
      <div class="features-grid" style="margin-top:0.5rem">
        <div class="feature-item">
          <div class="feature-icon">📝</div>
          <div class="feature-name">תסריטי מודעות</div>
          <div class="feature-desc">כתיבה אוטומטית לפייסבוק, אינסטגרם ויוטיוב</div>
        </div>
        <div class="feature-item">
          <div class="feature-icon">🎯</div>
          <div class="feature-name">דפי נחיתה</div>
          <div class="feature-desc">אסטרטגיית above-the-fold ומיפוי המרה</div>
        </div>
        <div class="feature-item">
          <div class="feature-icon">🔍</div>
          <div class="feature-name">חקר שוק</div>
          <div class="feature-desc">ניתוח מתחרים וזיהוי הזדמנויות</div>
        </div>
        <div class="feature-item">
          <div class="feature-icon">📊</div>
          <div class="feature-name">ניתוח ביצועים</div>
          <div class="feature-desc">CTR, ROAS, CPA — בעברית ובזמן אמת</div>
        </div>
      </div>
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
        <h1 class="page-title">נכסים שיווקיים</h1>
        <p class="page-subtitle">נהל ונתח את הנכסים השיווקיים שלך</p>
      </div>
      <button class="btn btn-gradient" style="width:auto" onclick="showAddCampaignModal()">+ נכס חדש</button>
    </div>
    <div class="campaign-list">
      ${state.campaigns.length > 0 ? state.campaigns.map(c => `
        <div class="campaign-item" onclick="showCampaignDetail('${c.id}')">
          <div>
            <div class="campaign-name">${c.name}</div>
            <div class="campaign-meta">נוצר: ${new Date(c.created_at).toLocaleDateString('he-IL')}</div>
          </div>
          <div class="flex items-center gap-2">
            <button class="btn btn-sm btn-primary" data-analysis-btn="${c.id}" onclick="event.stopPropagation();runAnalysis('${c.id}')">הרץ ניתוח</button>
          </div>
        </div>`).join('') : `
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">🎯</div>
            <h3 class="empty-state-title">עדיין אין נכסים שיווקיים</h3>
            <p class="empty-state-desc">לחצו על "+ נכס חדש" כדי ליצור תסריט מודעה, דף נחיתה, אסטרטגיית פנל ועוד</p>
            ${getPlanLimits(state.subscription?.plan || 'free').campaignLimit === 0
              ? `<button class="btn btn-gradient" style="width:auto" onclick="navigate('billing')">שדרג ליצירת נכסים →</button>`
              : `<button class="btn btn-gradient" style="width:auto" onclick="showAddCampaignModal()">+ צור נכס ראשון</button>`}
          </div>
        </div>`}
    </div>
  `);
}

function showAddCampaignModal() {
  // CA-008: guard for free plan — campaign creation is blocked, redirect to billing
  const plan = state.subscription?.plan || 'free';
  if (getPlanLimits(plan).campaignLimit === 0) {
    navigate('billing');
    toast('שדרג את התוכנית שלך כדי ליצור נכסים שיווקיים', 'info');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h2 class="modal-title">נכס שיווקי חדש</h2>
      <div class="form-group">
        <label class="form-label">שם הנכס</label>
        <input class="form-input" id="new-campaign-name" placeholder="למשל: קמפיין Black Friday 2025" />
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
  // STATE-01: disable all buttons for this campaign to prevent duplicate jobs
  const btns = document.querySelectorAll(`[data-analysis-btn="${campaignId}"]`);
  btns.forEach(b => { b.disabled = true; b.textContent = 'מנתח...'; });
  try {
    toast('מריץ ניתוח...', 'info');
    const job = await api('POST', 'enqueue-sync-job', { campaignId });
    toast('המשימה נקלטה — מושך נתונים חיים ומנתח...', 'success');
    pollJobStatus(job.jobId, campaignId);
  } catch (err) {
    btns.forEach(b => { b.disabled = false; b.textContent = 'הרץ ניתוח'; });
    toast(err.message || 'שגיאה בהרצת ניתוח', 'error');
  }
}

async function pollJobStatus(jobId, campaignId) {
  let attempts = 0;
  const restoreBtns = () => {
    document.querySelectorAll(`[data-analysis-btn="${campaignId}"]`)
      .forEach(b => { b.disabled = false; b.textContent = 'הרץ ניתוח'; });
  };
  const poll = async () => {
    attempts++;
    try {
      const { data } = await sb.from('sync_jobs').select('status,result_payload').eq('id', jobId).maybeSingle();
      if (data?.status === 'done') {
        restoreBtns();
        toast('הניתוח הסתיים!', 'success');
        showCampaignDetail(campaignId);
        return;
      }
      if (data?.status === 'failed') {
        restoreBtns();
        toast('הניתוח נכשל — נסה שנית', 'error');
        return;
      }
      if (attempts < 20) {
        setTimeout(poll, 3000);
      } else {
        // STATE-02: notify user on timeout instead of silent fail
        restoreBtns();
        toast('הניתוח לוקח יותר מהצפוי. נסה שנית בעוד כמה דקות.', 'warning');
      }
    } catch {
      if (attempts < 20) setTimeout(poll, 3000);
      else { restoreBtns(); toast('שגיאה בבדיקת סטטוס הניתוח', 'error'); }
    }
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
        <button class="btn btn-sm btn-secondary mb-2" onclick="navigate('campaigns')">← חזור לנכסים</button>
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
      <button class="btn btn-primary" style="width:auto;padding:0.625rem 1.5rem" data-analysis-btn="${campaignId}" onclick="runAnalysis('${campaignId}')">הרץ ניתוח ראשון</button>
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
    const url = `https://www.facebook.com/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state64}`;
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
  window.history.replaceState({}, '', window.location.pathname);

  const plan          = state.subscription?.plan          || 'free';
  const paymentStatus = state.subscription?.payment_status || 'none';
  const isPending     = paymentStatus === 'pending';
  const isEarlyBird   = plan === 'early_bird' && !isPending;
  const isPro         = (plan === 'pro' || plan === 'agency') && !isPending;

  renderShell(`
    <div class="page-header">
      <h1 class="page-title">תוכניות וחיוב</h1>
      <p class="page-subtitle">
        תוכנית נוכחית: <strong>${getPlanLabel(plan)}</strong>
        ${isPending ? '<span class="badge badge-gray" style="margin-right:0.5rem">ממתין לאישור</span>' : ''}
      </p>
    </div>

    ${isPending ? `
    <div class="card mb-4" style="border:2px solid #f59e0b;background:#fffbeb">
      <div style="font-weight:700;color:#92400e;margin-bottom:0.5rem">⏳ התשלום בבדיקה</div>
      <p class="text-sm" style="color:#78350f;margin:0">הבקשה שלך התקבלה! החשבון יופעל תוך דקות לאחר אישור התשלום.</p>
    </div>` : ''}

    ${/* Founders upgrade — ONLY for early_bird users — NOT on public pricing */ isEarlyBird ? `
    <div class="card mb-4" style="border:2px solid #6366f1;background:#eef2ff">
      <div class="flex items-center justify-between gap-3" style="flex-wrap:wrap">
        <div>
          <div class="font-semibold" style="color:#4338ca;font-size:1rem">🎁 הטבת מייסדים בלעדית</div>
          <div class="text-sm text-muted mt-1">שדרגו ל-Pro ב-<strong>₪99 בלבד לכל החיים!</strong></div>
          <div class="text-xs text-muted">מחיר סופי (עוסק פטור)</div>
        </div>
        <a href="https://pay.grow.link/f752f70d2d88201a126de25aedbd498e-MzI1Njk5OA"
           target="_blank" rel="noopener"
           class="btn btn-primary" style="white-space:nowrap"
           onclick="window._pendingPlan='pro'">
          שדרגו עכשיו ₪99 →
        </a>
      </div>
    </div>` : ''}

    <div class="plan-grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">

      <!-- Free -->
      <div class="plan-card${plan === 'free' && !isPending ? ' current' : ''}">
        <div class="plan-name">חינמי</div>
        <div class="plan-price">₪0<span> לתמיד</span></div>
        <div class="text-xs text-muted mb-3">מחיר סופי (עוסק פטור)</div>
        <ul class="plan-features">
          <li>5 נכסים שיווקיים</li>
          <li>0 קמפיינים פעילים</li>
          <li>ניתוח בסיסי</li>
        </ul>
        <button class="btn btn-secondary w-full" disabled>${plan === 'free' && !isPending ? 'התוכנית הנוכחית' : 'מסלול בסיס'}</button>
      </div>

      <!-- Early Bird -->
      <div class="plan-card popular${isEarlyBird ? ' current' : ''}">
        <div class="plan-popular-badge">🔥 Early Bird</div>
        <div class="plan-name">Early Bird</div>
        <div class="plan-price">₪10<span> לכל החיים</span></div>
        <div class="text-xs text-muted mb-3">מחיר סופי (עוסק פטור)</div>
        <ul class="plan-features">
          <li>50 נכסים שיווקיים</li>
          <li>1 קמפיין פעיל</li>
          <li>כל הכלים השיווקיים</li>
          <li>עדכונים לצמיתות</li>
        </ul>
        ${isEarlyBird
          ? `<button class="btn btn-secondary w-full" disabled>התוכנית הנוכחית</button>`
          : `<a href="https://pay.grow.link/5970efd2adef5019d8f9e925211e1c48-MzI1Njk5Ng"
               target="_blank" rel="noopener"
               class="btn btn-primary w-full"
               onclick="window._pendingPlan='early_bird'">
               שלם ₪10 →
             </a>`}
      </div>

      <!-- Pro -->
      <div class="plan-card${isPro ? ' current' : ''}">
        <div class="plan-name">Pro</div>
        <div class="plan-price">₪249<span>/חודש</span></div>
        <div class="text-xs text-muted mb-3">מחיר סופי (עוסק פטור)</div>
        <ul class="plan-features">
          <li>500 נכסים שיווקיים</li>
          <li>20 קמפיינים פעילים</li>
          <li>כל האינטגרציות</li>
          <li>תמיכה עדיפות</li>
        </ul>
        ${isPro
          ? `<button class="btn btn-secondary w-full" disabled>התוכנית הנוכחית</button>`
          : `<a href="https://pay.grow.link/2297dbe8bb307b597007097ab69ac491-MzI1Njk5Nw"
               target="_blank" rel="noopener"
               class="btn btn-primary w-full"
               onclick="window._pendingPlan='pro'">
               שלם ₪249 →
             </a>`}
      </div>

    </div>

    ${!isPending && !isPro && !isEarlyBird ? `
    <div class="card mt-4" style="border:1px solid #c7d2fe;background:#f5f3ff">
      <div style="font-weight:600;margin-bottom:0.5rem">✅ כבר שילמתם?</div>
      <p class="text-sm text-muted mb-3">לאחר ביצוע התשלום בקישור למעלה, לחצו כאן כדי שנפעיל את החשבון.</p>
      <button class="btn btn-primary" id="confirm-payment-btn" onclick="confirmPayment()">
        שילמתי, הפעילו לי את החשבון
      </button>
    </div>` : ''}
    ${isEarlyBird ? `
    <div class="card mt-4" style="border:1px solid #c7d2fe;background:#f5f3ff">
      <div style="font-weight:600;margin-bottom:0.5rem">✅ שילמתם על ה-Pro?</div>
      <p class="text-sm text-muted mb-3">לאחר ביצוע התשלום, לחצו כאן לאישור.</p>
      <button class="btn btn-primary" id="confirm-payment-btn" onclick="confirmPayment()">
        שילמתי, הפעילו לי את החשבון
      </button>
    </div>` : ''}
  `);
}

// Track which plan the user is paying for (set by onclick on payment link)
window._pendingPlan = 'early_bird';

async function confirmPayment() {
  const btn = document.getElementById('confirm-payment-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'שולח...'; }
  try {
    const plan = window._pendingPlan || 'early_bird';
    await api('POST', 'payment-pending', { plan });
    if (state.subscription) {
      state.subscription.payment_status = 'pending';
    } else {
      state.subscription = { plan, payment_status: 'pending' };
    }
    toast('הבקשה התקבלה! החשבון יופעל תוך דקות לאחר אישור התשלום.', 'success');
    setTimeout(() => navigate('billing'), 500);
  } catch (err) {
    toast(err.message || 'שגיאה — נסו שנית', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'שילמתי, הפעילו לי את החשבון'; }
  }
}

// ── Payment claim — safety-net for users who closed the browser ──────────────
function claimPayment() {
  // Show modal overlay with plan selector + verifying UX
  const overlay = document.createElement('div');
  overlay.id = 'claim-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  overlay.innerHTML = `
    <div style="background:white;border-radius:1rem;padding:2rem;max-width:420px;width:100%;text-align:center;direction:rtl">
      <div style="font-size:2rem;margin-bottom:0.75rem">💳</div>
      <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:0.5rem">הפעלת חשבון לאחר תשלום</h3>
      <p style="font-size:0.875rem;color:#64748b;margin-bottom:1.25rem">בחרו את המסלול ששילמתם עליו:</p>
      <div style="display:flex;flex-direction:column;gap:0.625rem;margin-bottom:1.25rem">
        <label style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;border:2px solid #e2e8f0;border-radius:0.625rem;cursor:pointer">
          <input type="radio" name="claim-plan" value="early_bird" checked style="accent-color:#6366f1"/>
          <span><strong>Early Bird — ₪10</strong><br><small style="color:#64748b">50 נכסים שיווקיים, קמפיין אחד</small></span>
        </label>
        <label style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;border:2px solid #e2e8f0;border-radius:0.625rem;cursor:pointer">
          <input type="radio" name="claim-plan" value="pro" style="accent-color:#6366f1"/>
          <span><strong>Pro — ₪249/חודש</strong><br><small style="color:#64748b">500 נכסים שיווקיים, 20 קמפיינים</small></span>
        </label>
      </div>
      <button id="claim-submit-btn" onclick="submitClaim()" class="btn btn-primary w-full" style="margin-bottom:0.75rem">
        אמתו ואפשרו את החשבון שלי
      </button>
      <button onclick="document.getElementById('claim-overlay').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:0.875rem">
        ביטול
      </button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function submitClaim() {
  const btn  = document.getElementById('claim-submit-btn');
  const plan = document.querySelector('input[name="claim-plan"]:checked')?.value || 'early_bird';
  const overlay = document.getElementById('claim-overlay');

  // Switch to "verifying..." state
  if (btn) { btn.disabled = true; }
  const inner = overlay?.querySelector('div');
  if (inner) inner.innerHTML = `
    <div style="font-size:2.5rem;margin-bottom:1rem">🔍</div>
    <h3 style="font-size:1.05rem;font-weight:700;margin-bottom:0.5rem">אנחנו מאמתים את התשלום שלך...</h3>
    <p style="font-size:0.85rem;color:#64748b">זה עשוי לקחת רגע. אנא המתינו.</p>
    <div style="margin-top:1rem"><div class="spinner" style="margin:auto"></div></div>`;

  try {
    await api('POST', 'payment-pending', { plan });
    if (state.subscription) {
      state.subscription.payment_status = 'pending';
    } else {
      state.subscription = { plan, payment_status: 'pending', status: 'active' };
    }
    if (inner) inner.innerHTML = `
      <div style="font-size:2.5rem;margin-bottom:1rem">✅</div>
      <h3 style="font-size:1.05rem;font-weight:700;margin-bottom:0.5rem">הבקשה התקבלה!</h3>
      <p style="font-size:0.875rem;color:#64748b">החשבון יופעל תוך דקות לאחר אישור התשלום.<br>תקבלו אימייל אישור.</p>
      <button onclick="document.getElementById('claim-overlay').remove();navigate('billing')" class="btn btn-primary" style="margin-top:1.25rem">
        הבנתי
      </button>`;
  } catch (err) {
    if (inner) inner.innerHTML = `
      <div style="font-size:2.5rem;margin-bottom:1rem">⚠️</div>
      <h3 style="font-size:1.05rem;font-weight:700;margin-bottom:0.5rem">שגיאה</h3>
      <p style="font-size:0.875rem;color:#64748b">${err.message || 'נסו שנית'}</p>
      <button onclick="document.getElementById('claim-overlay').remove()" class="btn btn-secondary" style="margin-top:1.25rem">
        סגור
      </button>`;
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

// ── Admin Dashboard ───────────────────────────────────────────────────────────
async function renderAdmin() {
  if (!state.profile?.is_admin) { navigate('dashboard'); return; }
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  let overview = null, usersData = null, pendingData = null;
  try {
    [overview, usersData, pendingData] = await Promise.all([
      api('GET', 'admin-overview'),
      api('GET', 'admin-users?limit=20&page=1'),
      api('GET', 'admin-users?limit=50&page=1').then(d =>
        ({ users: (d.users || []).filter(u => u.paymentStatus === 'pending') })
      ).catch(() => ({ users: [] })),
    ]);
  } catch (err) {
    renderShell(`<div class="page-header"><h1 class="page-title">שגיאה</h1><p class="text-muted">${err.message}</p></div>`);
    return;
  }

  const fmt      = n => n == null ? '—' : Number(n).toLocaleString('he-IL');
  const pct      = n => n == null ? '—' : (n * 100).toFixed(1) + '%';
  const curr     = n => n == null ? '—' : '₪' + (n / 100).toFixed(0);
  const pBadge   = { free: 'badge-gray', early_bird: 'badge-blue', starter: 'badge-blue', pro: 'badge-green', agency: 'badge-green' };
  const pending  = pendingData?.users || [];

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">🛡️ לוח ניהול</h1>
        <p class="page-subtitle">סטטיסטיקות מערכת וניהול משתמשים</p>
      </div>
    </div>

    ${pending.length > 0 ? `
    <div class="analysis-card mb-4" style="border:2px solid #f59e0b;background:#fffbeb">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold" style="color:#92400e">⏳ תשלומים ממתינים לאישור (${pending.length})</h3>
      </div>
      ${pending.map(u => `
        <div class="flex items-center justify-between gap-2 py-2" style="border-bottom:1px solid #fde68a">
          <div>
            <div class="font-semibold text-sm">${u.email}</div>
            <div class="text-xs text-muted">תוכנית מבוקשת: ${getPlanLabel(u.plan)}</div>
          </div>
          <button class="btn btn-sm btn-primary" onclick="activateUserPayment('${u.id}','${u.plan}')">
            הפעל חשבון
          </button>
        </div>`).join('')}
    </div>` : ''}

    <div class="stats-grid" style="margin-bottom:1.5rem">
      <div class="stat-card">
        <div class="stat-label">MRR</div>
        <div class="stat-value">${curr(overview?.mrr)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">סה"כ משתמשים</div>
        <div class="stat-value">${fmt(overview?.totalUsers)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">הרשמות 24ש'</div>
        <div class="stat-value">${fmt(overview?.newSignups24h)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Churn</div>
        <div class="stat-value">${pct(overview?.churnRate)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">המרה לתשלום</div>
        <div class="stat-value">${pct(overview?.conversionRate)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">תשלומים כושלים 24ש'</div>
        <div class="stat-value" style="${(overview?.failedPayments24h || 0) > 0 ? 'color:#ef4444' : ''}">${fmt(overview?.failedPayments24h)}</div>
      </div>
    </div>

    <div class="analysis-card" style="margin-bottom:1.5rem">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold">בריאות מערכת</h3>
      </div>
      <div style="display:flex;gap:2rem;flex-wrap:wrap">
        <div><span class="text-muted text-sm">עבודות ממתינות</span><br><strong>${fmt(overview?.systemHealth?.pendingJobs)}</strong></div>
        <div><span class="text-muted text-sm">עבודות פועלות</span><br><strong>${fmt(overview?.systemHealth?.runningJobs)}</strong></div>
        <div><span class="text-muted text-sm">עבודות נכשלות 24ש'</span><br><strong style="${(overview?.systemHealth?.failedJobs24h || 0) > 0 ? 'color:#ef4444' : ''}">${fmt(overview?.systemHealth?.failedJobs24h)}</strong></div>
      </div>
    </div>

    <div class="analysis-card">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold">משתמשים אחרונים</h3>
        <span class="text-muted text-sm">סה"כ ${fmt(usersData?.total)}</span>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.875rem">
          <thead>
            <tr style="border-bottom:1px solid #e2e8f0;color:#64748b">
              <th style="text-align:right;padding:0.5rem 0.75rem;font-weight:500">אימייל</th>
              <th style="text-align:right;padding:0.5rem 0.75rem;font-weight:500">שם</th>
              <th style="text-align:right;padding:0.5rem 0.75rem;font-weight:500">תוכנית</th>
              <th style="text-align:right;padding:0.5rem 0.75rem;font-weight:500">נכסים</th>
              <th style="text-align:right;padding:0.5rem 0.75rem;font-weight:500">הצטרף</th>
              <th style="text-align:right;padding:0.5rem 0.75rem;font-weight:500">פעולה</th>
            </tr>
          </thead>
          <tbody>
            ${(usersData?.users || []).map(u => `
              <tr style="border-bottom:1px solid #f1f5f9${u.paymentStatus === 'pending' ? ';background:#fffbeb' : ''}">
                <td style="padding:0.5rem 0.75rem">${u.email}${u.isAdmin ? ' <span class="badge badge-blue" style="font-size:0.65rem">admin</span>' : ''}${u.paymentStatus === 'pending' ? ' <span class="badge badge-gray" style="font-size:0.65rem">pending</span>' : ''}</td>
                <td style="padding:0.5rem 0.75rem">${u.name || '—'}</td>
                <td style="padding:0.5rem 0.75rem"><span class="badge ${pBadge[u.plan] || 'badge-gray'}">${getPlanLabel(u.plan)}</span></td>
                <td style="padding:0.5rem 0.75rem">${u.campaignCount}</td>
                <td style="padding:0.5rem 0.75rem">${u.createdAt ? new Date(u.createdAt).toLocaleDateString('he-IL') : '—'}</td>
                <td style="padding:0.5rem 0.75rem">${u.paymentStatus === 'pending' ? `<button class="btn btn-sm btn-primary" onclick="activateUserPayment('${u.id}','${u.plan}')">הפעל</button>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`);
}

async function activateUserPayment(userId, plan) {
  if (!confirm(`להפעיל תוכנית ${getPlanLabel(plan)} עבור משתמש זה?`)) return;
  try {
    await api('POST', 'activate-payment', { userId, plan });
    toast('החשבון הופעל ואימייל נשלח למשתמש!', 'success');
    renderAdmin();
  } catch (err) {
    toast(err.message || 'שגיאה בהפעלה', 'error');
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
        sb.from('subscriptions').select('plan,status,payment_status').eq('user_id', session.user.id).maybeSingle().then(r => r.data),
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
      initCampaignerChat();   // mount chat widget once user is authenticated
    }
  });

  setTimeout(() => {
    if (document.querySelector('.loading-screen')) renderAuth();
  }, 8000);

  keepAlive();
}

// ══════════════════════════════════════════════════════════════════════════════
//  CAMPAIGNER AI — Chat Widget
//  Floats bottom-left. Feeds live stats from get-ads-data cache to the
//  decision engine and returns specific, data-driven Hebrew responses.
// ══════════════════════════════════════════════════════════════════════════════

const chatState = {
  open:     false,
  loading:  false,
  history:  [],          // [{role:'user'|'assistant', content:string}]
  quickActions: [
    'בנה לי תסריט למודעת פייסבוק/אינסטגרם',
    'בצע חקר שוק וניתוח מתחרים',
    'תכנן מבנה לדף נחיתה ממיר',
    'נתח ביצועי קמפיינים קיימים',
  ],
};

// ── Markdown-lite renderer ────────────────────────────────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

// ── Build / inject widget DOM ─────────────────────────────────────────────────
function initCampaignerChat() {
  if (document.getElementById('chat-trigger')) return; // already mounted

  // Floating trigger button
  const trigger = document.createElement('button');
  trigger.id = 'chat-trigger';
  trigger.setAttribute('aria-label', 'פתח Campaigner AI');
  trigger.innerHTML = '<span>🧠</span><span class="chat-badge" id="chat-badge"></span>';
  trigger.onclick = toggleChat;
  document.body.appendChild(trigger);

  // Chat panel
  const panel = document.createElement('div');
  panel.id = 'chat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Campaigner AI');
  panel.innerHTML = `
    <div class="chat-header">
      <div class="chat-avatar">🧠</div>
      <div class="chat-header-info">
        <div class="chat-header-name">Campaigner AI</div>
        <div class="chat-header-sub">מנתח נתוני פרסום בזמן אמת</div>
      </div>
      <div class="chat-status-dot" title="מחובר"></div>
      <div class="chat-header-actions">
        <button class="chat-header-btn" onclick="clearChatHistory()" title="נקה שיחה">🗑</button>
        <button class="chat-header-btn" onclick="toggleChat()" title="סגור">✕</button>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages">
      <div class="chat-welcome">
        <div class="chat-welcome-icon">🧠</div>
        <h3>Campaigner AI</h3>
        <p>שלום! אני השותף האסטרטגי שלך לצמיחה. אני לא רק מנתח נתונים בזמן אמת, אלא עוזר לך לבנות נכסים שיווקיים מנצחים מאפס: מחקר שוק, תסריטי מודעות, תכנון דפי נחיתה וניתוח ביצועי קמפיינים. במה נתחיל היום?</p>
        <div class="chat-knowledge-badge">
          <span class="chat-knowledge-dot"></span>
          מנוע ידע שיווקי פעיל
        </div>
      </div>
    </div>
    <div class="chat-quick-actions" id="chat-quick-actions"></div>
    <div class="chat-input-bar">
      <textarea
        class="chat-input"
        id="chat-input"
        placeholder="שאל על ביצועים, תקציב, CTR..."
        rows="1"
        maxlength="2000"
      ></textarea>
      <button class="chat-send-btn" id="chat-send-btn" onclick="submitChatMessage()" title="שלח">➤</button>
    </div>`;
  document.body.appendChild(panel);

  // Auto-resize textarea
  const textarea = document.getElementById('chat-input');
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitChatMessage(); }
  });

  renderQuickActions(chatState.quickActions);
}

// ── Toggle open/close ─────────────────────────────────────────────────────────
function toggleChat() {
  chatState.open = !chatState.open;
  const panel   = document.getElementById('chat-panel');
  const trigger = document.getElementById('chat-trigger');
  const badge   = document.getElementById('chat-badge');
  if (panel) panel.classList.toggle('open', chatState.open);
  if (trigger) trigger.innerHTML = chatState.open
    ? '<span style="font-size:1.1rem">✕</span>'
    : '<span>🧠</span><span class="chat-badge" id="chat-badge"></span>';
  if (chatState.open) {
    scrollChatToBottom();
    document.getElementById('chat-input')?.focus();
  }
}

// ── Render quick action chips ─────────────────────────────────────────────────
function renderQuickActions(actions) {
  const container = document.getElementById('chat-quick-actions');
  if (!container) return;
  container.innerHTML = (actions || []).map(a =>
    `<button class="chat-quick-btn" onclick="handleQuickAction(this)">${a}</button>`
  ).join('');
}

function handleQuickAction(btn) {
  const text = btn.textContent;
  const input = document.getElementById('chat-input');
  if (input) { input.value = text; input.style.height = 'auto'; }
  submitChatMessage();
}

// ── Append message bubble ─────────────────────────────────────────────────────
function appendChatBubble(role, content, animate = false) {
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return;

  const initials = (state.profile?.name || state.user?.email || '?').charAt(0).toUpperCase();
  const icon = role === 'user' ? initials : '🧠';

  const wrapper = document.createElement('div');
  wrapper.className = `chat-msg ${role}`;
  wrapper.innerHTML = `
    <div class="chat-msg-icon">${icon}</div>
    <div class="chat-msg-bubble" id="bubble-${Date.now()}"></div>`;
  msgs.appendChild(wrapper);

  const bubble = wrapper.querySelector('.chat-msg-bubble');
  if (animate && role === 'assistant') {
    typewriterEffect(bubble, content);
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }
  scrollChatToBottom();
  return bubble;
}

// ── Typewriter (simulated streaming) ─────────────────────────────────────────
function typewriterEffect(el, text) {
  const words  = text.split(' ');
  let current  = '';
  let idx      = 0;

  function tick() {
    if (idx >= words.length) { el.innerHTML = renderMarkdown(text); return; }
    current += (idx > 0 ? ' ' : '') + words[idx++];
    el.innerHTML = renderMarkdown(current) + '<span style="opacity:.4">▋</span>';
    scrollChatToBottom();
    setTimeout(tick, 18 + Math.random() * 22);
  }
  tick();
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function showTypingIndicator() {
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return;
  const el = document.createElement('div');
  el.className = 'chat-typing';
  el.id = 'chat-typing';
  el.innerHTML = `
    <div class="chat-typing-icon">🧠</div>
    <div class="chat-typing-bubble">
      <span style="font-size:0.75rem;color:#6366f1">הסוכן מנתח את הנתונים...</span>
      <div class="chat-typing-dots"><span></span><span></span><span></span></div>
    </div>`;
  msgs.appendChild(el);
  scrollChatToBottom();
}
function hideTypingIndicator() {
  document.getElementById('chat-typing')?.remove();
}

// ── Scroll helper ─────────────────────────────────────────────────────────────
function scrollChatToBottom() {
  const msgs = document.getElementById('chat-messages');
  if (msgs) requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
}

// ── Submit message ────────────────────────────────────────────────────────────
async function submitChatMessage() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const message = input?.value.trim();
  if (!message || chatState.loading) return;

  // Clear input
  input.value = '';
  input.style.height = 'auto';

  // Add user bubble
  appendChatBubble('user', message);
  chatState.history.push({ role: 'user', content: message });

  // Disable input while loading
  chatState.loading = true;
  if (sendBtn) sendBtn.disabled = true;
  showTypingIndicator();

  // Hide quick actions while processing
  const qa = document.getElementById('chat-quick-actions');
  if (qa) qa.style.display = 'none';

  try {
    const result = await api('POST', 'campaigner-chat', {
      message,
      history: chatState.history.slice(-6), // send last 3 exchanges for context
    });

    hideTypingIndicator();

    const reply = result.reply || 'לא הצלחתי לקבל תשובה. נסה שוב.';
    appendChatBubble('assistant', reply, true /* animate */);
    chatState.history.push({ role: 'assistant', content: reply });

    // Update quick actions from response
    if (result.quickActions?.length) {
      chatState.quickActions = result.quickActions;
    }

  } catch (err) {
    hideTypingIndicator();
    const errMsg = err.message?.includes('NOT_CONNECTED')
      ? 'חבר קודם אינטגרציה כדי שאוכל לנתח את הנתונים שלך.'
      : `שגיאה: ${err.message || 'נסה שוב'}`;
    appendChatBubble('assistant', errMsg, true);
    chatState.history.push({ role: 'assistant', content: errMsg });
  } finally {
    chatState.loading = false;
    if (sendBtn) sendBtn.disabled = false;
    if (input)   input.focus();
    // Restore quick actions
    if (qa) qa.style.display = '';
    renderQuickActions(chatState.quickActions);
    scrollChatToBottom();
  }
}

// ── Clear chat history ────────────────────────────────────────────────────────
function clearChatHistory() {
  chatState.history = [];
  const msgs = document.getElementById('chat-messages');
  if (msgs) {
    msgs.innerHTML = `
      <div class="chat-welcome">
        <div class="chat-welcome-icon">🧠</div>
        <h3>Campaigner AI</h3>
        <p>שלום! אני השותף האסטרטגי שלך לצמיחה. אני לא רק מנתח נתונים בזמן אמת, אלא עוזר לך לבנות נכסים שיווקיים מנצחים מאפס: מחקר שוק, תסריטי מודעות, תכנון דפי נחיתה וניתוח ביצועי קמפיינים. במה נתחיל היום?</p>
        <div class="chat-knowledge-badge">
          <span class="chat-knowledge-dot"></span>
          מנוע ידע שיווקי פעיל
        </div>
      </div>`;
  }
  chatState.quickActions = [
    'בנה לי תסריט למודעת פייסבוק/אינסטגרם',
    'בצע חקר שוק וניתוח מתחרים',
    'תכנן מבנה לדף נחיתה ממיר',
    'נתח ביצועי קמפיינים קיימים',
  ];
  renderQuickActions(chatState.quickActions);
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
window.confirmPayment        = confirmPayment;
window.claimPayment          = claimPayment;
window.submitClaim           = submitClaim;
window.activateUserPayment   = activateUserPayment;
window.saveProfile           = saveProfile;
window.exportData            = exportData;
window.deleteAccount         = deleteAccount;
window.refreshLiveStats      = refreshLiveStats;
window.toggleChat            = toggleChat;
window.submitChatMessage     = submitChatMessage;
window.clearChatHistory      = clearChatHistory;
window.handleQuickAction     = handleQuickAction;

boot();
