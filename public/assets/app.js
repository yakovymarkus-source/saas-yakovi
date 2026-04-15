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
  dashboard:        renderDashboard,
  business_profile: renderBusinessProfile,
  ai_creation:      renderAICreation,
  marketing_assets: renderMarketingAssets,
  campaigns:        renderCampaigns,
  integrations:     renderIntegrations,
  billing:          renderBilling,
  settings:         renderSettings,
  support:          renderSupport,
  admin:            renderAdmin,
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
  window.location.hash = page;
  render();
}

// ── API helper ────────────────────────────────────────────────────────────────
// All requests carry the user's Supabase JWT.
// Netlify Functions validate this token and look up the user's own OAuth credentials.
// No .env API keys are ever exposed to or used by the frontend.
async function api(method, path, body) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 25000);
  try {
    const token = state.accessToken || '';
    const res = await fetch(`${CONFIG.apiBase}/${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
    return json.data ?? json;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('הבקשה ארכה יותר מדי — נסה שנית');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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
    { id: 'dashboard',        icon: '🏠', label: 'דף הבית' },
    { id: 'business_profile', icon: '🏢', label: 'פרופיל עסקי' },
    { id: 'ai_creation',      icon: '✨', label: 'יצירה עם AI' },
    { id: 'marketing_assets', icon: '📊', label: 'ניתוח קמפיינים' },
    { id: 'integrations',     icon: '🔌', label: 'אינטגרציות' },
    { id: 'billing',          icon: '💳', label: 'חיוב' },
    { id: 'support',          icon: '💬', label: 'תמיכה' },
    ...(state.profile?.is_admin ? [{ id: 'admin', icon: '🛡️', label: 'ניהול' }] : []),
  ];
  const initials    = (state.profile?.name || state.user?.email || '?').charAt(0).toUpperCase();
  const sidebarPlan = state.subscription?.plan || 'free';
  const isPending   = state.subscription?.payment_status === 'pending';
  const bellCount   = isPending ? 1 : 0;
  document.getElementById('app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <div class="sidebar-logo-badge">🧠</div>
          Campaign<span>AI</span>
          ${bellCount > 0 ? `<button class="sidebar-bell" onclick="navigate('billing')" title="התראות ממתינות">🔔<span class="sidebar-bell-badge">${bellCount}</span></button>` : ''}
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
        // Trigger background load if not already loading
        if (!state.liveStatsLoading) loadLiveStats().then(() => {
          const c = document.getElementById('live-stats-container');
          if (c) c.innerHTML = renderLiveStatsContent();
        });
        return `
          <div class="stat-card" style="min-width:0">
            <div class="stat-label">${p.icon} ${p.label}</div>
            <div class="text-muted text-xs">⏳ טוען...</div>
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
  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">📊 ניתוח קמפיינים</h1>
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

  // Bar chart for scores
  function scoreBar(label, value) {
    const pct = Math.max(0, Math.min(100, value || 0));
    const color = pct >= 70 ? '#22c55e' : pct >= 45 ? '#f59e0b' : '#ef4444';
    return `<div style="margin-bottom:0.6rem">
      <div class="flex items-center justify-between mb-1">
        <span class="text-sm font-semibold" style="color:#374151">${label}</span>
        <span class="text-sm font-bold" style="color:${color}">${pct}/100</span>
      </div>
      <div style="background:#e2e8f0;border-radius:999px;height:10px;overflow:hidden">
        <div style="width:${pct}%;background:${color};height:100%;border-radius:999px;transition:width 0.6s ease"></div>
      </div>
    </div>`;
  }

  const scoresHtml = latest?.scores ? `
    <div class="card mt-4">
      <div class="card-title">ציוני ביצועים</div>
      ${Object.entries(latest.scores).filter(([k]) => k !== 'overall').map(([k, v]) =>
        scoreBar(scoreLabels[k] || k, v)
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
  const INTEGRATION_NAMES = { google_ads: 'Google Ads', ga4: 'Google Analytics', meta: 'Meta Ads' };
  const OAUTH_ERRORS = {
    google_not_configured:  'חיבור Google לא מופעל — צור קשר עם התמיכה',
    google_denied:          'ביטלת את החיבור ל-Google',
    google_missing_params:  'שגיאה בחיבור Google — נסה שנית',
    google_exchange_failed: 'חיבור Google נכשל — נסה שנית',
    google_save_failed:     'שמירת חיבור Google נכשלה — נסה שנית',
    google_invalid_state:   'בקשת חיבור Google לא תקינה — נסה שנית',
    meta_not_configured:    'חיבור Meta לא מופעל — צור קשר עם התמיכה',
    meta_denied:            'ביטלת את החיבור ל-Meta',
    meta_missing_params:    'שגיאה בחיבור Meta — נסה שנית',
    meta_exchange_failed:   'חיבור Meta נכשל — נסה שנית',
    meta_save_failed:       'שמירת חיבור Meta נכשלה — נסה שנית',
    meta_invalid_state:     'בקשת חיבור Meta לא תקינה — נסה שנית',
  };
  const connectedParam = params.get('connected');
  const errorParam     = params.get('error');
  if (connectedParam) toast(`${INTEGRATION_NAMES[connectedParam] || connectedParam} חובר בהצלחה! 🎉`, 'success');
  if (errorParam)     toast(OAUTH_ERRORS[errorParam] || `שגיאה בחיבור: ${errorParam}`, 'error');
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
    toast('הבקשה התקבלה! מחפש אישור תשלום...', 'success');
    setTimeout(() => navigate('billing'), 500);
    pollPaymentActivation();
  } catch (err) {
    toast(err.message || 'שגיאה — נסו שנית', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'שילמתי, הפעילו לי את החשבון'; }
  }
}

// Poll subscription status every 10s for up to 5 min after payment-pending
function pollPaymentActivation() {
  let attempts = 0;
  const maxAttempts = 30; // 30 × 10s = 5 min
  const poll = async () => {
    attempts++;
    try {
      const { data: sub } = await sb.from('subscriptions')
        .select('plan,status,payment_status')
        .eq('user_id', state.user?.id)
        .maybeSingle();
      if (sub && sub.payment_status === 'verified') {
        state.subscription = sub;
        toast('🎉 התשלום אושר! החשבון שלך הופעל.', 'success');
        navigate('dashboard');
        return;
      }
    } catch {}
    if (attempts < maxAttempts) {
      setTimeout(poll, 10000);
    }
  };
  setTimeout(poll, 10000);
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
    pollPaymentActivation();
    if (inner) inner.innerHTML = `
      <div style="font-size:2.5rem;margin-bottom:1rem">✅</div>
      <h3 style="font-size:1.05rem;font-weight:700;margin-bottom:0.5rem">הבקשה התקבלה!</h3>
      <p style="font-size:0.875rem;color:#64748b">אנחנו בודקים את התשלום ברקע — תקבלו עדכון ברגע שיאושר.<br>תקבלו גם אימייל אישור.</p>
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

// ── Business Profile ──────────────────────────────────────────────────────────
async function renderBusinessProfile() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let bp = {};
  try {
    bp = await api('GET', 'business-profile') || {};
  } catch {}

  const v = (k, fallback = '') => {
    const val = bp[k];
    return val == null ? fallback : String(val).replace(/"/g, '&quot;');
  };
  // Backend returns: bp.completion.pct (nested) and bp.completion_score (flat alias)
  const score = bp.completion?.pct ?? bp.completion_score ?? bp.completionScore ?? null;
  const scorePct = score != null ? Math.round(score) : null;

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">🏢 פרופיל עסקי</h1>
        <p class="page-subtitle">מידע זה משמש את ה-AI ליצירת תוכן מדויק עבורך</p>
      </div>
      ${scorePct != null ? `
      <div style="text-align:center">
        ${renderDonutSVG(scorePct, 100)}
        <div class="text-xs text-muted mt-1">השלמת פרופיל</div>
      </div>` : ''}
    </div>

    <form onsubmit="saveBusinessProfile(event)">
      <div class="card mb-4">
        <div class="card-title">פרטי העסק</div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label">שם העסק</label>
            <input class="form-input" id="bp-business_name" value="${v('business_name')}" placeholder="לדוגמה: קליניקת ד&quot;ר כהן" />
          </div>
          <div class="form-group">
            <label class="form-label">קטגוריה / ענף</label>
            <input class="form-input" id="bp-category" value="${v('category')}" placeholder="לדוגמה: בריאות, נדל&quot;ן, e-commerce" />
          </div>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-title">מה אתם מוכרים <span class="required-star">*</span></div>
        <div class="form-group">
          <label class="form-label">ההצעה / המוצר / השירות</label>
          <textarea class="form-input" id="bp-offer" rows="3" placeholder="תארו בפירוט את מה שאתם מציעים ללקוחות">${v('offer')}</textarea>
        </div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label">מחיר (מספר) <span class="required-star">*</span></label>
            <input class="form-input" id="bp-price_amount" type="number" min="0" value="${v('price_amount')}" placeholder="לדוגמה: 297" />
          </div>
          <div class="form-group">
            <label class="form-label">מודל תמחור <span class="required-star">*</span></label>
            <select class="form-input" id="bp-pricing_model">
              <option value="">בחרו מודל</option>
              ${['חד פעמי','מנוי חודשי','מנוי שנתי','תשלום לפי שימוש','פרויקט','שעתי'].map(o =>
                `<option value="${o}" ${v('pricing_model') === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-title">הלקוח האידיאלי</div>
        <div class="form-group">
          <label class="form-label">קהל יעד <span class="required-star">*</span></label>
          <textarea class="form-input" id="bp-target_audience" rows="2" placeholder="מי הלקוח האידיאלי שלכם? גיל, מקצוע, מצב, תחומי עניין">${v('target_audience')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">הבעיה שאתם פותרים <span class="required-star">*</span></label>
          <textarea class="form-input" id="bp-problem_solved" rows="2" placeholder="מה הכאב / הבעיה שהלקוח חווה לפני שהוא קונה מכם?">${v('problem_solved')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">התוצאה הרצויה <span class="required-star">*</span></label>
          <textarea class="form-input" id="bp-desired_outcome" rows="2" placeholder="איפה הלקוח רוצה להיות לאחר שיקנה מכם?">${v('desired_outcome')}</textarea>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-title">אסטרטגיה שיווקית</div>
        <div class="form-group">
          <label class="form-label">מטרה עיקרית <span class="required-star">*</span></label>
          <select class="form-input" id="bp-primary_goal">
            <option value="">בחרו מטרה</option>
            ${['גיוס לידים','מכירה ישירה','הגברת מודעות','שמירת לקוחות','הגדלת ROAS'].map(o =>
              `<option value="${o}" ${v('primary_goal') === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label">מנגנון ייחודי (USP)</label>
            <input class="form-input" id="bp-unique_mechanism" value="${v('unique_mechanism')}" placeholder="מה הופך אתכם לייחודיים?" />
          </div>
          <div class="form-group">
            <label class="form-label">ההבטחה המרכזית</label>
            <input class="form-input" id="bp-main_promise" value="${v('main_promise')}" placeholder="המשפט שמביא לידים" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">תקציב חודשי לפרסום (₪)</label>
          <input class="form-input" id="bp-monthly_budget" type="number" min="0" value="${v('monthly_budget')}" placeholder="לדוגמה: 5000" />
        </div>
      </div>

      <div class="flex gap-3" style="margin-bottom:2rem">
        <button type="submit" class="btn btn-primary" style="width:auto;padding:0.75rem 2.5rem" id="bp-save-btn">
          שמור פרופיל עסקי
        </button>
      </div>
    </form>
  `);
}

async function saveBusinessProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('bp-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'שומר...'; }
  const fields = ['business_name','category','offer','price_amount','pricing_model',
                  'target_audience','problem_solved','desired_outcome','primary_goal',
                  'unique_mechanism','main_promise','monthly_budget'];
  const payload = {};
  fields.forEach(f => {
    const el = document.getElementById('bp-' + f);
    if (!el) return;
    const val = el.value.trim();
    if (val !== '') {
      payload[f] = (f === 'price_amount' || f === 'monthly_budget') ? Number(val) : val;
    }
  });
  try {
    await api('POST', 'business-profile', payload);
    toast('הפרופיל העסקי נשמר בהצלחה!', 'success');
    navigate('business_profile');
  } catch (err) {
    toast(err.message || 'שגיאה בשמירה', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'שמור פרופיל עסקי'; }
  }
}

// ── AI Saved Works (localStorage) ─────────────────────────────────────────────
function loadAISavedWorks() {
  try {
    const key = 'ai_saved_works_' + (state.user?.id || 'anon');
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch { return []; }
}
function saveAIWork(type, title, content) {
  try {
    const key = 'ai_saved_works_' + (state.user?.id || 'anon');
    const works = loadAISavedWorks();
    works.unshift({ id: Date.now(), type, title, content, created_at: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(works.slice(0, 50)));
    toast('נשמר בהצלחה!', 'success');
  } catch { toast('שגיאה בשמירה', 'error'); }
}

// ── AI Creation ───────────────────────────────────────────────────────────────
// Form-based creative asset generator — NOT the chat widget.
// Sub-tabs: ad_script | landing_page | saved
let aiCreationTab = 'ad_script';

async function renderAICreation() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  // Load business profile for pre-fill hints
  let bp = {};
  try { bp = await api('GET', 'business-profile') || {}; } catch {}

  // Load saved assets from localStorage (no backend endpoint needed)
  const saved = loadAISavedWorks();

  _renderAICreationShell(bp, saved);
}

function _renderAICreationShell(bp, saved) {
  const tab = aiCreationTab;
  const hint = bp.offer ? `הצעה נוכחית: ${bp.offer.slice(0, 60)}...` : '';

  const tabContent = {
    ad_script: `
      <div class="card">
        <div class="card-title">✍️ בנה תסריט למודעה</div>
        <p class="text-sm text-muted mb-4">מלא את הפרטים ו-AI יכתוב תסריט מלא בעברית מותאם לפלטפורמה</p>
        ${hint ? `<div class="text-xs text-muted mb-3" style="background:#f1f5f9;padding:0.5rem 0.75rem;border-radius:0.5rem">${hint}</div>` : ''}
        <div class="form-group">
          <label class="form-label">פלטפורמה</label>
          <select class="form-input" id="ai-platform">
            <option value="facebook">פייסבוק / אינסטגרם</option>
            <option value="google">Google Ads</option>
            <option value="youtube">יוטיוב (וידאו)</option>
            <option value="tiktok">TikTok</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">המוצר / שירות</label>
          <input class="form-input" id="ai-offer" value="${(bp.offer||'').replace(/"/g,'&quot;').slice(0,120)}" placeholder="מה אתם מוכרים?" />
        </div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label">קהל יעד</label>
            <input class="form-input" id="ai-audience" value="${(bp.target_audience||'').replace(/"/g,'&quot;').slice(0,80)}" placeholder="למי הפרסומת?" />
          </div>
          <div class="form-group">
            <label class="form-label">הבעיה שנפתרת</label>
            <input class="form-input" id="ai-problem" value="${(bp.problem_solved||'').replace(/"/g,'&quot;').slice(0,80)}" placeholder="מה הכאב של הלקוח?" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">סגנון תסריט</label>
          <select class="form-input" id="ai-tone">
            <option value="emotional">רגשי / סיפורי</option>
            <option value="direct">ישיר ועניני (AIDA)</option>
            <option value="social_proof">הוכחה חברתית</option>
            <option value="problem_solution">בעיה–פתרון</option>
            <option value="curiosity">סקרנות / קליק-בייט חוקי</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">קריאה לפעולה (CTA)</label>
          <input class="form-input" id="ai-cta" placeholder="לדוגמה: השאר פרטים, קנה עכשיו, קבל הצעת מחיר" />
        </div>
        <div id="ai-result-ad" style="display:none" class="card mt-4" style="background:#f8fafc">
          <div class="flex items-center justify-between mb-2">
            <div class="card-title" style="margin:0">התסריט שלך</div>
            <div class="flex gap-2">
              <button id="ai-save-ad-btn" class="btn btn-sm btn-secondary" style="display:none">💾 שמור</button>
              <button class="btn btn-sm btn-secondary" onclick="copyAIResult('ai-result-ad-text')">📋 העתק</button>
            </div>
          </div>
          <div id="ai-result-ad-text" class="text-sm" style="white-space:pre-wrap;line-height:1.7"></div>
        </div>
        <button class="btn btn-gradient mt-4" style="width:auto;padding:0.75rem 2.5rem"
          id="ai-gen-ad-btn" onclick="generateAdScript()">
          ✨ צור תסריט
        </button>
      </div>`,

    landing_page: `
      <div class="card">
        <div class="card-title">🏗️ תכנן מבנה לדף נחיתה</div>
        <p class="text-sm text-muted mb-4">AI יבנה תכנית מפורטת לדף נחיתה ממיר בעברית, כולל headline, כפתורי CTA, וסעיפים</p>
        ${hint ? `<div class="text-xs text-muted mb-3" style="background:#f1f5f9;padding:0.5rem 0.75rem;border-radius:0.5rem">${hint}</div>` : ''}
        <div class="form-group">
          <label class="form-label">מוצר / שירות</label>
          <textarea class="form-input" id="lp-offer" rows="2" placeholder="תארו מה המוצר ומה ההצעה שלכם">${(bp.offer||'').replace(/</g,'&lt;')}</textarea>
        </div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label">קהל יעד</label>
            <input class="form-input" id="lp-audience" value="${(bp.target_audience||'').replace(/"/g,'&quot;').slice(0,80)}" placeholder="מי הגולש שמגיע לדף?" />
          </div>
          <div class="form-group">
            <label class="form-label">מטרת הדף</label>
            <select class="form-input" id="lp-goal">
              <option value="lead_gen">איסוף לידים</option>
              <option value="direct_sale">מכירה ישירה</option>
              <option value="webinar">הרשמה לוובינר</option>
              <option value="consultation">קביעת פגישה</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">ההבטחה / ה-USP המרכזי</label>
          <input class="form-input" id="lp-promise" value="${(bp.main_promise||'').replace(/"/g,'&quot;')}" placeholder="מה ההבטחה שתגרום לגולש להישאר?" />
        </div>
        <div id="ai-result-lp" style="display:none" class="card mt-4" style="background:#f8fafc">
          <div class="flex items-center justify-between mb-2">
            <div class="card-title" style="margin:0">מבנה דף הנחיתה</div>
            <div class="flex gap-2">
              <button id="ai-save-lp-btn" class="btn btn-sm btn-secondary" style="display:none">💾 שמור</button>
              <button class="btn btn-sm btn-secondary" onclick="copyAIResult('ai-result-lp-text')">📋 העתק</button>
            </div>
          </div>
          <div id="ai-result-lp-text" class="text-sm" style="white-space:pre-wrap;line-height:1.7"></div>
        </div>
        <button class="btn btn-gradient mt-4" style="width:auto;padding:0.75rem 2.5rem"
          id="ai-gen-lp-btn" onclick="generateLandingPage()">
          ✨ צור מבנה דף נחיתה
        </button>
      </div>`,

    ad_creative: `
      <div class="card">
        <div class="card-title">🖼️ צור מודעה מוכנה</div>
        <p class="text-sm text-muted mb-4">AI יכתוב מודעה מוכנה לפרסום — כותרת, תיאור וקריאה לפעולה — מותאמת לפלטפורמה</p>
        ${hint ? `<div class="text-xs text-muted mb-3" style="background:#f1f5f9;padding:0.5rem 0.75rem;border-radius:0.5rem">${hint}</div>` : ''}
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label">פלטפורמה</label>
            <select class="form-input" id="creative-platform">
              <option value="facebook">פייסבוק</option>
              <option value="instagram">אינסטגרם</option>
              <option value="google">Google Ads</option>
              <option value="tiktok">TikTok</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">סוג מודעה</label>
            <select class="form-input" id="creative-type">
              <option value="awareness">מודעת חשיפה</option>
              <option value="lead">לידים</option>
              <option value="conversion">המרה</option>
              <option value="retargeting">ריטרגטינג</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">המוצר / שירות</label>
          <input class="form-input" id="creative-offer" value="${(bp.offer||'').replace(/"/g,'&quot;').slice(0,120)}" placeholder="מה אתם מוכרים?" />
        </div>
        <div class="form-group">
          <label class="form-label">קהל יעד</label>
          <input class="form-input" id="creative-audience" value="${(bp.target_audience||'').replace(/"/g,'&quot;').slice(0,80)}" placeholder="מי הקהל שתפנו?" />
        </div>
        <div class="form-group">
          <label class="form-label">ההצעה / מבצע</label>
          <input class="form-input" id="creative-deal" value="${(bp.main_promise||'').replace(/"/g,'&quot;')}" placeholder="למשל: ניסיון חינם 14 יום, הנחה 30%" />
        </div>
        <div id="ai-result-creative" style="display:none" class="card mt-4" style="background:#f8fafc">
          <div class="flex items-center justify-between mb-2">
            <div class="card-title" style="margin:0">המודעה שלך</div>
            <div class="flex gap-2">
              <button id="ai-save-creative-btn" class="btn btn-sm btn-secondary" style="display:none">💾 שמור</button>
              <button class="btn btn-sm btn-secondary" onclick="copyAIResult('ai-result-creative-text')">📋 העתק</button>
            </div>
          </div>
          <div id="ai-result-creative-text" class="text-sm" style="white-space:pre-wrap;line-height:1.7"></div>
        </div>
        <button class="btn btn-gradient mt-4" style="width:auto;padding:0.75rem 2.5rem"
          id="ai-gen-creative-btn" onclick="generateAdCreative()">
          🖼️ צור מודעה
        </button>
      </div>`,

    saved: `
      <div class="card">
        <div class="card-title">📁 עבודות שמורות</div>
        ${saved.length === 0
          ? `<div class="empty-state">
               <div class="empty-state-icon">📄</div>
               <h3 class="empty-state-title">אין עבודות שמורות עדיין</h3>
               <p class="empty-state-desc">צרו תסריט או מבנה דף נחיתה — הם יישמרו כאן</p>
             </div>`
          : saved.map(w => `
              <div class="saved-work-item">
                <div class="saved-work-body">
                  <div class="saved-work-title">${w.title || w.type || 'נכס שיווקי'}</div>
                  <div class="saved-work-meta">${w.created_at ? new Date(w.created_at).toLocaleDateString('he-IL') : ''}</div>
                  <div class="saved-work-preview">${(w.content || '').slice(0, 120)}</div>
                </div>
                <button class="btn btn-sm btn-secondary" onclick="expandSavedWork(this, ${JSON.stringify((w.content||'').replace(/'/g,"&#39;"))})">הצג</button>
              </div>`).join('')}
      </div>`
  };

  renderShell(`
    <div class="page-header">
      <h1 class="page-title">✨ יצירה עם AI</h1>
      <p class="page-subtitle">בנה נכסים שיווקיים מנצחים ללא תלות בחיבור אינטגרציות</p>
    </div>
    <div class="ai-tabs">
      <button class="ai-tab ${tab==='ad_script'?'active':''}"     onclick="switchAITab('ad_script')">✍️ תסריט מודעה</button>
      <button class="ai-tab ${tab==='ad_creative'?'active':''}"   onclick="switchAITab('ad_creative')">🖼️ מודעה מוכנה</button>
      <button class="ai-tab ${tab==='landing_page'?'active':''}"  onclick="switchAITab('landing_page')">🏗️ דף נחיתה</button>
      <button class="ai-tab ${tab==='saved'?'active':''}"         onclick="switchAITab('saved')">📁 עבודות שמורות</button>
    </div>
    ${tabContent[tab] || tabContent.ad_script}
  `);
}

function switchAITab(tab) {
  aiCreationTab = tab;
  navigate('ai_creation');
}

async function generateAdScript() {
  const btn = document.getElementById('ai-gen-ad-btn');
  const resBox = document.getElementById('ai-result-ad');
  const resText = document.getElementById('ai-result-ad-text');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'יוצר...';
  const platform = document.getElementById('ai-platform')?.value || 'facebook';
  const offer    = document.getElementById('ai-offer')?.value.trim() || '';
  const audience = document.getElementById('ai-audience')?.value.trim() || '';
  const problem  = document.getElementById('ai-problem')?.value.trim() || '';
  const tone     = document.getElementById('ai-tone')?.value || 'emotional';
  const cta      = document.getElementById('ai-cta')?.value.trim() || '';
  if (!offer) { toast('נא למלא את שדה המוצר / שירות', 'error'); btn.disabled = false; btn.textContent = '✨ צור תסריט'; return; }
  try {
    const result = await api('POST', 'campaigner-chat', {
      message: `[DIRECT_GENERATE] כתוב תסריט מודעה מלא לפלטפורמה: ${platform}. מוצר/שירות: ${offer}. קהל יעד: ${audience}. בעיה שנפתרת: ${problem}. סגנון: ${tone}. CTA: ${cta}. כתוב רק את התסריט עצמו בעברית, ישיר וממיר, ללא הסברים נוספים.`,
      history: [],
    });
    const text = result.reply || '';
    if (resBox) resBox.style.display = '';
    if (resText) resText.textContent = text;
    // Show save button
    const saveBtn = document.getElementById('ai-save-ad-btn');
    if (saveBtn) { saveBtn.style.display = ''; saveBtn.onclick = () => saveAIWork('ad_script', 'תסריט מודעה', text); }
    toast('התסריט נוצר!', 'success');
  } catch (err) {
    toast(err.message || 'שגיאה ביצירת תסריט', 'error');
  } finally {
    btn.disabled = false; btn.textContent = '✨ צור תסריט';
  }
}

async function generateLandingPage() {
  const btn = document.getElementById('ai-gen-lp-btn');
  const resBox = document.getElementById('ai-result-lp');
  const resText = document.getElementById('ai-result-lp-text');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'יוצר...';
  const offer    = document.getElementById('lp-offer')?.value.trim() || '';
  const audience = document.getElementById('lp-audience')?.value.trim() || '';
  const goal     = document.getElementById('lp-goal')?.value || 'lead_gen';
  const promise  = document.getElementById('lp-promise')?.value.trim() || '';
  if (!offer) { toast('נא למלא את שדה המוצר / שירות', 'error'); btn.disabled = false; btn.textContent = '✨ צור מבנה דף נחיתה'; return; }
  try {
    const result = await api('POST', 'campaigner-chat', {
      message: `[DIRECT_GENERATE] תכנן מבנה מפורט לדף נחיתה ממיר בעברית. מוצר/שירות: ${offer}. קהל יעד: ${audience}. מטרת הדף: ${goal}. ההבטחה המרכזית: ${promise}. פרט כל section בדף: headline, sub-headline, CTA, הוכחה חברתית, FAQ וכו'. כתוב רק את המבנה עצמו.`,
      history: [],
    });
    const text = result.reply || '';
    if (resBox) resBox.style.display = '';
    if (resText) resText.textContent = text;
    // Show save button
    const saveBtn = document.getElementById('ai-save-lp-btn');
    if (saveBtn) { saveBtn.style.display = ''; saveBtn.onclick = () => saveAIWork('landing_page', 'מבנה דף נחיתה', text); }
    toast('המבנה נוצר!', 'success');
  } catch (err) {
    toast(err.message || 'שגיאה ביצירת מבנה', 'error');
  } finally {
    btn.disabled = false; btn.textContent = '✨ צור מבנה דף נחיתה';
  }
}

async function generateAdCreative() {
  const btn = document.getElementById('ai-gen-creative-btn');
  const resBox = document.getElementById('ai-result-creative');
  const resText = document.getElementById('ai-result-creative-text');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'יוצר...';
  const platform = document.getElementById('creative-platform')?.value || 'facebook';
  const type     = document.getElementById('creative-type')?.value || 'conversion';
  const offer    = document.getElementById('creative-offer')?.value.trim() || '';
  const audience = document.getElementById('creative-audience')?.value.trim() || '';
  const deal     = document.getElementById('creative-deal')?.value.trim() || '';
  if (!offer) { toast('נא למלא את שדה המוצר / שירות', 'error'); btn.disabled = false; btn.textContent = '🖼️ צור מודעה'; return; }
  const typeLabels = { awareness: 'חשיפה', lead: 'לידים', conversion: 'המרה', retargeting: 'ריטרגטינג' };
  try {
    const result = await api('POST', 'campaigner-chat', {
      message: `[DIRECT_AD] כתוב מודעה מוכנה לפלטפורמה: ${platform}, סוג: ${typeLabels[type]||type}. מוצר/שירות: ${offer}. קהל יעד: ${audience}. הצעה/מבצע: ${deal||'לא צוין'}. כתוב בפורמט:\n**כותרת:** [כותרת קצרה מושכת]\n**תיאור:** [תיאור 2-3 שורות]\n**קריאה לפעולה:** [CTA חד]\n**וריאציה 2 — כותרת:** [אלטרנטיבה]\nבעברית, ישיר וממיר.`,
      history: [],
    });
    const text = result.reply || '';
    if (resBox) resBox.style.display = '';
    if (resText) resText.textContent = text;
    const saveBtn = document.getElementById('ai-save-creative-btn');
    if (saveBtn) { saveBtn.style.display = ''; saveBtn.onclick = () => saveAIWork('ad_creative', 'מודעה מוכנה', text); }
    toast('המודעה נוצרה!', 'success');
  } catch (err) {
    toast(err.message || 'שגיאה ביצירת מודעה', 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🖼️ צור מודעה';
  }
}

function copyAIResult(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent || '').then(() => toast('הועתק!', 'success')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = el.textContent || '';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    toast('הועתק!', 'success');
  });
}

function expandSavedWork(btn, content) {
  const item = btn.closest('.saved-work-item');
  if (!item) return;
  let expanded = item.querySelector('.saved-work-expanded');
  if (expanded) { expanded.remove(); btn.textContent = 'הצג'; return; }
  expanded = document.createElement('div');
  expanded.className = 'saved-work-expanded';
  expanded.style.cssText = 'margin-top:0.75rem;white-space:pre-wrap;font-size:0.8125rem;line-height:1.65;color:#374151;background:#f8fafc;border-radius:0.5rem;padding:0.75rem';
  expanded.textContent = content;
  item.querySelector('.saved-work-body').appendChild(expanded);
  btn.textContent = 'סגור';
}

// ── Marketing Assets ──────────────────────────────────────────────────────────
async function renderMarketingAssets() {
  // Check if user has any landing pages saved (to decide whether to show leads)
  const hasLandingPages = loadAISavedWorks().some(a => a.type === 'landing_page');

  const plan = state.subscription?.plan || 'free';
  const canCreate = getPlanLimits(plan).campaignLimit !== 0;

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">📊 ניתוח קמפיינים</h1>
        <p class="page-subtitle">נהל ונתח את הקמפיינים הפעילים שלך</p>
      </div>
      ${canCreate
        ? `<button class="btn btn-gradient" style="width:auto" onclick="showAddCampaignModal()">+ נכס חדש</button>`
        : `<button class="btn btn-secondary" style="width:auto" onclick="navigate('billing')">שדרג ליצירה →</button>`}
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
            <p class="empty-state-desc">לחצו על "+ נכס חדש" כדי להוסיף קמפיין לניתוח</p>
            ${!canCreate
              ? `<button class="btn btn-gradient" style="width:auto" onclick="navigate('billing')">שדרג ליצירת נכסים →</button>`
              : `<button class="btn btn-gradient" style="width:auto" onclick="showAddCampaignModal()">+ צור נכס ראשון</button>`}
          </div>
        </div>`}
    </div>

    ${hasLandingPages ? `
    <div class="card mt-4">
      <div class="card-title">📋 לידים</div>
      <p class="text-sm text-muted">לידים שנאספו מדפי הנחיתה שלך יופיעו כאן</p>
      <div class="empty-state" style="padding:1.5rem 0">
        <div class="empty-state-icon">📥</div>
        <h3 class="empty-state-title">אין לידים עדיין</h3>
        <p class="empty-state-desc">פרסם את דף הנחיתה שלך כדי להתחיל לאסוף לידים</p>
      </div>
    </div>` : ''}
  `);
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function renderSettings() {
  // Settings is now minimal — only profile + data actions
  renderShell(`
    <div class="page-header">
      <h1 class="page-title">⚙️ הגדרות חשבון</h1>
    </div>
    <div class="flex flex-col gap-6">
      <div class="card">
        <div class="card-title">פרופיל משתמש</div>
        <form onsubmit="saveProfile(event)">
          <div class="form-group">
            <label class="form-label">שם מלא</label>
            <input class="form-input" id="profile-name" value="${state.profile?.name || ''}" />
          </div>
          <div class="form-group">
            <label class="form-label">אימייל</label>
            <input class="form-input" type="email" id="profile-email" value="${state.profile?.email || state.user?.email || ''}" readonly style="opacity:0.65;cursor:not-allowed" />
          </div>
          <button type="submit" class="btn btn-primary" style="width:auto">שמור שינויים</button>
        </form>
      </div>
      <div class="card">
        <div class="card-title">פרטיות ונתונים</div>
        <p class="text-sm text-muted mb-3">לשאלות בנוגע לנתונים או לביטול — <button onclick="navigate('support')" class="btn btn-sm btn-secondary" style="display:inline;padding:0.2rem 0.5rem">פנה לתמיכה</button></p>
        <div class="flex gap-2">
          <button class="btn btn-secondary" onclick="exportData()">📥 ייצוא נתונים</button>
          <button class="btn btn-danger"    onclick="deleteAccount()">🗑 מחיקת חשבון</button>
        </div>
      </div>
    </div>
  `);
}

// ── Support page ──────────────────────────────────────────────────────────────
function renderSupport() {
  const log = getSysLog();
  renderShell(`
    <div class="page-header">
      <h1 class="page-title">💬 תמיכה</h1>
      <p class="page-subtitle">שאלה, בעיה, או בקשה לתכונה — נחזור תוך יום עסקים</p>
    </div>
    <div class="flex flex-col gap-6">
      <div class="card">
        <div class="card-title">שלח פנייה</div>
        <div class="support-chat-log" id="support-chat-log">
          ${log.length === 0
            ? '<div class="text-sm text-muted" style="padding:0.75rem 0">עדיין לא נשלחו פניות.</div>'
            : log.map(m => `
              <div class="support-chat-msg ${m.role === 'user' ? 'support-msg-user' : 'support-msg-system'}">
                <div class="support-msg-label">${m.role === 'user' ? (state.profile?.name || 'אתה') : '🤝 CampaignAI'}</div>
                <div class="support-msg-body">${m.text}</div>
                <div class="support-msg-time">${new Date(m.ts).toLocaleString('he-IL')}</div>
              </div>`).join('')}
        </div>
        <div class="support-chat-input-row">
          <select class="form-input" id="support-subject" style="max-width:200px;flex-shrink:0">
            <option value="תמיכה טכנית">תמיכה טכנית</option>
            <option value="שאלה על חיוב">חיוב / תשלום</option>
            <option value="בקשת תכונה">בקשת תכונה</option>
            <option value="דיווח על באג">דיווח על באג</option>
            <option value="אחר">אחר</option>
          </select>
          <textarea class="form-input" id="support-message" rows="2"
            placeholder="כתוב את הפנייה שלך כאן..."
            onkeydown="if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();sendSupportMessage()}"
            style="flex:1;resize:none"></textarea>
          <button class="btn btn-primary" id="support-send-btn" onclick="sendSupportMessage()" style="flex-shrink:0;width:auto">שלח</button>
        </div>
        <div class="text-xs text-muted mt-2">Enter + Ctrl לשליחה מהירה</div>
      </div>
    </div>
  `);
  const log2 = document.getElementById('support-chat-log');
  if (log2) log2.scrollTop = log2.scrollHeight;
}

// ── System log (localStorage — visible on support page) ──────────────────────
function getSysLog() {
  try { return JSON.parse(localStorage.getItem('sys_log_' + (state.user?.id||'anon')) || '[]'); } catch { return []; }
}
function addSysLog(role, text) {
  try {
    const key = 'sys_log_' + (state.user?.id||'anon');
    const log = getSysLog();
    log.push({ role, text, ts: Date.now() });
    localStorage.setItem(key, JSON.stringify(log.slice(-50)));
  } catch {}
}

async function sendSupportMessage() {
  const btn = document.getElementById('support-send-btn');
  const msgEl = document.getElementById('support-message');
  const subject = document.getElementById('support-subject')?.value || 'פנייה';
  const message = msgEl?.value.trim() || '';
  if (!message) { toast('נא למלא הודעה', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'שולח...'; }
  addSysLog('user', `[${subject}] ${message}`);
  try {
    await api('POST', 'contact', {
      name:    state.profile?.name || '',
      email:   state.profile?.email || state.user?.email || '',
      subject,
      message,
    });
    addSysLog('system', 'קיבלנו את הפנייה שלך! נחזור אליך בהקדם תוך יום עסקים.');
    toast('הפנייה נשלחה! נחזור אליך בהקדם.', 'success');
    if (msgEl) msgEl.value = '';
  } catch (err) {
    addSysLog('system', `שגיאה בשליחה: ${err.message || 'נסה שנית'}`);
    toast(err.message || 'שגיאה בשליחת הפנייה', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'שלח'; }
    renderSupport(); // refresh chat log
  }
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
let adminUserFilter = 'all';

async function renderAdmin() {
  if (!state.profile?.is_admin) { navigate('dashboard'); return; }
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  let overview = null, usersData = null;
  [overview, usersData] = await Promise.all([
    api('GET', 'admin-overview').catch(e => { console.error('[admin] overview failed:', e.message); return null; }),
    api('GET', 'admin-users?limit=100&page=1').catch(e => { console.error('[admin] users failed:', e.message); return null; }),
  ]);

  const fmt    = n => n == null ? '—' : Number(n).toLocaleString('he-IL');
  const pct    = n => n == null ? '—' : (n * 100).toFixed(1) + '%';
  const curr   = n => n == null ? '—' : '₪' + (n / 100).toFixed(0);
  const pBadge = { free: 'badge-gray', early_bird: 'badge-blue', starter: 'badge-blue', pro: 'badge-green', agency: 'badge-green' };

  if (!overview && !usersData) {
    renderShell(`<div class="page-header"><h1 class="page-title">🛡️ לוח ניהול</h1></div>
      <div class="card"><div class="text-sm text-muted">לא ניתן לטעון נתוני ניהול כרגע. בדוק שהחשבון מוגדר כאדמין בסופאבייס ושה-env vars של האדמין מוגדרים.</div></div>`);
    return;
  }

  const allUsers    = usersData?.users || [];
  const pending     = allUsers.filter(u => u.paymentStatus === 'pending');
  const freeUsers   = allUsers.filter(u => u.plan === 'free' && u.paymentStatus !== 'pending');
  const paidUsers   = allUsers.filter(u => u.plan !== 'free');
  const earlyBirds  = allUsers.filter(u => u.plan === 'early_bird');
  const proUsers    = allUsers.filter(u => u.plan === 'pro' || u.plan === 'agency');

  const filterMap = {
    all:        allUsers,
    pending:    pending,
    free:       freeUsers,
    early_bird: earlyBirds,
    pro:        proUsers,
  };
  const filtered = filterMap[adminUserFilter] || allUsers;

  function usersTable(users) {
    if (!users.length) return '<p class="text-muted text-sm" style="padding:1rem">אין משתמשים בקטגוריה זו</p>';
    return `<div style="overflow-x:auto">
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
          ${users.map(u => `
            <tr style="border-bottom:1px solid #f1f5f9${u.paymentStatus === 'pending' ? ';background:#fffbeb' : ''}">
              <td style="padding:0.5rem 0.75rem">${u.email}${u.isAdmin ? ' <span class="badge badge-blue" style="font-size:0.65rem">admin</span>' : ''}${u.paymentStatus === 'pending' ? ' <span class="badge badge-yellow" style="font-size:0.65rem">⏳ pending</span>' : ''}</td>
              <td style="padding:0.5rem 0.75rem">${u.name || '—'}</td>
              <td style="padding:0.5rem 0.75rem"><span class="badge ${pBadge[u.plan] || 'badge-gray'}">${getPlanLabel(u.plan)}</span></td>
              <td style="padding:0.5rem 0.75rem">${u.campaignCount ?? '—'}</td>
              <td style="padding:0.5rem 0.75rem">${u.createdAt ? new Date(u.createdAt).toLocaleDateString('he-IL') : '—'}</td>
              <td style="padding:0.5rem 0.75rem">${u.paymentStatus === 'pending'
                ? `<button class="btn btn-sm btn-primary" onclick="activateUserPayment('${u.id}','${u.plan}')">הפעל</button>`
                : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  }

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
      <div class="stat-card"><div class="stat-label">MRR</div><div class="stat-value">${curr(overview?.mrr)}</div></div>
      <div class="stat-card"><div class="stat-label">סה"כ משתמשים</div><div class="stat-value">${fmt(overview?.totalUsers)}</div></div>
      <div class="stat-card"><div class="stat-label">הרשמות 24ש'</div><div class="stat-value">${fmt(overview?.newSignups24h)}</div></div>
      <div class="stat-card"><div class="stat-label">Churn</div><div class="stat-value">${pct(overview?.churnRate)}</div></div>
      <div class="stat-card"><div class="stat-label">המרה לתשלום</div><div class="stat-value">${pct(overview?.conversionRate)}</div></div>
      <div class="stat-card"><div class="stat-label">תשלומים כושלים 24ש'</div>
        <div class="stat-value" style="${(overview?.failedPayments24h || 0) > 0 ? 'color:#ef4444' : ''}">${fmt(overview?.failedPayments24h)}</div>
      </div>
    </div>

    <div class="analysis-card" style="margin-bottom:1.5rem">
      <div class="flex items-center justify-between mb-3"><h3 class="font-semibold">בריאות מערכת</h3></div>
      <div style="display:flex;gap:2rem;flex-wrap:wrap">
        <div><span class="text-muted text-sm">עבודות ממתינות</span><br><strong>${fmt(overview?.systemHealth?.pendingJobs)}</strong></div>
        <div><span class="text-muted text-sm">עבודות פועלות</span><br><strong>${fmt(overview?.systemHealth?.runningJobs)}</strong></div>
        <div><span class="text-muted text-sm">עבודות נכשלות 24ש'</span><br>
          <strong style="${(overview?.systemHealth?.failedJobs24h || 0) > 0 ? 'color:#ef4444' : ''}">${fmt(overview?.systemHealth?.failedJobs24h)}</strong>
        </div>
      </div>
    </div>

    <div class="analysis-card">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold">משתמשים</h3>
        <span class="text-muted text-sm">סה"כ ${fmt(allUsers.length)}</span>
      </div>
      <div class="plan-tabs">
        <button class="plan-tab ${adminUserFilter==='all'?'active':''}"        onclick="filterAdminUsers('all')">הכל (${allUsers.length})</button>
        ${pending.length > 0 ? `<button class="plan-tab ${adminUserFilter==='pending'?'active':''}" onclick="filterAdminUsers('pending')" style="${adminUserFilter!=='pending'?'border-color:#f59e0b;color:#92400e':''}">⏳ ממתין (${pending.length})</button>` : ''}
        <button class="plan-tab ${adminUserFilter==='free'?'active':''}"       onclick="filterAdminUsers('free')">חינמי (${freeUsers.length})</button>
        <button class="plan-tab ${adminUserFilter==='early_bird'?'active':''}" onclick="filterAdminUsers('early_bird')">Early Bird (${earlyBirds.length})</button>
        <button class="plan-tab ${adminUserFilter==='pro'?'active':''}"        onclick="filterAdminUsers('pro')">Pro/Agency (${proUsers.length})</button>
      </div>
      ${usersTable(filtered)}
    </div>`);
}

function filterAdminUsers(filter) {
  adminUserFilter = filter;
  renderAdmin();
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

// ── Main render (with queue to prevent concurrent renders) ────────────────────
let _renderRunning = false;
let _renderQueued  = false;

async function render() {
  if (_renderRunning) { _renderQueued = true; return; }
  _renderRunning = true;
  try {
    do {
      _renderQueued = false;
      const fn = routes[state.currentPage] || renderDashboard;
      await fn();
    } while (_renderQueued);
  } finally {
    _renderRunning = false;
  }
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
  const hash = window.location.hash.replace('#', '');
  const validPages = ['dashboard', 'business_profile', 'ai_creation', 'marketing_assets', 'campaigns', 'integrations', 'billing', 'settings', 'support', 'admin'];
  if (hash && validPages.includes(hash)) return hash;
  return 'dashboard';
}

async function boot() {
  const initialPage = resolveInitialPage();
  let bootCompleted = false;

  // Warm up Supabase without blocking boot
  fetch(window.__SUPABASE_URL__ + '/rest/v1/', {
    headers: { 'apikey': window.__SUPABASE_ANON_KEY__ }
  }).catch(() => {});

  sb.auth.onAuthStateChange(async (event, session) => {
    bootCompleted = true;

    // Token refresh — just update the token silently, no re-render needed
    if (event === 'TOKEN_REFRESHED') {
      if (session) state.accessToken = session.access_token;
      return;
    }

    if (!session) { renderAuth(); return; }

    state.user        = session.user;
    state.accessToken = session.access_token;

    // Show shell instantly — don't block on DB
    state.profile      = {};
    state.subscription = { plan: 'free' };
    state.campaigns    = [];
    state.integrations = [];
    if (state.currentPage === 'dashboard' && initialPage !== 'dashboard') {
      state.currentPage = initialPage;
    }
    render();
    initSupportChat();

    // Load all data in parallel in background, then refresh
    try {
      const [profile, sub, campsRes, intRes] = await Promise.all([
        sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('subscriptions').select('plan,status,payment_status').eq('user_id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('campaigns').select('id,name,created_at').eq('owner_user_id', session.user.id).order('created_at', { ascending: false }).then(r => r.data),
        api('GET', 'integration-connect').catch(() => []),
      ]);
      state.profile      = profile    || {};
      state.subscription = sub        || { plan: 'free' };
      state.campaigns    = campsRes   || [];
      state.integrations = Array.isArray(intRes) ? intRes : [];
    } catch {
      // keep defaults set above
    }
    // Re-render once with all data loaded
    render();
  });

  setTimeout(() => {
    if (!bootCompleted && document.querySelector('.loading-screen')) renderAuth();
  }, 8000);

  keepAlive();
}

// ══════════════════════════════════════════════════════════════════════════════
//  Support Chat Widget — floating bottom-right
//  Replaces the old AI chat. Users send support messages here.
//  Message history is stored in localStorage (same as support page).
// ══════════════════════════════════════════════════════════════════════════════

const chatState = { open: false };

// ── Build support log HTML from localStorage ──────────────────────────────────
function renderSupportLog() {
  const log = getSysLog();
  if (!log.length) {
    return `
      <div class="chat-welcome">
        <div class="chat-welcome-icon">💬</div>
        <h3>תמיכה ושאלות</h3>
        <p>שלום! שלח לנו הודעה ונחזור אליך בהקדם תוך יום עסקים.</p>
      </div>`;
  }
  const initials = (state.profile?.name || state.user?.email || '?').charAt(0).toUpperCase();
  return log.map(m => `
    <div class="chat-msg ${m.role === 'user' ? 'user' : 'assistant'}">
      <div class="chat-msg-icon">${m.role === 'user' ? initials : '💬'}</div>
      <div class="chat-msg-bubble">${m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    </div>`).join('');
}

// ── Refresh the log in the open chat panel ────────────────────────────────────
function refreshChatLog() {
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return;
  msgs.innerHTML = renderSupportLog();
  requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
}

// ── Build / inject widget DOM ─────────────────────────────────────────────────
function initSupportChat() {
  if (document.getElementById('chat-trigger')) return; // already mounted

  const trigger = document.createElement('button');
  trigger.id = 'chat-trigger';
  trigger.setAttribute('aria-label', 'פתח תמיכה');
  trigger.innerHTML = '<span>💬</span>';
  trigger.onclick = toggleChat;
  document.body.appendChild(trigger);

  const panel = document.createElement('div');
  panel.id = 'chat-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'תמיכה');
  panel.innerHTML = `
    <div class="chat-header">
      <div class="chat-avatar">💬</div>
      <div class="chat-header-info">
        <div class="chat-header-name">תמיכה</div>
        <div class="chat-header-sub">נחזור אליך תוך יום עסקים</div>
      </div>
      <div class="chat-status-dot" title="זמין"></div>
      <div class="chat-header-actions">
        <button class="chat-header-btn" onclick="toggleChat()" title="סגור">✕</button>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-input-bar">
      <select class="chat-support-select" id="chat-support-subject">
        <option value="תמיכה טכנית">תמיכה טכנית</option>
        <option value="שאלה על חיוב">חיוב</option>
        <option value="בקשת תכונה">בקשת תכונה</option>
        <option value="דיווח על באג">דיווח באג</option>
        <option value="אחר">אחר</option>
      </select>
      <textarea
        class="chat-input"
        id="chat-support-input"
        placeholder="כתוב הודעה..."
        rows="1"
        maxlength="2000"
      ></textarea>
      <button class="chat-send-btn" id="chat-send-btn" onclick="submitSupportChat()" title="שלח">➤</button>
    </div>`;
  document.body.appendChild(panel);

  const textarea = document.getElementById('chat-support-input');
  if (textarea) {
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitSupportChat(); }
    });
  }
}

// ── Toggle open/close ─────────────────────────────────────────────────────────
function toggleChat() {
  chatState.open = !chatState.open;
  const panel   = document.getElementById('chat-panel');
  const trigger = document.getElementById('chat-trigger');
  if (panel) panel.classList.toggle('open', chatState.open);
  if (trigger) trigger.innerHTML = chatState.open
    ? '<span style="font-size:1.1rem">✕</span>'
    : '<span>💬</span>';
  if (chatState.open) {
    refreshChatLog();
    document.getElementById('chat-support-input')?.focus();
  }
}

// ── Submit support message from chat widget ───────────────────────────────────
async function submitSupportChat() {
  const btn     = document.getElementById('chat-send-btn');
  const msgEl   = document.getElementById('chat-support-input');
  const subject = document.getElementById('chat-support-subject')?.value || 'פנייה';
  const message = msgEl?.value.trim() || '';
  if (!message) { toast('נא לכתוב הודעה', 'error'); return; }
  if (btn) { btn.disabled = true; }
  // Optimistically show message in log
  addSysLog('user', `[${subject}] ${message}`);
  if (msgEl) { msgEl.value = ''; msgEl.style.height = 'auto'; }
  refreshChatLog();
  try {
    await api('POST', 'contact', {
      name:    state.profile?.name    || '',
      email:   state.profile?.email   || state.user?.email || '',
      subject,
      message,
    });
    addSysLog('system', 'קיבלנו את הפנייה שלך! נחזור אליך בהקדם תוך יום עסקים.');
    toast('הפנייה נשלחה!', 'success');
  } catch (err) {
    addSysLog('system', `שגיאה: ${err.message || 'נסה שנית'}`);
    toast(err.message || 'שגיאה בשליחה', 'error');
  } finally {
    if (btn) btn.disabled = false;
    refreshChatLog();
    // Sync support page if open
    if (state.currentPage === 'support') renderSupport();
  }
}

// ── Expose to HTML event handlers ─────────────────────────────────────────────
window.navigate              = navigate;
window.handleLogout          = handleLogout;
window.saveBusinessProfile   = saveBusinessProfile;
window.switchAITab           = switchAITab;
window.generateAdScript      = generateAdScript;
window.generateLandingPage   = generateLandingPage;
window.generateAdCreative    = generateAdCreative;
window.copyAIResult          = copyAIResult;
window.expandSavedWork       = expandSavedWork;
window.filterAdminUsers      = filterAdminUsers;
window.pollPaymentActivation = pollPaymentActivation;
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
window.submitSupportChat     = submitSupportChat;
window.sendSupportMessage    = sendSupportMessage;
window.renderSupport         = renderSupport;

boot();
