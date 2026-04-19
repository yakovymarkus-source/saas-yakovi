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
  // Progressive unlock state
  onboardingSteps:   null,   // loaded from onboarding_progress table
  unlockedScreens:   new Set(['dashboard','business-profile']),
  businessProfile:   null,   // business_profiles row
  updatesCount:      0,      // unread system updates badge
  localNotifCount:   0,      // unread personal notifications (analysis, leads) from localStorage
  supportCount:      0,      // open support tickets (admin only)
};

// ── Router ────────────────────────────────────────────────────────────────────
const routes = {
  dashboard:          renderDashboard,
  'ai-creation':      renderAICreation,
  'landing-pages':    renderLandingPages,
  campaigns:          renderCampaigns,
  leads:              renderLeads,
  insights:           renderInsights,
  settings:           renderSettings,
  support:            renderSupport,
  admin:              renderAdmin,
  updates:            renderUpdates,
  // Legacy routes redirect into consolidated pages
  'business-profile': () => renderSettings('business'),
  integrations:       () => renderSettings('integrations'),
  billing:            () => renderSettings('billing'),
  recommendations:    () => renderInsights('recommendations'),
  performance:        () => renderInsights('performance'),
  economics:          () => renderInsights('economics'),
  'ab-tests':         () => renderInsights('abtests'),
  copy:               () => renderInsights('copy'),
};

// ── Tab state (var = accessible from inline onclick) ──────────────────────────
var settingsTab = 'business';
var insightsTab = 'performance';

// ── Progressive unlock helper ─────────────────────────────────────────────────
function computeUnlockedScreens(steps) {
  const screens = new Set(['dashboard', 'business-profile', 'landing-pages']);
  if (!steps) return screens;
  if (steps.first_asset)      { screens.add('recommendations'); screens.add('leads'); }
  if (steps.multiple_assets)  screens.add('copy');
  if (steps.has_metrics)      screens.add('performance');
  if (steps.has_ab_data)      { screens.add('ab-tests'); screens.add('economics'); }
  return screens;
}

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
  if (page === 'updates') state.updatesCount = 0;
  state.currentPage = page;
  Object.assign(state, params);
  // Update URL hash so page survives refresh
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
          <p style="text-align:center;margin-top:0.75rem;font-size:0.85rem">
            <a href="#" id="forgot-pw-link" style="color:var(--brand);text-decoration:none">שכחתי סיסמה</a>
          </p>
          <div style="display:flex;align-items:center;gap:0.5rem;margin:1rem 0">
            <div style="flex:1;height:1px;background:#e2e8f0"></div>
            <span style="color:#94a3b8;font-size:0.8rem">או</span>
            <div style="flex:1;height:1px;background:#e2e8f0"></div>
          </div>
          <button type="button" id="google-signin-btn" style="width:100%;display:flex;align-items:center;justify-content:center;gap:0.6rem;padding:0.65rem 1rem;border:1.5px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;font-size:0.95rem;font-weight:500;color:#1e293b;margin-bottom:0.5rem">
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            כניסה עם Google
          </button>
          <button type="button" id="facebook-signin-btn" style="width:100%;display:flex;align-items:center;justify-content:center;gap:0.6rem;padding:0.65rem 1rem;border:1.5px solid #e2e8f0;border-radius:8px;background:#1877F2;cursor:pointer;font-size:0.95rem;font-weight:500;color:#fff">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
            כניסה עם Facebook
          </button>
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

  async function oauthSignIn(provider) {
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + '/' }
    });
    if (error) {
      const errEl = document.getElementById('auth-error');
      errEl.textContent = error.message;
      errEl.style.display = '';
    }
  }

  document.getElementById('google-signin-btn').addEventListener('click', () => oauthSignIn('google'));
  document.getElementById('facebook-signin-btn').addEventListener('click', () => oauthSignIn('facebook'));

  document.getElementById('forgot-pw-link').addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    if (!email) { alert('הכנס אימייל קודם'); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/#reset-password'
    });
    if (error) alert('שגיאה: ' + error.message);
    else alert('נשלח מייל איפוס סיסמה ל-' + email);
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
  const SETTINGS_PAGES = ['settings','business-profile','integrations','billing'];
  const INSIGHTS_PAGES = ['insights','recommendations','performance','economics','ab-tests','copy'];

  const isActive = id => {
    if (id === 'settings') return SETTINGS_PAGES.includes(state.currentPage);
    if (id === 'insights') return INSIGHTS_PAGES.includes(state.currentPage);
    return state.currentPage === id;
  };

  const mainNav = [
    { id: 'dashboard',   icon: '📊', label: 'דשבורד' },
    { id: 'ai-creation', icon: '🤖', label: 'צור נכסים בAI' },
    { id: 'campaigns',   icon: '🎯', label: 'קמפיינים' },
    { id: 'leads',       icon: '📥', label: 'לידים' },
    { id: 'insights',    icon: '📈', label: 'תובנות' },
    { id: 'settings',    icon: '⚙️', label: 'הגדרות' },
  ];

  const initials    = (state.profile?.name || state.user?.email || '?').charAt(0).toUpperCase();
  const sidebarPlan = state.subscription?.plan || 'free';
  const isPending   = state.subscription?.payment_status === 'pending';
  const bellCount   = (state.updatesCount || 0) + (state.localNotifCount || 0) + (isPending ? 1 : 0);

  document.getElementById('app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <div class="sidebar-logo-badge">🧠</div>
          Campaign<span>AI</span>
        </div>
        <nav class="sidebar-nav">
          ${mainNav.map(n => `
            <div class="nav-item ${isActive(n.id) ? 'active' : ''}" data-page="${n.id}">
              <span class="nav-icon">${n.icon}</span><span class="nav-label">${n.label}</span>
            </div>`).join('')}
          ${state.profile?.is_admin ? `
            <div style="height:1px;background:rgba(255,255,255,0.1);margin:0.75rem 1rem;"></div>
            <div class="nav-item ${isActive('admin') ? 'active' : ''}" data-page="admin">
              <span class="nav-icon">🛡️</span><span class="nav-label">ניהול</span>
              ${state.supportCount > 0 ? `<span style="margin-right:auto;background:#ef4444;color:#fff;font-size:0.6rem;font-weight:700;min-width:1.1rem;height:1.1rem;border-radius:9999px;display:inline-flex;align-items:center;justify-content:center;padding:0 3px">${state.supportCount > 99 ? '99+' : state.supportCount}</span>` : ''}
            </div>` : ''}
        </nav>
        <div class="sidebar-footer">
          <button onclick="navigate('support')" style="width:100%;text-align:center;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:rgba(255,255,255,0.7);font-size:0.8rem;padding:0.45rem 0.75rem;cursor:pointer;margin-bottom:0.75rem;">
            💬 תמיכה
          </button>
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
      <main class="main-content" id="page-content">
        <div style="margin:-2rem -2rem 1.5rem;padding:0.5rem 1.5rem;display:flex;justify-content:flex-end;align-items:center;border-bottom:1px solid #f1f5f9;background:white;position:sticky;top:0;z-index:10;">
          <button data-bell-btn onclick="navigate('updates')" title="התראות ועדכונים"
            style="position:relative;background:none;border:none;cursor:pointer;font-size:1.3rem;padding:0.3rem;border-radius:50%;transition:background 0.15s;line-height:1;">
            🔔
            ${bellCount > 0 ? `<span data-bell-badge style="position:absolute;top:0;right:0;background:#ef4444;color:white;font-size:0.58rem;font-weight:700;min-width:1rem;height:1rem;border-radius:9999px;display:flex;align-items:center;justify-content:center;padding:0 2px;line-height:1;">${bellCount > 99 ? '99+' : bellCount}</span>` : ''}
          </button>
        </div>
        ${content}
      </main>
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

  // Load all data in parallel
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const [assetsRes, metricsRes, intRes, leadsRes] = await Promise.allSettled([
    sb.from('generated_assets').select('id,asset_type,status,created_at')
      .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(100),
    sb.from('asset_metrics').select('clicks,conversions,revenue')
      .eq('user_id', state.user.id),
    state.integrations.length ? Promise.resolve({ value: state.integrations })
      : api('GET', 'integration-connect').then(r => Array.isArray(r) ? r : []).catch(() => []),
    sb.from('leads').select('id,created_at,status')
      .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(200),
  ]);

  const allAssets    = assetsRes.status === 'fulfilled' ? (assetsRes.value.data || []) : [];
  const allMetrics   = metricsRes.status === 'fulfilled' ? (metricsRes.value.data || []) : [];
  const allLeads     = leadsRes.status === 'fulfilled'   ? (leadsRes.value.data   || []) : [];
  if (!state.integrations.length && intRes.status === 'fulfilled') {
    state.integrations = intRes.value?.value || intRes.value || [];
  }
  const leadsToday   = allLeads.filter(l => new Date(l.created_at) >= todayStart).length;
  const leadsNew     = allLeads.filter(l => l.status === 'new').length;

  const plan          = state.subscription?.plan || 'free';
  const paymentStatus = state.subscription?.payment_status || 'none';
  const isFree        = plan === 'free' && paymentStatus !== 'pending';
  const planBadge     = { free: 'badge-gray', early_bird: 'badge-blue', starter: 'badge-blue', pro: 'badge-green', agency: 'badge-green' };
  const connectedCount = (state.integrations || []).filter(i => i.connection_status !== 'revoked').length;

  // Asset KPIs
  const now30     = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent    = allAssets.filter(a => new Date(a.created_at) > now30);
  const published = allAssets.filter(a => a.status === 'published');
  const totalClicks  = allMetrics.reduce((s, m) => s + (m.clicks || 0), 0);
  const totalConv    = allMetrics.reduce((s, m) => s + (m.conversions || 0), 0);
  const totalRev     = allMetrics.reduce((s, m) => s + (m.revenue || 0), 0);
  const limits       = getPlanLimits(plan);
  const assetsMax    = limits.assetsLimit || 5;
  const assetsPct    = Math.min(100, Math.round((allAssets.length / assetsMax) * 100));

  const steps = state.onboardingSteps || {};

  renderShell(`
    ${isFree ? `
    <div class="promo-banner">
      <div class="promo-banner-main">
        <span style="font-size:0.9rem;font-weight:600">🎁 הטבת השקה: מסלול Early Bird ב-₪10 בלבד לכל החיים!</span>
        <button class="btn btn-sm" style="background:white;color:#4f46e5;font-weight:700"
          onclick="settingsTab='billing';navigate('settings')">שדרגו עכשיו →</button>
      </div>
      <div class="promo-banner-sub">
        כבר שילמתם?
        <button onclick="claimPayment()" class="promo-claim-link">לחצו כאן להפעלת החשבון</button>
      </div>
    </div>` : ''}

    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">שלום, ${state.businessProfile?.business_name || state.profile?.name || 'משתמש'}! 👋</h1>
        <p class="page-subtitle">${_dashGreeting(steps)}</p>
      </div>
      <span class="badge ${planBadge[plan] || 'badge-gray'}">${getPlanLabel(plan)}</span>
    </div>

    ${_renderOnboardingWidget(steps)}

    <div class="stats-grid">
      <div class="stat-card" onclick="navigate('leads')" style="cursor:pointer;${leadsToday > 0 ? 'border:2px solid #22c55e;' : ''}">
        <div class="stat-label">לידים היום</div>
        <div class="stat-value" style="${leadsToday > 0 ? 'color:#16a34a' : ''}">${leadsToday > 0 ? leadsToday : '—'}</div>
        <div class="text-xs text-muted">${leadsNew > 0 ? leadsNew + ' חדשים לטיפול' : 'אין לידים חדשים'}</div>
      </div>
      <div class="stat-card" onclick="navigate('campaigns')" style="cursor:pointer">
        <div class="stat-label">קמפיינים</div>
        <div class="stat-value">${state.campaigns.length > 0 ? state.campaigns.length : '—'}</div>
        <div class="text-xs text-muted">${state.campaigns.length > 0 ? 'לחץ לניהול קמפיינים' : 'לחץ ליצירת קמפיין'}</div>
      </div>
      <div class="stat-card" onclick="navigate('ai-creation')" style="cursor:pointer">
        <div class="stat-label">נכסים שיווקיים</div>
        <div style="display:flex;align-items:center;gap:0.75rem;margin-top:0.5rem">
          ${renderDonutSVG(allAssets.length, assetsMax)}
          <div>
            <div class="stat-value" style="font-size:1.25rem">${allAssets.length}${assetsMax !== Infinity ? ' / ' + assetsMax : ''}</div>
            <div class="text-xs text-muted" style="margin-top:0.1rem">${recent.length} ב-30 יום</div>
          </div>
        </div>
      </div>
      <div class="stat-card" onclick="navigate('insights')" style="cursor:pointer">
        <div class="stat-label">ביצועים</div>
        <div class="stat-value">${totalClicks > 0 ? totalClicks.toLocaleString() : '—'}</div>
        <div class="text-xs text-muted">${totalConv > 0 ? totalConv + ' המרות' : connectedCount > 0 ? connectedCount + ' חיבורים פעילים' : 'חבר אינטגרציות'}</div>
      </div>
    </div>

    <div class="card mb-4">
      <div class="card-title">⚡ פעולות מהירות</div>
      <div style="display:flex;gap:0.75rem;flex-wrap:wrap">
        <button class="btn btn-primary" style="width:auto" onclick="navigate('ai-creation')">✨ צור נכס חדש</button>
        <button class="btn btn-secondary" style="width:auto" onclick="navigate('leads')">📥 ניהול לידים</button>
        <button class="btn btn-secondary" style="width:auto" onclick="navigate('campaigns')">🎯 קמפיינים</button>
        <button class="btn btn-secondary" style="width:auto" onclick="navigate('insights')">📈 תובנות</button>
        ${connectedCount === 0 ? `<button class="btn btn-secondary" style="width:auto" onclick="switchSettingsTab('integrations');navigate('settings')">🔌 חבר אינטגרציה</button>` : ''}
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

    ${allAssets.length > 0 ? `
    <div class="card">
      <div class="card-title flex items-center justify-between">
        <span>🚀 דפים אחרונים</span>
        <button class="btn btn-sm btn-secondary" onclick="navigate('landing-pages')">כל הדפים</button>
      </div>
      <div class="campaign-list">
        ${allAssets.slice(0, 5).map(a => {
          const statusColor = { published: '#22c55e', draft: '#f59e0b', archived: '#94a3b8', failed: '#ef4444' }[a.status] || '#94a3b8';
          const statusLabel = { published: 'פורסם', draft: 'טיוטה', archived: 'ארכיון', failed: 'נכשל' }[a.status] || a.status;
          return `
          <div class="campaign-item">
            <div>
              <div class="campaign-name">${a.asset_type || 'דף נחיתה'}</div>
              <div class="campaign-meta">${new Date(a.created_at).toLocaleDateString('he-IL')}</div>
            </div>
            <span style="font-size:.75rem;padding:.2rem .6rem;border-radius:9999px;background:${statusColor}20;color:${statusColor}">${statusLabel}</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}
  `);

  if (connectedCount > 0 && !state.liveStatsLoading) {
    loadLiveStats().then(() => {
      const container = document.getElementById('live-stats-container');
      if (container) container.innerHTML = renderLiveStatsContent();
    });
  }
}

function _dashGreeting(steps) {
  if (!steps.profile_started) return 'נתחיל עם פרופיל עסקי קצר';
  if (!steps.first_asset)     return 'מוכן ליצור דף נחיתה ראשון?';
  if (!steps.multiple_assets) return 'כל הכבוד! ניצור עוד וריאציות?';
  if (!steps.has_metrics)     return 'הוסף מדדים כדי לראות ביצועים אמיתיים';
  return 'הנה סקירת הביצועים שלך';
}

function _renderOnboardingWidget(steps) {
  if (steps.has_metrics) return ''; // fully onboarded — hide widget

  const stageItems = [
    { key: 'profile_started',  label: 'פרופיל עסקי',       nav: "switchSettingsTab('business');navigate('settings')", done: steps.profile_started },
    { key: 'first_asset',      label: 'נכס שיווקי ראשון',  nav: "navigate('ai-creation')",   done: steps.first_asset,    blocked: !steps.profile_started },
    { key: 'multiple_assets',  label: '3 נכסים / וריאציות', nav: "navigate('ai-creation')",  done: steps.multiple_assets, blocked: !steps.first_asset },
    { key: 'has_metrics',      label: 'חבר אינטגרציה',     nav: "switchSettingsTab('integrations');navigate('settings')", done: steps.has_metrics, blocked: !steps.multiple_assets },
  ];
  const completedCount = stageItems.filter(s => s.done).length;
  const pct = Math.round((completedCount / stageItems.length) * 100);

  return `
  <div class="card mb-4" style="border:2px solid #e0e7ff;background:#f8f7ff">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
      <div>
        <div style="font-weight:700;font-size:1rem">🎯 תחילת דרך</div>
        <div class="text-muted" style="font-size:.85rem">${completedCount} מתוך ${stageItems.length} שלבים הושלמו</div>
      </div>
      <div style="font-size:1.25rem;font-weight:800;color:#6366f1">${pct}%</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem">
      ${stageItems.map(s => `
      <div onclick="${!s.done && !s.blocked ? s.nav : ''}"
        style="padding:.75rem;border-radius:.5rem;cursor:${s.done || s.blocked ? 'default' : 'pointer'};
          background:${s.done ? '#f0fdf4' : s.blocked ? '#f8fafc' : '#fff'};
          border:1px solid ${s.done ? '#86efac' : s.blocked ? '#e2e8f0' : '#c7d2fe'}">
        <div style="font-size:1.1rem;margin-bottom:.25rem">${s.done ? '✅' : s.blocked ? '🔒' : '⏳'}</div>
        <div style="font-size:.8rem;font-weight:${s.done ? '500' : '600'};color:${s.done ? '#15803d' : s.blocked ? '#94a3b8' : '#1e293b'}">${s.label}</div>
      </div>`).join('')}
    </div>
  </div>`;
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
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  // Reload integrations if needed
  if (!state.integrations.length) {
    try { const r = await api('GET', 'integration-connect'); state.integrations = Array.isArray(r) ? r : []; } catch {}
  }

  // Fetch latest verdict per campaign
  const verdicts = {};
  if (state.campaigns.length > 0) {
    try {
      const { data } = await sb.from('decision_history')
        .select('campaign_id,verdict,confidence,timestamp')
        .in('campaign_id', state.campaigns.map(c => c.id))
        .order('timestamp', { ascending: false });
      (data || []).forEach(d => { if (!verdicts[d.campaign_id]) verdicts[d.campaign_id] = d; });
    } catch {}

    // Also fetch latest scores
    try {
      const { data: scores } = await sb.from('analysis_results')
        .select('campaign_id,scores,created_at')
        .in('campaign_id', state.campaigns.map(c => c.id))
        .order('created_at', { ascending: false });
      if (scores) scores.forEach(s => {
        if (!verdicts[s.campaign_id]) verdicts[s.campaign_id] = {};
        if (!verdicts[s.campaign_id].scores) verdicts[s.campaign_id].scores = s.scores;
      });
    } catch {}
  }

  const activeConns = (state.integrations || []).filter(i => i.connection_status === 'active');
  const hasConns = activeConns.length > 0;
  const PLATFORM_NAMES = { google_ads: 'Google Ads', meta: 'Meta Ads', ga4: 'Analytics', tiktok: 'TikTok' };

  const statusDot = (verdict) => {
    if (!verdict) return `<span style="width:9px;height:9px;border-radius:50%;background:#cbd5e1;display:inline-block" title="לא נותח"></span>`;
    const v = verdict.verdict;
    const color = v === 'healthy' ? '#22c55e' : v === 'critical' ? '#ef4444' : v === 'needs_work' ? '#f59e0b' : '#94a3b8';
    const label = v === 'healthy' ? 'פעיל בריא' : v === 'critical' ? 'בעיה קריטית' : v === 'needs_work' ? 'דורש שיפור' : v || 'לא ידוע';
    return `<span style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block" title="${label}"></span>`;
  };

  const statusBadge = (verdict) => {
    if (!verdict) return `<span class="badge badge-gray" style="font-size:0.72rem">לא נותח</span>`;
    const v = verdict.verdict;
    if (v === 'healthy')    return `<span class="badge badge-green" style="font-size:0.72rem">✓ פעיל בריא</span>`;
    if (v === 'critical')   return `<span class="badge badge-red" style="font-size:0.72rem">⚠ בעיה קריטית</span>`;
    if (v === 'needs_work') return `<span class="badge badge-yellow" style="font-size:0.72rem">↗ דורש שיפור</span>`;
    if (v === 'paused')     return `<span class="badge badge-gray" style="font-size:0.72rem">⏸ מושהה</span>`;
    return `<span class="badge badge-blue" style="font-size:0.72rem">${v || 'בודק...'}</span>`;
  };

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">🎯 קמפיינים</h1>
        <p class="page-subtitle">ניהול, ניתוח, ומעקב אחרי כל הקמפיינים שלך</p>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-secondary" style="width:auto" onclick="navigate('insights')">📈 תובנות כלליות →</button>
        <button class="btn btn-primary" style="width:auto" onclick="showAddCampaignModal()">+ קמפיין חדש</button>
      </div>
    </div>

    <!-- Platform connections bar -->
    <div class="card mb-4" style="padding:1rem 1.25rem">
      <div class="flex items-center justify-between gap-3" style="flex-wrap:wrap">
        <div class="flex items-center gap-3">
          <span style="font-size:0.85rem;font-weight:600;color:#374151">פלטפורמות מחוברות:</span>
          ${hasConns
            ? activeConns.map(i => `<span style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.82rem;background:#f0fdf4;color:#16a34a;padding:0.25rem 0.6rem;border-radius:9999px;border:1px solid #bbf7d0">
                <span style="width:7px;height:7px;border-radius:50%;background:#22c55e;display:inline-block"></span>
                ${PLATFORM_NAMES[i.provider] || i.provider}
              </span>`).join('')
            : `<span style="font-size:0.85rem;color:#94a3b8">אין חשבון מחובר</span>`}
        </div>
        ${!hasConns ? `
          <button class="btn btn-sm btn-primary" onclick="showQuickConnectModal()" style="width:auto">
            🔌 חבר עכשיו
          </button>` : `
          <button class="btn btn-sm btn-secondary" onclick="showQuickConnectModal()" style="width:auto;font-size:0.8rem">
            + חבר פלטפורמה נוספת
          </button>`}
      </div>
    </div>

    <!-- Campaigns table -->
    ${state.campaigns.length === 0 ? `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon">🎯</div>
          <h3 class="empty-state-title">עדיין אין קמפיינים</h3>
          <p class="empty-state-desc">צור קמפיין ראשון כדי להתחיל לנתח ביצועים</p>
          ${getPlanLimits(state.subscription?.plan || 'free').campaignLimit === 0
            ? `<button class="btn btn-gradient" style="width:auto" onclick="settingsTab='billing';navigate('settings')">שדרג ליצירת קמפיינים →</button>`
            : `<button class="btn btn-gradient" style="width:auto" onclick="showAddCampaignModal()">+ צור קמפיין ראשון</button>`}
        </div>
      </div>` : `
      <div class="card" style="padding:0;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:0.88rem">
          <thead>
            <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
              <th style="padding:0.85rem 1.25rem;text-align:right;font-weight:600;color:#64748b">שם הקמפיין</th>
              <th style="padding:0.85rem 1rem;text-align:center;font-weight:600;color:#64748b">סטטוס</th>
              <th style="padding:0.85rem 1rem;text-align:center;font-weight:600;color:#64748b">ציון</th>
              <th style="padding:0.85rem 1rem;text-align:center;font-weight:600;color:#64748b">ניתוח אחרון</th>
              <th style="padding:0.85rem 1rem;text-align:center;font-weight:600;color:#64748b">פעולות</th>
            </tr>
          </thead>
          <tbody>
            ${state.campaigns.map((c, idx) => {
              const v = verdicts[c.id];
              const score = v?.scores?.overall;
              const scoreColor = score >= 70 ? '#16a34a' : score >= 45 ? '#d97706' : score != null ? '#dc2626' : '#94a3b8';
              const lastAnalyzed = v?.timestamp ? new Date(v.timestamp).toLocaleDateString('he-IL') : '—';
              return `<tr style="border-bottom:1px solid #f1f5f9;cursor:pointer;transition:background 0.12s"
                  onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''"
                  onclick="showCampaignDetail('${c.id}')">
                <td style="padding:1rem 1.25rem">
                  <div style="font-weight:600;color:#1e293b">${c.name}</div>
                  <div style="font-size:0.78rem;color:#94a3b8">נוצר: ${new Date(c.created_at).toLocaleDateString('he-IL')}</div>
                </td>
                <td style="padding:1rem;text-align:center">${statusBadge(v)}</td>
                <td style="padding:1rem;text-align:center">
                  ${score != null
                    ? `<span style="font-weight:700;font-size:1rem;color:${scoreColor}">${score}</span><span style="font-size:0.7rem;color:#94a3b8">/100</span>`
                    : `<span style="color:#cbd5e1">—</span>`}
                </td>
                <td style="padding:1rem;text-align:center;color:#64748b;font-size:0.82rem">${lastAnalyzed}</td>
                <td style="padding:1rem;text-align:center">
                  <button class="btn btn-sm btn-primary" data-analysis-btn="${c.id}"
                    onclick="event.stopPropagation();runAnalysis('${c.id}')" style="width:auto;padding:0.3rem 0.75rem;font-size:0.8rem">
                    הרץ ניתוח
                  </button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="card mt-4" style="background:linear-gradient(135deg,#f8f7ff,#f0f9ff);border:1px solid #e0e7ff;text-align:center;padding:1.5rem">
        <div style="font-size:1rem;font-weight:700;margin-bottom:0.5rem">📈 רוצה לראות תמונה שלמה על כל השיווק שלך?</div>
        <p class="text-sm text-muted" style="margin-bottom:1rem">בעמוד התובנות תמצא ביצועים, כלכלת יחידה, A/B tests ונתוני CRM — הכל במקום אחד</p>
        <button class="btn btn-primary" style="width:auto" onclick="navigate('insights')">עבור לתובנות →</button>
      </div>`}
  `);
}

function showQuickConnectModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const integrationDefs = [
    { provider: 'google_ads', name: 'Google Ads',  icon: '🟢' },
    { provider: 'meta',       name: 'Meta Ads',    icon: '🔵' },
    { provider: 'ga4',        name: 'Analytics 4', icon: '📈' },
    { provider: 'tiktok',     name: 'TikTok Ads',  icon: '🎵' },
  ];
  const connMap = new Map((state.integrations || []).map(i => [i.provider, i]));
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px">
      <h2 class="modal-title">🔌 חיבור פלטפורמה</h2>
      <p class="text-sm text-muted mb-4">בחר פלטפורמה לחיבור — תועבר ותחזור אוטומטית</p>
      <div class="flex flex-col gap-3">
        ${integrationDefs.map(def => {
          const conn = connMap.get(def.provider);
          const isActive = conn?.connection_status === 'active';
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.75rem 1rem;border:1px solid #e2e8f0;border-radius:8px;background:${isActive ? '#f0fdf4' : '#fff'}">
            <div style="display:flex;align-items:center;gap:0.6rem">
              <span>${def.icon}</span>
              <span style="font-weight:600;font-size:0.9rem">${def.name}</span>
              ${isActive ? '<span style="font-size:0.75rem;color:#16a34a">✓ מחובר</span>' : ''}
            </div>
            ${isActive
              ? `<button class="btn btn-sm btn-danger" onclick="this.closest('.modal-overlay').remove();disconnectIntegration('${def.provider}')">נתק</button>`
              : `<button class="btn btn-sm btn-primary" id="qc-btn-${def.provider}"
                  onclick="this.closest('.modal-overlay').remove();connectIntegration('${def.provider}')">חבר</button>`}
          </div>`;
        }).join('')}
      </div>
      <button class="btn btn-secondary mt-4" onclick="this.closest('.modal-overlay').remove()">סגור</button>
    </div>`;
  document.body.appendChild(overlay);
}

function showAddCampaignModal() {
  // CA-008: guard for free plan — campaign creation is blocked, redirect to billing
  const plan = state.subscription?.plan || 'free';
  if (getPlanLimits(plan).campaignLimit === 0) {
    settingsTab = 'billing'; navigate('settings');
    toast('שדרג את התוכנית שלך כדי ליצור קמפיינים', 'info');
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

// ── Local notifications (stored in localStorage) ─────────────────────────────
const LOCAL_NOTIF_KEY = 'cb_notifications_v1';

function getLocalNotifications() {
  try { return JSON.parse(localStorage.getItem(LOCAL_NOTIF_KEY) || '[]'); } catch { return []; }
}

function addLocalNotification(notif) {
  const list = getLocalNotifications();
  list.unshift({ id: Date.now(), read: false, createdAt: new Date().toISOString(), ...notif });
  if (list.length > 50) list.splice(50);
  localStorage.setItem(LOCAL_NOTIF_KEY, JSON.stringify(list));
  // Update badge immediately
  const unread = list.filter(n => !n.read).length;
  state.localNotifCount = unread;
  refreshBellBadge();
}

function markLocalNotificationsRead() {
  const list = getLocalNotifications().map(n => ({ ...n, read: true }));
  localStorage.setItem(LOCAL_NOTIF_KEY, JSON.stringify(list));
  state.localNotifCount = 0;
  refreshBellBadge();
}

function clearPersonalNotifications() {
  localStorage.removeItem(LOCAL_NOTIF_KEY);
  state.localNotifCount = 0;
  refreshBellBadge();
}

function refreshBellBadge() {
  const total = (state.updatesCount || 0) + (state.localNotifCount || 0);
  const btn   = document.querySelector('[data-bell-btn]');
  if (!btn) return;
  const badge = btn.querySelector('[data-bell-badge]');
  if (total > 0) {
    const label = total > 99 ? '99+' : String(total);
    if (badge) {
      badge.textContent = label;
      badge.style.display = 'flex';
    } else {
      btn.insertAdjacentHTML('beforeend',
        `<span data-bell-badge style="position:absolute;top:0;right:0;background:#ef4444;color:white;font-size:0.58rem;font-weight:700;min-width:1rem;height:1rem;border-radius:9999px;display:flex;align-items:center;justify-content:center;padding:0 2px;line-height:1;">${label}</span>`);
    }
  } else if (badge) {
    badge.style.display = 'none';
  }
}

// ── Analysis progress banner ──────────────────────────────────────────────────
const ANALYSIS_STAGES = [
  { icon: '🔌', label: 'מתחבר לפלטפורמה...',   pct: 10, delay: 0     },
  { icon: '📊', label: 'מאחזר נתונים חיים...',  pct: 30, delay: 6000  },
  { icon: '🤖', label: 'מנתח עם AI...',          pct: 55, delay: 18000 },
  { icon: '💡', label: 'מייצר המלצות...',        pct: 78, delay: 35000 },
  { icon: '✍️', label: 'מסיים ומארגן...',        pct: 92, delay: 52000 },
];

function showAnalysisBanner(campaignName) {
  removeAnalysisBanner();
  const banner = document.createElement('div');
  banner.id = 'analysis-progress-banner';
  banner.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);z-index:9999;background:white;border-radius:1rem;box-shadow:0 8px 32px rgba(0,0,0,0.18);padding:1rem 1.5rem;min-width:320px;max-width:90vw;border:2px solid #6366f1;direction:rtl;';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.6rem">
      <div style="font-weight:700;color:#1e293b;font-size:0.92rem">🔍 מנתח: ${campaignName}</div>
      <button onclick="document.getElementById('analysis-progress-banner').style.display='none'" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:1rem;line-height:1;padding:0">✕</button>
    </div>
    <div id="apb-stage" style="font-size:0.85rem;color:#6366f1;margin-bottom:0.5rem;font-weight:600">🔌 מתחבר לפלטפורמה...</div>
    <div style="background:#e2e8f0;border-radius:9999px;height:6px;overflow:hidden">
      <div id="apb-bar" style="background:linear-gradient(90deg,#6366f1,#8b5cf6);height:100%;border-radius:9999px;width:10%;transition:width 1.2s ease;"></div>
    </div>
  `;
  document.body.appendChild(banner);
}

function updateAnalysisBanner(stageIdx) {
  const s = ANALYSIS_STAGES[stageIdx] || ANALYSIS_STAGES[ANALYSIS_STAGES.length - 1];
  const stageEl = document.getElementById('apb-stage');
  const barEl   = document.getElementById('apb-bar');
  if (stageEl) stageEl.textContent = `${s.icon} ${s.label}`;
  if (barEl)   barEl.style.width   = s.pct + '%';
}

function finishAnalysisBanner(success) {
  const stageEl = document.getElementById('apb-stage');
  const barEl   = document.getElementById('apb-bar');
  if (stageEl) stageEl.textContent = success ? '✅ הניתוח הסתיים בהצלחה!' : '❌ הניתוח נכשל';
  if (barEl)   barEl.style.width   = success ? '100%' : '0%';
  if (success && barEl) barEl.style.background = '#10b981';
  setTimeout(() => removeAnalysisBanner(), 4000);
}

function removeAnalysisBanner() {
  const el = document.getElementById('analysis-progress-banner');
  if (el) el.remove();
}

async function runAnalysis(campaignId) {
  // STATE-01: disable all buttons for this campaign to prevent duplicate jobs
  const btns = document.querySelectorAll(`[data-analysis-btn="${campaignId}"]`);
  btns.forEach(b => { b.disabled = true; b.textContent = 'מנתח...'; });
  const campaign = state.campaigns?.find(c => c.id === campaignId);
  const campName = campaign?.name || campaignId;
  try {
    const job = await api('POST', 'enqueue-sync-job', { campaignId });
    showAnalysisBanner(campName);
    pollJobStatus(job.jobId, campaignId, campName);
  } catch (err) {
    btns.forEach(b => { b.disabled = false; b.textContent = 'הרץ ניתוח'; });
    toast(err.message || 'שגיאה בהרצת ניתוח', 'error');
  }
}

async function pollJobStatus(jobId, campaignId, campName) {
  let attempts   = 0;
  let stageIdx   = 0;
  const stageTimers = [];

  // Schedule stage transitions based on timing estimates
  ANALYSIS_STAGES.forEach((s, i) => {
    if (s.delay > 0) {
      stageTimers.push(setTimeout(() => {
        stageIdx = i;
        updateAnalysisBanner(i);
      }, s.delay));
    }
  });

  const restoreBtns = () => {
    document.querySelectorAll(`[data-analysis-btn="${campaignId}"]`)
      .forEach(b => { b.disabled = false; b.textContent = 'הרץ ניתוח'; });
  };

  const cleanup = () => {
    stageTimers.forEach(t => clearTimeout(t));
    restoreBtns();
  };

  const poll = async () => {
    attempts++;
    try {
      const { data } = await sb.from('sync_jobs').select('status,result_payload').eq('id', jobId).maybeSingle();
      if (data?.status === 'done') {
        cleanup();
        finishAnalysisBanner(true);
        addLocalNotification({ icon: '✅', title: `ניתוח הסתיים`, body: `הניתוח עבור "${campName}" הושלם בהצלחה.`, page: 'campaigns', campaignId });
        toast('הניתוח הסתיים!', 'success');
        // Refresh detail page only if still on that campaign
        if (state.currentPage === 'campaigns' && state.currentCampaignId === campaignId) {
          showCampaignDetail(campaignId);
        }
        return;
      }
      if (data?.status === 'failed') {
        cleanup();
        finishAnalysisBanner(false);
        addLocalNotification({ icon: '❌', title: 'ניתוח נכשל', body: `הניתוח עבור "${campName}" נכשל.`, page: 'campaigns', campaignId });
        toast('הניתוח נכשל — נסה שנית', 'error');
        return;
      }
      if (attempts < 30) {
        setTimeout(poll, 3000);
      } else {
        cleanup();
        finishAnalysisBanner(false);
        addLocalNotification({ icon: '⏱️', title: 'ניתוח לוקח זמן', body: `הניתוח עבור "${campName}" לא הסתיים. נסה שנית בעוד כמה דקות.`, page: 'campaigns', campaignId });
        toast('הניתוח לוקח יותר מהצפוי. נסה שנית בעוד כמה דקות.', 'warning');
      }
    } catch {
      if (attempts < 30) setTimeout(poll, 3000);
      else { cleanup(); finishAnalysisBanner(false); toast('שגיאה בבדיקת סטטוס הניתוח', 'error'); }
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
  } catch (err) {
    renderShell(`<div class="card" style="text-align:center;padding:3rem 2rem;color:#ef4444">
      <div style="font-size:2rem;margin-bottom:.5rem">⚠️</div>
      <p>${err.message || 'שגיאה בטעינת הקמפיין'}</p>
      <button class="btn btn-secondary mt-4" onclick="navigate('campaigns')">← חזור לרשימה</button>
    </div>`);
    return;
  }

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

  const activeConns = (state.integrations || []).filter(i => i.connection_status === 'active');
  const PNAMES = { google_ads: 'Google Ads', meta: 'Meta Ads', ga4: 'Analytics', tiktok: 'TikTok' };

  // Extract bottlenecks from recommendations (high urgency items)
  const bottlenecks = recommendations.filter(r => r.urgency >= 75).slice(0, 3);

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <button class="btn btn-sm btn-secondary mb-2" onclick="navigate('campaigns')">← כל הקמפיינים</button>
        <h1 class="page-title">${campaign.name}</h1>
        <p class="page-subtitle">ניתוח מפורט לקמפיין זה</p>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-secondary" style="width:auto" onclick="navigate('insights')">📈 תובנות כלליות →</button>
        <button class="btn btn-primary" style="width:auto" data-analysis-btn="${campaignId}" onclick="runAnalysis('${campaignId}')">הרץ ניתוח חדש</button>
      </div>
    </div>

    <!-- Platform connections for this campaign -->
    <div class="card mb-4" style="padding:0.875rem 1.25rem">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span style="font-size:0.82rem;font-weight:600;color:#374151">פלטפורמות:</span>
          ${activeConns.length > 0
            ? activeConns.map(i => `<span style="font-size:0.8rem;background:#f0fdf4;color:#16a34a;padding:0.2rem 0.55rem;border-radius:9999px;border:1px solid #bbf7d0">${PNAMES[i.provider] || i.provider}</span>`).join('')
            : `<span style="font-size:0.82rem;color:#94a3b8">אין פלטפורמה מחוברת</span>`}
        </div>
        <button class="btn btn-sm ${activeConns.length ? 'btn-secondary' : 'btn-primary'}" onclick="showQuickConnectModal()" style="width:auto;font-size:0.8rem">
          ${activeConns.length ? '+ פלטפורמה נוספת' : '🔌 חבר פלטפורמה'}
        </button>
      </div>
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

      ${bottlenecks.length > 0 ? `
      <div class="card mt-4" style="border-right:4px solid #ef4444">
        <div class="card-title" style="color:#dc2626">🚧 צווארי בקבוק עיקריים</div>
        <div class="flex flex-col gap-3">
          ${bottlenecks.map(r => `
            <div style="background:#fef2f2;border-radius:8px;padding:0.75rem 1rem">
              <div style="font-weight:600;color:#991b1b;margin-bottom:0.25rem">${r.issue}</div>
              <div class="text-sm" style="color:#7f1d1d">${r.root_cause}</div>
              <div class="text-sm" style="color:#1e293b;margin-top:0.35rem"><strong>פתרון:</strong> ${r.action}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}

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

    <div class="card mt-4" style="background:linear-gradient(135deg,#f8f7ff,#f0f9ff);border:1px solid #e0e7ff;text-align:center;padding:1.5rem">
      <div style="font-size:1rem;font-weight:700;margin-bottom:0.5rem">📈 רוצה לראות תמונה רחבה יותר?</div>
      <p class="text-sm text-muted" style="margin-bottom:1rem">עמוד התובנות מציג ביצועים מכל הפלטפורמות, כלכלת יחידה, ונתוני CRM — לא רק קמפיין זה</p>
      <button class="btn btn-primary" style="width:auto" onclick="navigate('insights')">עבור לתובנות כלליות →</button>
    </div>
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
    { provider: 'tiktok',     name: 'TikTok Ads',          icon: '🎵', desc: 'קמפיינים ב-TikTok' },
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
                ? `<button class="btn btn-sm btn-primary mt-2" id="connect-btn-${def.provider}" onclick="connectIntegration('${def.provider}')">חבר מחדש</button>` : ''}
            ` : `<button class="btn btn-primary" id="connect-btn-${def.provider}" onclick="connectIntegration('${def.provider}')">חבר</button>`}
          </div>`;
      }).join('')}
    </div>

    <!-- CRM & Other Systems -->
    <div class="page-header mt-8" style="margin-bottom:1rem">
      <h2 class="page-title" style="font-size:1.25rem">🗂️ מערכות CRM וניהול</h2>
      <p class="page-subtitle">חבר מערכות ניהול לקוחות ואוטומציה — לידים יועברו אוטומטית</p>
    </div>
    <div class="integration-grid">
      ${[
        { id: 'fixdigital', name: 'פיקס דיגיטל', icon: '🔧', desc: 'CRM ישראלי לניהול לקוחות ולידים' },
        { id: 'origami',    name: 'אוריגמי',     icon: '📄', desc: 'מערכת ניהול עסקי ישראלית' },
        { id: 'monday',     name: 'Monday.com',  icon: '📅', desc: 'ניהול פרויקטים ולידים' },
        { id: 'salesforce', name: 'Salesforce',  icon: '☁️', desc: 'מערכת CRM גלובלית' },
        { id: 'hubspot',    name: 'HubSpot',     icon: '🟠', desc: 'CRM ושיווק אוטומטי' },
        { id: 'webhook',    name: 'Webhook אוניברסלי', icon: '🔗', desc: 'חבר כל מערכת שתומכת ב-webhook' },
      ].map(crm => `
        <div class="integration-card" style="border:1.5px solid #e2e8f0;background:#fafafa">
          <div class="integration-header">
            <div class="integration-icon">${crm.icon}</div>
            <div>
              <div class="integration-name">${crm.name}</div>
              <div class="integration-desc">${crm.desc}</div>
            </div>
          </div>
          <button class="btn btn-secondary" style="opacity:0.8" onclick="showCRMConnect('${crm.id}','${crm.name}')">
            ${crm.id === 'webhook' ? '⚙️ הגדר Webhook' : '🔗 חבר'}
          </button>
        </div>`).join('')}
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
  // Show immediate feedback — Netlify cold start can take 10-30s
  const btn = document.getElementById(`connect-btn-${provider}`);
  if (btn) { btn.disabled = true; btn.textContent = 'מתחבר...'; }
  toast('מתחבר — אנא המתן מספר שניות...', 'info');

  const { data: { session } } = await sb.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) {
    if (btn) { btn.disabled = false; btn.textContent = 'חבר'; }
    toast('עליך להיות מחובר', 'error'); return;
  }

  let nonce;
  try {
    const res = await api('POST', 'oauth-nonce', { provider });
    nonce = res.nonce;
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'חבר'; }
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
  } else if (provider === 'tiktok') {
    const clientKey   = window.__TIKTOK_CLIENT_KEY__ || '';
    const redirectUri = `${appUrl}/.netlify/functions/oauth-callback-tiktok`;
    const scope       = 'user.info.basic,video.list,ads.read';
    const url = `https://www.tiktok.com/v2/auth/authorize?client_key=${encodeURIComponent(clientKey)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state64}`;
    window.location.href = url;
  }
}

function showCRMConnect(id, name) {
  const isWebhook = id === 'webhook';
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div class="card" style="width:min(480px,90vw);max-height:80vh;overflow-y:auto">
      <div class="card-title">🔗 חיבור ${name}</div>
      ${isWebhook ? `
        <p class="text-sm text-muted mb-3">הכנס את ה-URL של ה-webhook שלך. כל ליד חדש יישלח אוטומטית ל-URL זה כ-POST עם פרטי הליד.</p>
        <div class="form-group">
          <label class="form-label">Webhook URL</label>
          <input class="form-input" id="crm-webhook-url" placeholder="https://hooks.yourapp.com/lead" />
        </div>
        <div class="form-group">
          <label class="form-label">Authorization Header (אופציונלי)</label>
          <input class="form-input" id="crm-webhook-auth" placeholder="Bearer token..." />
        </div>` : `
        <p class="text-sm text-muted mb-3">חיבור ל-${name} יהיה זמין בקרוב. ניתן לחבר כבר עכשיו דרך Webhook אוניברסלי.</p>
        <p class="text-sm" style="color:#6366f1">לחיבור מיידי — השתמש ב-<strong>Webhook אוניברסלי</strong> שתומך בכל מערכת.</p>`}
      <div class="flex gap-2 mt-4">
        ${isWebhook ? `<button class="btn btn-primary" onclick="saveCRMWebhook()">שמור</button>` : `<button class="btn btn-primary" onclick="showCRMConnect('webhook','Webhook אוניברסלי');this.closest('[style*=fixed]').remove()">הגדר Webhook</button>`}
        <button class="btn btn-secondary" onclick="this.closest('[style*=fixed]').remove()">סגור</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function saveCRMWebhook() {
  const url  = document.getElementById('crm-webhook-url')?.value.trim();
  const auth = document.getElementById('crm-webhook-auth')?.value.trim();
  if (!url) { toast('נא להכניס URL', 'error'); return; }
  try { new URL(url); } catch { toast('URL לא תקין', 'error'); return; }
  localStorage.setItem('crm_webhook', JSON.stringify({ url, auth, savedAt: Date.now() }));
  toast('Webhook נשמר בהצלחה ✓', 'success');
  document.querySelector('[style*="position:fixed"]')?.remove();
}

async function disconnectIntegration(provider) {
  if (!confirm(`נתק ${provider}? תצטרך להתחבר מחדש כדי להמשיך.`)) return;
  try {
    await api('DELETE', 'integration-connect', { provider });
    state.integrations = state.integrations.filter(i => i.provider !== provider);
    toast('האינטגרציה נותקה', 'success');
    settingsTab = 'integrations'; navigate('settings');
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
    clearBootCache(); // force fresh data on next load
    toast('הבקשה התקבלה! מחפש אישור תשלום...', 'success');
    setTimeout(() => { settingsTab = 'billing'; navigate('settings'); }, 500);
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
    settingsTab = 'business';
    navigate('settings');
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
function deleteAISavedWork(id) {
  try {
    const key = 'ai_saved_works_' + (state.user?.id || 'anon');
    const works = loadAISavedWorks().filter(w => String(w.id) !== String(id));
    localStorage.setItem(key, JSON.stringify(works));
    navigate('landing-pages');
  } catch { toast('שגיאה במחיקה', 'error'); }
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast('הועתק ✓', 'success')).catch(() => toast('שגיאה בהעתקה', 'error'));
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

  // New user: no business profile → show setup prompt first
  const hasProfile = !!(bp.business_name || bp.offer);
  if (!hasProfile) {
    renderShell(`
      <div class="page-header">
        <h1 class="page-title">✨ צור נכסים בAI</h1>
        <p class="page-subtitle">לפני שמתחילים — צריך להגדיר את העסק שלך כדי שה-AI ידע למי לכתוב</p>
      </div>
      <div class="card" style="max-width:520px;margin:2rem auto;text-align:center;padding:2.5rem">
        <div style="font-size:3rem;margin-bottom:1rem">🏢</div>
        <h2 style="font-size:1.25rem;font-weight:700;margin-bottom:0.75rem">הגדר את הפרופיל העסקי שלך</h2>
        <p class="text-sm text-muted" style="margin-bottom:1.5rem;line-height:1.7">
          ה-AI שלנו יוצר תוכן מותאם אישית בהתבסס על המוצר, הלקוח, והמטרות שלך.<br>
          לוקח כ-3 דקות — ומשפר את כל התוצאות.
        </p>
        <button class="btn btn-primary" style="width:auto;padding:0.75rem 2.5rem"
          onclick="switchSettingsTab('business');navigate('settings')">
          הגדר עסק עכשיו →
        </button>
        <p style="margin-top:1rem;font-size:0.8rem;color:#94a3b8">
          <button onclick="_renderAICreationShell({}, loadAISavedWorks())" style="background:none;border:none;color:#94a3b8;cursor:pointer;text-decoration:underline">
            המשך בלי פרופיל
          </button>
        </p>
      </div>
    `);
    return;
  }

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
        <button class="btn btn-gradient mt-4" style="width:auto;padding:0.75rem 2.5rem"
          id="ai-gen-ad-btn" onclick="generateAdScript()">
          ✨ צור תסריט
        </button>
        <div id="ai-result-ad" style="display:none" class="card mt-4">
          <div class="flex items-center justify-between mb-2">
            <div class="card-title" style="margin:0">✅ התסריט שלך</div>
            <div class="flex gap-2">
              <button id="ai-save-ad-btn" class="btn btn-sm btn-secondary" style="display:none">💾 שמור</button>
              <button class="btn btn-sm btn-secondary" onclick="copyAIResult('ai-result-ad-text')">📋 העתק</button>
            </div>
          </div>
          <div id="ai-result-ad-text" class="text-sm" style="white-space:pre-wrap;line-height:1.7"></div>
        </div>
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
        <button class="btn btn-gradient mt-4" style="width:auto;padding:0.75rem 2.5rem"
          id="ai-gen-lp-btn" onclick="generateLandingPage()">
          ✨ צור מבנה דף נחיתה
        </button>
        <div id="ai-result-lp" style="display:none" class="card mt-4">
          <div class="flex items-center justify-between mb-2">
            <div class="card-title" style="margin:0">✅ מבנה דף הנחיתה</div>
            <div class="flex gap-2">
              <button id="ai-save-lp-btn" class="btn btn-sm btn-secondary" style="display:none">💾 שמור</button>
              <button class="btn btn-sm btn-secondary" onclick="copyAIResult('ai-result-lp-text')">📋 העתק</button>
            </div>
          </div>
          <div id="ai-result-lp-text" class="text-sm" style="white-space:pre-wrap;line-height:1.7"></div>
        </div>
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
        <button class="btn btn-gradient mt-4" style="width:auto;padding:0.75rem 2.5rem"
          id="ai-gen-creative-btn" onclick="generateAdCreative()">
          🖼️ צור מודעה
        </button>
        <div id="ai-result-creative" style="display:none" class="card mt-4">
          <div class="flex items-center justify-between mb-2">
            <div class="card-title" style="margin:0">✅ המודעה שלך</div>
            <div class="flex gap-2">
              <button id="ai-save-creative-btn" class="btn btn-sm btn-secondary" style="display:none">💾 שמור</button>
              <button class="btn btn-sm btn-secondary" onclick="copyAIResult('ai-result-creative-text')">📋 העתק</button>
            </div>
          </div>
          <div id="ai-result-creative-text" class="text-sm" style="white-space:pre-wrap;line-height:1.7"></div>
        </div>
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
  navigate('ai-creation');
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
    if (resBox) { resBox.style.display = ''; resBox.style.cssText += ';border:2px solid #6366f1;background:#f8f7ff'; resBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if (resText) resText.innerHTML = renderMarkdown(text);
    const saveBtn = document.getElementById('ai-save-ad-btn');
    if (saveBtn) { saveBtn.style.display = ''; saveBtn.onclick = () => saveAIWork('ad_script', 'תסריט מודעה', text); }
    toast('התסריט נוצר! ↑ גלול למעלה לצפייה', 'success');
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
    if (resBox) { resBox.style.display = ''; resBox.style.cssText += ';border:2px solid #6366f1;background:#f8f7ff'; resBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if (resText) resText.innerHTML = renderMarkdown(text);
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
    if (resBox) { resBox.style.display = ''; resBox.style.cssText += ';border:2px solid #6366f1;background:#f8f7ff'; resBox.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if (resText) resText.innerHTML = renderMarkdown(text);
    const saveBtn = document.getElementById('ai-save-creative-btn');
    if (saveBtn) { saveBtn.style.display = ''; saveBtn.onclick = () => saveAIWork('ad_creative', 'מודעה מוכנה', text); }
    toast('המודעה נוצרה!', 'success');
  } catch (err) {
    toast(err.message || 'שגיאה ביצירת מודעה', 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🖼️ צור מודעה';
  }
}

function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:0.75rem 0">')
    .replace(/\n/g, '<br>');
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
        : `<button class="btn btn-secondary" style="width:auto" onclick="settingsTab='billing';navigate('settings')">שדרג ליצירה →</button>`}
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
              ? `<button class="btn btn-gradient" style="width:auto" onclick="settingsTab='billing';navigate('settings')">שדרג ליצירת נכסים →</button>`
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
function _settingsTabBar() {
  const tabs = [
    { id: 'business',     icon: '🏢', label: 'פרופיל עסקי' },
    { id: 'integrations', icon: '🔌', label: 'חיבורים' },
    { id: 'billing',      icon: '💳', label: 'חיוב' },
    { id: 'account',      icon: '👤', label: 'חשבון' },
  ];
  return `<div style="display:flex;gap:0;border-bottom:2px solid #e2e8f0;margin-bottom:1.75rem;overflow-x:auto">
    ${tabs.map(t => `
      <button onclick="switchSettingsTab('${t.id}')"
        style="padding:0.6rem 1.1rem;border:none;border-bottom:2px solid ${settingsTab === t.id ? '#6366f1' : 'transparent'};
               margin-bottom:-2px;background:none;cursor:pointer;font-size:0.88rem;
               font-weight:${settingsTab === t.id ? '700' : '500'};
               color:${settingsTab === t.id ? '#6366f1' : '#64748b'};white-space:nowrap;transition:color 0.15s">
        ${t.icon} ${t.label}
      </button>`).join('')}
  </div>`;
}

function switchSettingsTab(tab) {
  settingsTab = tab;
  renderSettings();
}

async function renderSettings(tabOverride) {
  if (tabOverride) settingsTab = tabOverride;

  renderShell(`<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>`);

  // Fetch data needed for active tab
  let bp = state.businessProfile || {};
  let ints = state.integrations || [];

  try {
    if (settingsTab === 'business') {
      bp = await api('GET', 'business-profile') || {};
    } else if (settingsTab === 'integrations') {
      const res = await api('GET', 'integration-connect');
      ints = Array.isArray(res) ? res : [];
      state.integrations = ints;
    }
  } catch {}

  // Handle OAuth redirect params when landing on integrations tab
  if (settingsTab === 'integrations') {
    const params = new URLSearchParams(window.location.search);
    const INTEGRATION_NAMES = { google_ads: 'Google Ads', ga4: 'Google Analytics', meta: 'Meta Ads' };
    const OAUTH_ERRORS = {
      google_not_configured:'חיבור Google לא מופעל',google_denied:'ביטלת את החיבור ל-Google',
      google_exchange_failed:'חיבור Google נכשל — נסה שנית',google_save_failed:'שמירת חיבור Google נכשלה',
      meta_not_configured:'חיבור Meta לא מופעל',meta_denied:'ביטלת את החיבור ל-Meta',
      meta_exchange_failed:'חיבור Meta נכשל — נסה שנית',meta_save_failed:'שמירת חיבור Meta נכשלה',
    };
    const connectedParam = params.get('connected');
    const errorParam     = params.get('error');
    if (connectedParam) toast(`${INTEGRATION_NAMES[connectedParam] || connectedParam} חובר בהצלחה! 🎉`, 'success');
    if (errorParam)     toast(OAUTH_ERRORS[errorParam] || `שגיאה בחיבור: ${errorParam}`, 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }

  const v = (obj, k, fallback = '') => {
    const val = obj[k]; return val == null ? fallback : String(val).replace(/"/g, '&quot;');
  };

  // ── Tab content builders ──────────────────────────────────────────────────────
  const buildBusinessTab = () => {
    const score = bp.completion?.pct ?? bp.completion_score ?? null;
    const scorePct = score != null ? Math.round(score) : null;
    return `
      <div class="flex items-center justify-between mb-4">
        <p class="text-sm text-muted">מידע זה משמש את ה-AI ליצירת תוכן מדויק עבורך</p>
        ${scorePct != null ? `<div style="text-align:center">${renderDonutSVG(scorePct, 100)}<div class="text-xs text-muted mt-1">השלמה</div></div>` : ''}
      </div>
      <form onsubmit="saveBusinessProfile(event)">
        <div class="card mb-4">
          <div class="card-title">פרטי העסק</div>
          <div class="form-grid-2">
            <div class="form-group"><label class="form-label">שם העסק</label>
              <input class="form-input" id="bp-business_name" value="${v(bp,'business_name')}" placeholder="לדוגמה: קליניקת ד&quot;ר כהן" /></div>
            <div class="form-group"><label class="form-label">קטגוריה / ענף</label>
              <input class="form-input" id="bp-category" value="${v(bp,'category')}" placeholder="לדוגמה: בריאות, נדל&quot;ן, e-commerce" /></div>
          </div>
        </div>
        <div class="card mb-4">
          <div class="card-title">מה אתם מוכרים <span class="required-star">*</span></div>
          <div class="form-group"><label class="form-label">ההצעה / המוצר / השירות</label>
            <textarea class="form-input" id="bp-offer" rows="3" placeholder="תארו בפירוט את מה שאתם מציעים ללקוחות">${v(bp,'offer')}</textarea></div>
          <div class="form-grid-2">
            <div class="form-group"><label class="form-label">מחיר (₪) <span class="required-star">*</span></label>
              <input class="form-input" id="bp-price_amount" type="number" min="0" value="${v(bp,'price_amount')}" placeholder="לדוגמה: 297" /></div>
            <div class="form-group"><label class="form-label">מודל תמחור <span class="required-star">*</span></label>
              <select class="form-input" id="bp-pricing_model">
                <option value="">בחרו מודל</option>
                ${['חד פעמי','מנוי חודשי','מנוי שנתי','תשלום לפי שימוש','פרויקט','שעתי'].map(o =>
                  `<option value="${o}" ${v(bp,'pricing_model') === o ? 'selected' : ''}>${o}</option>`).join('')}
              </select></div>
          </div>
        </div>
        <div class="card mb-4">
          <div class="card-title">הלקוח האידיאלי</div>
          <div class="form-group"><label class="form-label">קהל יעד <span class="required-star">*</span></label>
            <textarea class="form-input" id="bp-target_audience" rows="2" placeholder="מי הלקוח האידיאלי שלכם?">${v(bp,'target_audience')}</textarea></div>
          <div class="form-group"><label class="form-label">הבעיה שאתם פותרים <span class="required-star">*</span></label>
            <textarea class="form-input" id="bp-problem_solved" rows="2" placeholder="מה הכאב / הבעיה שהלקוח חווה?">${v(bp,'problem_solved')}</textarea></div>
          <div class="form-group"><label class="form-label">התוצאה הרצויה <span class="required-star">*</span></label>
            <textarea class="form-input" id="bp-desired_outcome" rows="2" placeholder="איפה הלקוח רוצה להיות לאחר שיקנה מכם?">${v(bp,'desired_outcome')}</textarea></div>
        </div>
        <div class="card mb-4">
          <div class="card-title">אסטרטגיה שיווקית</div>
          <div class="form-group"><label class="form-label">מטרה עיקרית <span class="required-star">*</span></label>
            <select class="form-input" id="bp-primary_goal">
              <option value="">בחרו מטרה</option>
              ${['גיוס לידים','מכירה ישירה','הגברת מודעות','שמירת לקוחות','הגדלת ROAS'].map(o =>
                `<option value="${o}" ${v(bp,'primary_goal') === o ? 'selected' : ''}>${o}</option>`).join('')}
            </select></div>
          <div class="form-grid-2">
            <div class="form-group"><label class="form-label">מנגנון ייחודי (USP)</label>
              <input class="form-input" id="bp-unique_mechanism" value="${v(bp,'unique_mechanism')}" placeholder="מה הופך אתכם לייחודיים?" /></div>
            <div class="form-group"><label class="form-label">ההבטחה המרכזית</label>
              <input class="form-input" id="bp-main_promise" value="${v(bp,'main_promise')}" placeholder="המשפט שמביא לידים" /></div>
          </div>
          <div class="form-group"><label class="form-label">תקציב חודשי לפרסום (₪)</label>
            <input class="form-input" id="bp-monthly_budget" type="number" min="0" value="${v(bp,'monthly_budget')}" placeholder="לדוגמה: 5000" /></div>
        </div>
        <div class="flex gap-3" style="margin-bottom:2rem">
          <button type="submit" class="btn btn-primary" style="width:auto;padding:0.75rem 2.5rem" id="bp-save-btn">שמור פרופיל עסקי</button>
        </div>
      </form>`;
  };

  const buildIntegrationsTab = () => {
    const connectedMap = new Map(ints.map(i => [i.provider, i]));
    const statusBadge = integ => {
      const s = integ?.connection_status;
      if (s === 'active')   return `<span class="badge badge-green">פעיל ✓</span>`;
      if (s === 'error')    return `<span class="badge badge-red">שגיאה</span>`;
      if (s === 'expired')  return `<span class="badge badge-gray">פג תוקף</span>`;
      if (s === 'revoked')  return `<span class="badge badge-gray">בוטל</span>`;
      return '';
    };
    const integrationDefs = [
      { provider: 'google_ads', name: 'Google Ads',         icon: '🟢', desc: 'ניתוח קמפיינים בגוגל' },
      { provider: 'meta',       name: 'Meta Ads',           icon: '🔵', desc: 'פייסבוק ואינסטגרם' },
      { provider: 'ga4',        name: 'Google Analytics 4', icon: '📈', desc: 'ניתוח תנועת אתר' },
      { provider: 'tiktok',     name: 'TikTok Ads',         icon: '🎵', desc: 'קמפיינים ב-TikTok' },
    ];
    return `
      <div class="integration-grid">
        ${integrationDefs.map(def => {
          const integ = connectedMap.get(def.provider);
          const isConn = !!integ;
          return `<div class="integration-card">
            <div class="integration-header">
              <div class="integration-icon">${def.icon}</div>
              <div><div class="integration-name">${def.name}</div><div class="integration-desc">${def.desc}</div></div>
            </div>
            ${isConn ? `
              <div class="flex items-center justify-between mb-2">
                ${statusBadge(integ)}
                <button class="btn btn-sm btn-danger" onclick="disconnectIntegration('${def.provider}')">נתק</button>
              </div>
              ${integ.account_name ? `<div class="text-xs text-muted">חשבון: ${integ.account_name}</div>` : ''}
              ${integ.last_sync_at ? `<div class="text-xs text-muted">סנכרון: ${new Date(integ.last_sync_at).toLocaleString('he-IL')}</div>` : ''}
              ${integ.last_error ? `<div class="text-xs" style="color:#ef4444;margin-top:0.25rem">שגיאה: ${integ.last_error}</div>` : ''}
              ${(integ.connection_status === 'error' || integ.connection_status === 'expired')
                ? `<button class="btn btn-sm btn-primary mt-2" id="connect-btn-${def.provider}" onclick="connectIntegration('${def.provider}')">חבר מחדש</button>` : ''}
            ` : `<button class="btn btn-primary" id="connect-btn-${def.provider}" onclick="connectIntegration('${def.provider}')">חבר</button>`}
          </div>`;
        }).join('')}
      </div>
      <div class="page-header mt-6" style="margin-bottom:1rem">
        <h2 style="font-size:1.1rem;font-weight:700;margin:0">🗂️ מערכות CRM וניהול</h2>
        <p class="page-subtitle">חבר מערכות ניהול לקוחות — לידים יועברו אוטומטית</p>
      </div>
      <div class="integration-grid">
        ${[
          { id:'fixdigital',name:'פיקס דיגיטל',icon:'🔧',desc:'CRM ישראלי' },
          { id:'origami',name:'אוריגמי',icon:'📄',desc:'מערכת ניהול עסקי ישראלית' },
          { id:'monday',name:'Monday.com',icon:'📅',desc:'ניהול פרויקטים ולידים' },
          { id:'salesforce',name:'Salesforce',icon:'☁️',desc:'CRM גלובלי' },
          { id:'hubspot',name:'HubSpot',icon:'🟠',desc:'CRM ושיווק אוטומטי' },
          { id:'webhook',name:'Webhook אוניברסלי',icon:'🔗',desc:'חבר כל מערכת' },
        ].map(crm => `
          <div class="integration-card" style="border:1.5px solid #e2e8f0;background:#fafafa">
            <div class="integration-header">
              <div class="integration-icon">${crm.icon}</div>
              <div><div class="integration-name">${crm.name}</div><div class="integration-desc">${crm.desc}</div></div>
            </div>
            <button class="btn btn-secondary" style="opacity:0.8" onclick="showCRMConnect('${crm.id}','${crm.name}')">
              ${crm.id === 'webhook' ? '⚙️ הגדר Webhook' : '🔗 חבר'}
            </button>
          </div>`).join('')}
      </div>
      <div class="card mt-6" style="background:#f8fafc;border:1px solid #e2e8f0">
        <div class="card-title" style="font-size:0.875rem">🔐 אבטחת הנתונים שלך</div>
        <p class="text-sm text-muted">כל token מאוחסן מוצפן עם AES-256-GCM ייחודי לחשבונך. הטוקנים לעולם לא נחשפים לדפדפן.</p>
      </div>`;
  };

  const buildBillingTab = () => {
    const plan          = state.subscription?.plan          || 'free';
    const paymentStatus = state.subscription?.payment_status || 'none';
    const isPending     = paymentStatus === 'pending';
    const isEarlyBird   = plan === 'early_bird' && !isPending;
    const isFree        = plan === 'free' && !isPending;
    const isPaid        = !isFree && !isPending;
    return `
      <div class="flex items-center justify-between mb-4">
        <div>
          <div style="font-size:1.1rem;font-weight:700">תוכנית נוכחית: <strong>${getPlanLabel(plan)}</strong></div>
          ${isPending ? '<span class="badge badge-gray" style="margin-top:0.35rem">ממתין לאישור</span>' : ''}
        </div>
      </div>
      ${isPending ? `
        <div class="card mb-4" style="border:2px solid #f59e0b;background:#fffbeb">
          <div style="font-weight:700;color:#92400e;margin-bottom:0.5rem">⏳ התשלום בבדיקה</div>
          <p class="text-sm" style="color:#78350f;margin:0">הבקשה שלך התקבלה! החשבון יופעל תוך דקות לאחר אישור התשלום.</p>
          <button class="btn btn-secondary mt-3" onclick="pollPaymentActivation()">רענן סטטוס</button>
        </div>` : ''}
      ${isEarlyBird ? `
        <div class="card mb-4" style="border:2px solid #6366f1;background:#eef2ff">
          <div class="flex items-center justify-between gap-3" style="flex-wrap:wrap">
            <div>
              <div class="font-semibold" style="color:#4338ca;font-size:1rem">🎁 הטבת מייסדים בלעדית</div>
              <div class="text-sm text-muted mt-1">שדרגו ל-Pro ב-<strong>₪99 בלבד לכל החיים!</strong></div>
            </div>
            <a href="https://pay.grow.link/f752f70d2d88201a126de25aedbd498e-MzI1Njk5OA" target="_blank" rel="noopener"
               class="btn btn-primary" style="white-space:nowrap" onclick="window._pendingPlan='pro'">
              שדרגו עכשיו ₪99 →
            </a>
          </div>
        </div>` : ''}
      ${isFree ? `
        <div class="flex flex-col gap-4">
          <div class="card" style="border:2px solid #6366f1">
            <div class="flex items-center justify-between gap-3" style="flex-wrap:wrap">
              <div>
                <div class="font-semibold" style="font-size:1rem">🐦 Early Bird — ₪10 / חודש</div>
                <div class="text-sm text-muted mt-1">50 נכסים, קמפיין אחד, מחיר השקה לנצח</div>
              </div>
              <a href="${window.__GROW_LINK_EARLY_BIRD__ || '#'}" target="_blank" rel="noopener"
                 class="btn btn-primary" onclick="window._pendingPlan='early_bird'">הצטרף עכשיו →</a>
            </div>
          </div>
          <div class="card">
            <div class="flex items-center justify-between gap-3" style="flex-wrap:wrap">
              <div>
                <div class="font-semibold" style="font-size:1rem">🚀 Pro — ₪149 / חודש</div>
                <div class="text-sm text-muted mt-1">500 נכסים, 20 קמפיינים, כל הכלים</div>
              </div>
              <a href="${window.__GROW_LINK_PRO__ || '#'}" target="_blank" rel="noopener"
                 class="btn btn-secondary" onclick="window._pendingPlan='pro'">התחיל</a>
            </div>
          </div>
        </div>
        <div class="card mt-4" style="background:#f8fafc">
          <div class="card-title" style="font-size:0.875rem">כבר שילמת?</div>
          <p class="text-sm text-muted mb-3">אם ביצעת תשלום אך החשבון לא הופעל, לחץ כאן:</p>
          <button class="btn btn-secondary" onclick="claimPayment()">הפעל חשבון</button>
        </div>` : ''}
      ${isPaid ? `
        <div class="card" style="background:#f0fdf4;border:1px solid #bbf7d0">
          <div style="font-weight:700;color:#166534;margin-bottom:0.5rem">✓ המנוי פעיל</div>
          <p class="text-sm text-muted">הגישה שלך למערכת פעילה ורציפה.</p>
        </div>` : ''}`;
  };

  const buildAccountTab = () => `
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
            <input class="form-input" type="email" id="profile-email"
              value="${state.profile?.email || state.user?.email || ''}"
              readonly style="opacity:0.65;cursor:not-allowed" />
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
    </div>`;

  const tabContent = settingsTab === 'business'     ? buildBusinessTab()
                   : settingsTab === 'integrations' ? buildIntegrationsTab()
                   : settingsTab === 'billing'       ? buildBillingTab()
                   : buildAccountTab();

  renderShell(`
    <div class="page-header"><h1 class="page-title">⚙️ הגדרות</h1></div>
    ${_settingsTabBar()}
    ${tabContent}
  `);
}

// ── Landing Pages ─────────────────────────────────────────────────────────────
function renderLandingPages() {
  const saved = loadAISavedWorks().filter(a => a.type === 'landing_page');
  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">🚀 דפי נחיתה</h1>
        <p class="page-subtitle">דפי הנחיתה שיצרת עם ה-AI</p>
      </div>
      <button class="btn btn-gradient" style="width:auto" onclick="navigate('ai-creation')">+ צור דף חדש</button>
    </div>
    ${saved.length === 0 ? `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon">🏗️</div>
          <h3 class="empty-state-title">עדיין אין דפי נחיתה</h3>
          <p class="empty-state-desc">עבור למחולל התכנים וצור דף נחיתה ראשון</p>
          <button class="btn btn-gradient" style="width:auto" onclick="navigate('ai-creation')">✨ צור דף נחיתה</button>
        </div>
      </div>` : `
      <div class="flex flex-col gap-4">
        ${saved.map(a => `
          <div class="card" style="cursor:default">
            <div class="flex items-center justify-between mb-2">
              <div class="card-title" style="margin:0">${a.title || 'דף נחיתה'}</div>
              <span class="text-xs text-muted">${new Date(a.savedAt).toLocaleDateString('he-IL')}</span>
            </div>
            <div class="text-sm text-muted" style="white-space:pre-wrap;max-height:120px;overflow:hidden">${(a.content||'').slice(0,300)}${a.content?.length>300?'...':''}</div>
            <div class="flex gap-2 mt-3">
              <button class="btn btn-sm btn-secondary" onclick="copyText(${JSON.stringify((a.content||'').replace(/"/g,'&quot;'))})">📋 העתק</button>
              <button class="btn btn-sm btn-danger" onclick="deleteAISavedWork('${a.id}')">🗑 מחק</button>
            </div>
          </div>`).join('')}
      </div>`}
  `);
}

// ── Stub pages — not yet implemented ──────────────────────────────────────────
function _insightsTabBar() {
  const tabs = [
    { id: 'performance',     icon: '📈', label: 'ביצועים' },
    { id: 'economics',       icon: '💰', label: 'כלכלת יחידה' },
    { id: 'abtests',         icon: '🧪', label: 'A/B Tests' },
    { id: 'recommendations', icon: '💡', label: 'המלצות' },
  ];
  return `<div style="display:flex;gap:0;border-bottom:2px solid #e2e8f0;margin-bottom:1.75rem;overflow-x:auto">
    ${tabs.map(t => `
      <button onclick="switchInsightsTab('${t.id}')"
        style="padding:0.6rem 1rem;border:none;border-bottom:2px solid ${insightsTab === t.id ? '#6366f1' : 'transparent'};
               margin-bottom:-2px;background:none;cursor:pointer;font-size:0.88rem;
               font-weight:${insightsTab === t.id ? '700' : '500'};
               color:${insightsTab === t.id ? '#6366f1' : '#64748b'};white-space:nowrap;transition:color 0.15s">
        ${t.icon} ${t.label}
      </button>`).join('')}
  </div>`;
}

function switchInsightsTab(tab) {
  insightsTab = tab;
  renderInsights();
}

function renderInsights(tabOverride) {
  if (tabOverride) insightsTab = tabOverride;

  const comingSoon = (title, icon, desc) => `
    <div class="card">
      <div class="empty-state" style="padding:3rem 1rem">
        <div class="empty-state-icon" style="font-size:2.5rem">${icon}</div>
        <h3 class="empty-state-title">${title}</h3>
        <p class="empty-state-desc">${desc || 'תכונה זו תהיה זמינה בקרוב — בינתיים חבר אינטגרציות כדי לאסוף נתונים.'}</p>
        <button class="btn btn-secondary mt-3" onclick="switchSettingsTab('integrations');navigate('settings')">חבר אינטגרציות</button>
      </div>
    </div>`;

  const hasMetrics = (state.integrations || []).some(i => i.connection_status === 'active');

  const tabContent = {
    performance: hasMetrics
      ? `<div class="card">
           <div class="card-title">📈 ביצועי קמפיינים</div>
           <div id="live-stats-container">${renderLiveStatsContent()}</div>
           <button class="btn btn-sm btn-secondary mt-3" onclick="refreshLiveStats()">רענן נתונים</button>
         </div>`
      : comingSoon('ביצועים', '📈', 'חבר Google Ads, Meta Ads, או Google Analytics כדי לראות נתוני ביצועים.'),
    economics: comingSoon('כלכלת יחידה', '💰', 'ניתוח עלות לרכישה, ROI, ו-LTV — יהיה זמין בקרוב.'),
    abtests:   comingSoon('A/B Tests', '🧪', 'השוואת גרסאות מודעות ודפי נחיתה — יהיה זמין בקרוב.'),
    recommendations: comingSoon('המלצות AI', '💡', 'המלצות אוטומטיות לשיפור קמפיינים — יהיה זמין בקרוב.'),
  }[insightsTab] || '';

  renderShell(`
    <div class="page-header"><h1 class="page-title">📈 תובנות</h1></div>
    ${_insightsTabBar()}
    ${tabContent}
  `);
}

function renderRecommendations() { renderInsights('recommendations'); }
async function renderPerformance()  { renderInsights('performance'); }
async function renderEconomics()    { renderInsights('economics'); }
function renderCopyGenerator()      { renderInsights('copy'); }
function renderAbTests()            { renderInsights('abtests'); }
async function renderUpdates() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  let updates = [];
  try { updates = await api('GET', 'get-updates'); } catch {}

  // Mark all as seen
  if (state.user?.id) {
    const seenKey = 'seen_updates_' + state.user.id;
    localStorage.setItem(seenKey, JSON.stringify(updates.map(u => u.id)));
    state.updatesCount = 0;
    refreshBellBadge();
  }

  const typeBadge = { new: 'background:#dcfce7;color:#166534', improved: 'background:#dbeafe;color:#1e40af', fixed: 'background:#fef9c3;color:#854d0e' };
  const typeLabel = { new: '✨ חדש', improved: '⚡ שיפור', fixed: '🔧 תיקון' };

  renderShell(`
    <div class="page-header">
      <h1 class="page-title">🔔 עדכוני מערכת</h1>
      <p class="page-subtitle">כל החידושים והשיפורים ב-CampaignAI</p>
    </div>
    ${updates.length === 0 ? `
      <div class="card">
        <div class="empty-state">
          <div class="empty-state-icon">🔔</div>
          <h3 class="empty-state-title">אין עדכונים עדיין</h3>
          <p class="empty-state-desc">עדכונים חדשים יופיעו כאן</p>
        </div>
      </div>` : `
      <div class="flex flex-col gap-4">
        ${updates.map(u => `
          <div class="card" ${u.is_pinned ? 'style="border:2px solid var(--brand)"' : ''}>
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                ${u.is_pinned ? '<span style="font-size:.8rem">📌</span>' : ''}
                <span style="font-size:.75rem;font-weight:600;padding:.2rem .6rem;border-radius:9999px;${typeBadge[u.type]||'background:#f1f5f9;color:#475569'}">${typeLabel[u.type]||u.type}</span>
              </div>
              <span class="text-xs text-muted">${new Date(u.created_at).toLocaleDateString('he-IL')}</span>
            </div>
            <div class="card-title" style="margin-bottom:.5rem">${u.title}</div>
            <div class="text-sm" style="line-height:1.7;white-space:pre-wrap">${u.content}</div>
          </div>`).join('')}
      </div>`}
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

// ── Admin Support Section ─────────────────────────────────────────────────────
let adminReplyTicketId = null;

function buildSupportSection(supportData) {
  const tickets = supportData?.tickets || [];
  const open    = tickets.filter(t => t.status === 'open');
  const inProg  = tickets.filter(t => t.status === 'in_progress');
  const closed  = tickets.filter(t => t.status === 'closed');

  const statusBadge = { open: '#3b82f6', in_progress: '#f59e0b', closed: '#94a3b8' };
  const statusLabel = { open: 'פתוחה', in_progress: 'בטיפול', closed: 'סגורה' };
  const typeLabel   = { question: 'שאלה', bug: 'באג', feature_request: 'פיצ\'ר', feedback: 'פידבק', 'תמיכה טכנית': 'תמיכה', 'שאלה על חיוב': 'חיוב', 'בקשת תכונה': 'פיצ\'ר', 'דיווח על באג': 'באג' };

  function ticketRow(t) {
    const isReplying = adminReplyTicketId === t.id;
    const sc = statusBadge[t.status] || '#94a3b8';
    return `<div id="ticket-${t.id}" style="border:1px solid #e2e8f0;border-radius:.5rem;padding:.875rem 1rem;margin-bottom:.5rem;background:${t.status==='open'?'#fefce8':'#fff'}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.3rem">
            <span style="font-weight:600;font-size:.875rem">${t.title || '—'}</span>
            <span style="font-size:.68rem;padding:.15rem .45rem;border-radius:9999px;background:${sc}20;color:${sc};font-weight:600">${statusLabel[t.status] || t.status}</span>
            <span style="font-size:.68rem;padding:.15rem .45rem;border-radius:9999px;background:#f1f5f9;color:#64748b">${typeLabel[t.type] || t.type || '—'}</span>
          </div>
          <div style="font-size:.8rem;color:#64748b;margin-bottom:.35rem">${t.userEmail || 'אנונימי'}${t.userName ? ' · ' + t.userName : ''}</div>
          <div style="font-size:.83rem;color:#374151;white-space:pre-wrap;max-height:60px;overflow:hidden">${(t.description || '').slice(0, 200)}${(t.description || '').length > 200 ? '…' : ''}</div>
          <div style="font-size:.72rem;color:#94a3b8;margin-top:.3rem">${new Date(t.created_at).toLocaleString('he-IL')}</div>
        </div>
        <div style="display:flex;gap:.35rem;flex-shrink:0;align-items:flex-start;flex-wrap:wrap">
          ${t.status !== 'closed' ? `<button class="btn btn-sm btn-primary" onclick="adminToggleReply('${t.id}')" style="font-size:.75rem">${isReplying ? 'ביטול' : '↩ ענה'}</button>` : ''}
          ${t.status === 'open'        ? `<button class="btn btn-sm btn-secondary" onclick="adminSetTicketStatus('${t.id}','in_progress')" style="font-size:.75rem">בטיפול</button>` : ''}
          ${t.status !== 'closed'      ? `<button class="btn btn-sm" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;font-size:.75rem" onclick="adminSetTicketStatus('${t.id}','closed')">סגור</button>` : ''}
          ${t.status === 'closed'      ? `<button class="btn btn-sm btn-secondary" onclick="adminSetTicketStatus('${t.id}','open')" style="font-size:.75rem">פתח מחדש</button>` : ''}
        </div>
      </div>
      ${isReplying ? `
      <div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid #e2e8f0">
        <textarea id="reply-text-${t.id}" rows="3" placeholder="כתוב תגובה — תישלח למייל ${t.userEmail || ''}..."
          style="width:100%;padding:.45rem .65rem;border:1.5px solid #6366f1;border-radius:.4rem;font-size:.875rem;resize:vertical;box-sizing:border-box;font-family:inherit"></textarea>
        <div style="display:flex;gap:.5rem;margin-top:.4rem">
          <button class="btn btn-primary btn-sm" onclick="adminSendReply('${t.id}')" style="font-size:.8rem">שלח תגובה במייל</button>
          <button class="btn btn-secondary btn-sm" onclick="adminToggleReply(null)" style="font-size:.8rem">ביטול</button>
        </div>
      </div>` : ''}
    </div>`;
  }

  const tabData = [
    { id: 'open',        label: `פתוחות (${open.length})`,    tickets: open,    color: open.length > 0 ? '#ef4444' : '' },
    { id: 'in_progress', label: `בטיפול (${inProg.length})`,  tickets: inProg,  color: '' },
    { id: 'closed',      label: `סגורות (${closed.length})`,  tickets: closed,  color: '' },
  ];

  const activeTab = adminSupportTab;
  const activeTabs = tabData.find(t => t.id === activeTab) || tabData[0];

  return `<div class="analysis-card" style="margin-bottom:1.5rem">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">
      <h3 class="font-semibold">🎫 פניות תמיכה${open.length > 0 ? ` <span style="background:#ef4444;color:#fff;font-size:.65rem;padding:.1rem .4rem;border-radius:9999px;margin-right:.35rem">${open.length} חדשות</span>` : ''}</h3>
      <button class="btn btn-sm btn-secondary" onclick="renderAdmin()" style="font-size:.75rem">🔄 רענן</button>
    </div>
    <div style="display:flex;gap:.25rem;margin-bottom:1rem;border-bottom:1px solid #e2e8f0;padding-bottom:.5rem;flex-wrap:wrap">
      ${tabData.map(t => `<button onclick="adminSupportTab='${t.id}';renderAdmin({keepScroll:true})"
        style="padding:.3rem .75rem;border-radius:.4rem;border:none;cursor:pointer;font-size:.8rem;font-weight:${activeTab===t.id?'700':'400'};
          background:${activeTab===t.id?'#1e293b':'transparent'};color:${activeTab===t.id?'#fff':t.color||'#64748b'}">
        ${t.label}</button>`).join('')}
    </div>
    <div id="support-tickets-list">
      ${activeTabs.tickets.length === 0
        ? `<p class="text-muted text-sm" style="padding:.75rem 0">אין פניות ב${activeTabs.label}</p>`
        : activeTabs.tickets.map(ticketRow).join('')}
    </div>
  </div>`;
}

// ── Admin Dashboard ───────────────────────────────────────────────────────────
let adminUserFilter = 'all';
var adminSupportTab = 'open';

async function renderAdmin(opts = {}) {
  if (!state.profile?.is_admin) { navigate('dashboard'); return; }
  const savedScroll = opts.keepScroll
    ? (document.getElementById('page-content')?.scrollTop || 0)
    : 0;
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  let overview = null, usersData = null, updatesData = [], supportData = { tickets: [], total: 0 };
  [overview, usersData, updatesData, supportData] = await Promise.all([
    api('GET', 'admin-overview').catch(e => { console.error('[admin] overview failed:', e.message); return null; }),
    api('GET', 'admin-users?limit=100&page=1').catch(e => { console.error('[admin] users failed:', e.message); return null; }),
    api('GET', 'admin-updates').catch(() => []),
    api('GET', 'admin-support?limit=50').catch(() => ({ tickets: [], total: 0 })),
  ]);
  // Update support badge count
  const openCount = (supportData.tickets || []).filter(t => t.status === 'open').length;
  if (state.supportCount !== openCount) { state.supportCount = openCount; }

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

    ${buildAdminUserSections(usersData, pBadge)}

    ${buildSupportSection(supportData)}

    <div class="analysis-card" style="margin-bottom:1.5rem">
      <h3 class="font-semibold mb-3">💳 שינוי תוכנית משתמש</h3>
      <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
        <input id="admin-plan-email" class="form-input" placeholder="אימייל משתמש..." style="flex:1;min-width:200px;padding:.45rem .75rem;border:1.5px solid #d1d5db;border-radius:.5rem;font-size:.875rem"/>
        <select id="admin-plan-select" style="padding:.45rem .75rem;border:1.5px solid #d1d5db;border-radius:.5rem;font-size:.875rem;background:#fff">
          <option value="free">Free</option>
          <option value="early_bird">Early Bird</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="agency">Agency</option>
        </select>
        <button class="btn btn-primary" onclick="adminChangePlanByEmail()">החל שינוי</button>
      </div>
      <p class="text-muted" style="font-size:.78rem;margin-top:.5rem">ניתן גם ללחוץ "שנה" ישירות בטבלת המשתמשים למטה</p>
    </div>

    <div class="analysis-card" style="margin-bottom:1.5rem">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold">📣 הודעות מערכת (פעמון)</h3>
      </div>
      <form onsubmit="adminSaveUpdate(event)" style="display:grid;gap:.6rem;margin-bottom:1rem">
        <input class="form-input" id="adm-upd-title" placeholder="כותרת ההודעה *" required
          style="padding:.45rem .75rem;border:1.5px solid #d1d5db;border-radius:.5rem;font-size:.875rem"/>
        <textarea class="form-input" id="adm-upd-content" placeholder="תוכן ההודעה *" rows="3" required
          style="padding:.45rem .75rem;border:1.5px solid #d1d5db;border-radius:.5rem;font-size:.875rem;resize:vertical"></textarea>
        <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
          <select id="adm-upd-type" style="padding:.45rem .75rem;border:1.5px solid #d1d5db;border-radius:.5rem;font-size:.875rem;background:#fff">
            <option value="new">חדש</option>
            <option value="improved">שיפור</option>
            <option value="fixed">תיקון</option>
          </select>
          <label style="display:flex;align-items:center;gap:.35rem;font-size:.875rem;cursor:pointer">
            <input type="checkbox" id="adm-upd-published" checked> פרסם מיד
          </label>
          <button type="submit" class="btn btn-primary">פרסם הודעה</button>
        </div>
      </form>
      <div id="admin-updates-list">
        ${(updatesData || []).length === 0
          ? '<p class="text-muted text-sm">אין הודעות עדיין</p>'
          : (updatesData || []).slice(0, 10).map(u => `
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;padding:.6rem 0;border-bottom:1px solid #f1f5f9">
              <div style="flex:1">
                <div style="font-weight:600;font-size:.875rem">${u.title}</div>
                <div class="text-muted" style="font-size:.78rem;margin-top:.15rem">${u.content.slice(0,80)}${u.content.length>80?'…':''}</div>
                <div style="margin-top:.25rem;display:flex;gap:.4rem;flex-wrap:wrap">
                  <span class="badge ${u.type==='new'?'badge-green':u.type==='improved'?'badge-blue':'badge-yellow'}">${u.type}</span>
                  <span class="badge ${u.is_published?'badge-green':'badge-gray'}">${u.is_published?'פורסם':'טיוטה'}</span>
                  ${u.is_pinned?'<span class="badge badge-purple">📌</span>':''}
                </div>
              </div>
              <div style="display:flex;gap:.35rem;flex-shrink:0">
                <button class="btn btn-sm btn-secondary" onclick="adminTogglePublish('${u.id}',${!u.is_published})">${u.is_published?'הסתר':'פרסם'}</button>
                <button class="btn btn-sm" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5" onclick="adminDeleteUpdate('${u.id}')">מחק</button>
              </div>
            </div>`).join('')}
      </div>
    </div>
  `);
  if (savedScroll > 0) {
    requestAnimationFrame(() => {
      const pc = document.getElementById('page-content');
      if (pc) pc.scrollTop = savedScroll;
    });
  }
}

function buildAdminUserSections(usersData, pBadge) {
  const allUsers    = usersData?.users || [];
  const pendingUsers = allUsers.filter(u => u.paymentStatus === 'pending');
  const paidUsers    = allUsers.filter(u => u.plan !== 'free' && u.paymentStatus !== 'pending');
  const freeUsers    = allUsers.filter(u => u.plan === 'free'  && u.paymentStatus !== 'pending');

  function buildRow(u, showActivate) {
    const adminBadge = u.isAdmin ? ' <span class="badge badge-blue" style="font-size:0.62rem">admin</span>' : '';
    const activateBtn = showActivate
      ? '<button class="btn btn-sm btn-primary" style="margin-left:.25rem" onclick="activateUserPayment(\'' + u.id + '\',\'' + u.plan + '\')">הפעל</button>'
      : '';
    const planOpts = ['free','early_bird','starter','pro','agency'].map(p =>
      '<option value="' + p + '"' + (u.plan === p ? ' selected' : '') + '>' + p + '</option>'
    ).join('');
    const changePlanCell =
      '<div style="display:flex;gap:.25rem;align-items:center">' +
      '<select id="ipl-' + u.id + '" style="padding:.15rem .35rem;border:1px solid #d1d5db;border-radius:.35rem;font-size:.72rem;max-width:90px">' + planOpts + '</select>' +
      '<button class="btn btn-sm btn-primary" onclick="adminChangePlanInline(\'' + u.id + '\')" style="padding:.2rem .45rem;font-size:.72rem">שנה</button>' +
      activateBtn +
      '</div>';
    const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString('he-IL') : '—';
    return '<tr style="border-bottom:1px solid #f1f5f9">' +
      '<td style="padding:0.4rem 0.6rem">' + (u.email || '') + adminBadge + '</td>' +
      '<td style="padding:0.4rem 0.6rem">' + (u.name || '—') + '</td>' +
      '<td style="padding:0.4rem 0.6rem"><span class="badge ' + (pBadge[u.plan] || 'badge-gray') + '">' + getPlanLabel(u.plan) + '</span></td>' +
      '<td style="padding:0.4rem 0.6rem">' + (u.campaignCount || 0) + '</td>' +
      '<td style="padding:0.4rem 0.6rem">' + joined + '</td>' +
      '<td style="padding:0.4rem 0.6rem">' + changePlanCell + '</td>' +
      '</tr>';
  }

  function buildTable(users, showActivate) {
    if (!users.length) return '<p class="text-muted text-sm">אין משתמשים</p>';
    return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.85rem">' +
      '<thead><tr style="border-bottom:1px solid #e2e8f0;color:#64748b">' +
      '<th style="text-align:right;padding:0.4rem 0.6rem;font-weight:500">אימייל</th>' +
      '<th style="text-align:right;padding:0.4rem 0.6rem;font-weight:500">שם</th>' +
      '<th style="text-align:right;padding:0.4rem 0.6rem;font-weight:500">תוכנית</th>' +
      '<th style="text-align:right;padding:0.4rem 0.6rem;font-weight:500">קמפיינים</th>' +
      '<th style="text-align:right;padding:0.4rem 0.6rem;font-weight:500">הצטרף</th>' +
      '<th style="text-align:right;padding:0.4rem 0.6rem;font-weight:500">שינוי תוכנית</th>' +
      '</tr></thead>' +
      '<tbody>' + users.map(u => buildRow(u, showActivate)).join('') + '</tbody>' +
      '</table></div>';
  }

  let html = '';
  if (pendingUsers.length > 0) {
    html += '<div class="analysis-card mb-4" style="border:2px solid #f59e0b;background:#fffbeb">' +
      '<h3 class="font-semibold mb-3" style="color:#92400e">⏳ ממתינים לאישור (' + pendingUsers.length + ')</h3>' +
      buildTable(pendingUsers, true) + '</div>';
  }
  html += '<div class="analysis-card mb-4">' +
    '<h3 class="font-semibold mb-3" style="color:#16a34a">💳 מנויים פעילים (' + paidUsers.length + ')</h3>' +
    buildTable(paidUsers, false) + '</div>';
  html += '<div class="analysis-card">' +
    '<h3 class="font-semibold mb-3" style="color:#64748b">🆓 גרסה חינמית (' + freeUsers.length + ')</h3>' +
    buildTable(freeUsers, false) + '</div>';
  return html;
}

function filterAdminUsers(filter) {
  adminUserFilter = filter;
  renderAdmin({ keepScroll: true });
}

async function activateUserPayment(userId, plan) {
  if (!confirm(`להפעיל תוכנית ${getPlanLabel(plan)} עבור משתמש זה?`)) return;
  try {
    await api('POST', 'activate-payment', { userId, plan });
    toast('החשבון הופעל ואימייל נשלח למשתמש!', 'success');
    renderAdmin({ keepScroll: true });
  } catch (err) {
    toast(err.message || 'שגיאה בהפעלה', 'error');
  }
}

function adminToggleReply(ticketId) {
  adminReplyTicketId = adminReplyTicketId === ticketId ? null : ticketId;
  renderAdmin({ keepScroll: true });
}

async function adminSendReply(ticketId) {
  const msg = document.getElementById('reply-text-' + ticketId)?.value?.trim();
  if (!msg) { toast('כתוב הודעה לפני שליחה', 'error'); return; }
  try {
    const r = await api('POST', 'admin-support', { ticketId, message: msg });
    toast(`✓ תגובה נשלחה ל-${r.to || 'המשתמש'}`, 'success');
    adminReplyTicketId = null;
    renderAdmin({ keepScroll: true });
  } catch (e) { toast(e.message, 'error'); }
}

async function adminSetTicketStatus(ticketId, status) {
  try {
    await api('PATCH', 'admin-support', { id: ticketId, status });
    if (status === 'closed' || status === 'open') adminReplyTicketId = null;
    toast(status === 'closed' ? 'פנייה נסגרה' : status === 'in_progress' ? 'סומן כבטיפול' : 'פנייה נפתחה מחדש', 'success');
    renderAdmin({ keepScroll: true });
  } catch (e) { toast(e.message, 'error'); }
}

async function adminChangePlanInline(userId) {
  const sel = document.getElementById('ipl-' + userId);
  if (!sel) return;
  const newPlan = sel.value;
  if (!confirm(`שינוי תוכנית ל-${newPlan}?`)) return;
  try {
    await api('POST', 'admin-user', { action: 'change_plan', targetUserId: userId, plan: newPlan });
    toast(`✓ תוכנית שונתה ל-${newPlan}`, 'success');
    renderAdmin({ keepScroll: true });
  } catch (e) { toast(e.message, 'error'); }
}

async function adminChangePlanByEmail() {
  const email   = document.getElementById('admin-plan-email')?.value?.trim();
  const newPlan = document.getElementById('admin-plan-select')?.value;
  if (!email) { toast('הכנס אימייל משתמש', 'error'); return; }
  if (!confirm(`שינוי תוכנית עבור ${email} ל-${newPlan}?`)) return;
  try {
    const usersRes = await api('GET', `admin-users?search=${encodeURIComponent(email)}&limit=1`);
    const user = usersRes?.users?.[0];
    if (!user) { toast('משתמש לא נמצא', 'error'); return; }
    await api('POST', 'admin-user', { action: 'change_plan', targetUserId: user.id, plan: newPlan });
    toast(`✓ תוכנית של ${email} שונתה ל-${newPlan}`, 'success');
    renderAdmin({ keepScroll: true });
  } catch (e) { toast(e.message, 'error'); }
}

async function adminSaveUpdate(e) {
  e.preventDefault();
  const body = {
    title:        document.getElementById('adm-upd-title').value.trim(),
    content:      document.getElementById('adm-upd-content').value.trim(),
    type:         document.getElementById('adm-upd-type').value,
    is_published: document.getElementById('adm-upd-published').checked,
    is_pinned:    false,
  };
  try {
    await api('POST', 'admin-updates', body);
    toast('הודעה פורסמה ✓', 'success');
    renderAdmin({ keepScroll: true });
  } catch (err) { toast(err.message, 'error'); }
}

async function adminTogglePublish(id, publish) {
  try {
    await api('PATCH', 'admin-updates', { id, is_published: publish });
    toast(publish ? 'פורסם ✓' : 'הוסתר', 'success');
    renderAdmin({ keepScroll: true });
  } catch (err) { toast(err.message, 'error'); }
}

async function adminDeleteUpdate(id) {
  if (!confirm('למחוק את ההודעה לצמיתות?')) return;
  try {
    await api('DELETE', 'admin-updates', { id });
    toast('נמחק', 'success');
    renderAdmin({ keepScroll: true });
  } catch (err) { toast(err.message, 'error'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// LEADS DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════

// Local leads state (scoped to this page)
const leadsState = {
  leads: [], total: 0, summary: null, assets: [],
  loading: false, error: null,
  filters: { search: '', status: '', assetId: '', dateFrom: '', dateTo: '', sort: 'newest' },
  pagination: { limit: 50, offset: 0 },
  detailLead: null,
};

const STATUS_LABELS = { new: 'חדש', contacted: 'ביצירת קשר', qualified: 'מוסמך', closed: 'סגור', archived: 'בארכיון' };
const STATUS_BADGE  = { new: 'badge-blue', contacted: 'badge-yellow', qualified: 'badge-indigo', closed: 'badge-green', archived: 'badge-gray' };

async function renderLeads() {
  renderShell(`<div id="leads-page">
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem">
      <div>
        <h1 class="page-title">📥 לידים</h1>
        <p class="page-subtitle" style="color:var(--gray-500);font-size:.9rem;margin-top:.25rem">לידים שנאספו מדפי הנחיתה שלך</p>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="leadsExportCSV()" id="leads-export-btn">ייצוא CSV</button>
    </div>
    <div id="leads-summary-row" class="leads-summary-row"></div>
    <div id="leads-filters" class="leads-filters"></div>
    <div id="leads-table-wrap"></div>
    <div id="leads-detail-modal"></div>
  </div>`);

  await leadsLoadAll();
}

async function leadsLoadAll() {
  leadsState.loading = true;
  leadsRenderTable('<div class="loading-screen" style="height:200px"><div class="spinner"></div></div>');

  try {
    const f = leadsState.filters;
    const p = leadsState.pagination;

    const params = new URLSearchParams();
    if (f.status)   params.set('status',    f.status);
    if (f.assetId)  params.set('asset_id',  f.assetId);
    if (f.search)   params.set('search',    f.search);
    if (f.dateFrom) params.set('date_from', f.dateFrom);
    if (f.dateTo)   params.set('date_to',   f.dateTo);
    params.set('sort',   f.sort);
    params.set('limit',  p.limit);
    params.set('offset', p.offset);

    const [result, summary, assets] = await Promise.all([
      api('GET', 'get-leads?' + params.toString()),
      leadsState.summary ? Promise.resolve(leadsState.summary) : api('GET', 'get-leads?summary=1'),
      leadsState.assets.length  ? Promise.resolve(leadsState.assets)  : api('GET', 'get-leads?assets=1'),
    ]);

    leadsState.leads   = result.leads  || [];
    leadsState.total   = result.total  || 0;
    leadsState.summary = summary;
    leadsState.assets  = assets || [];
    leadsState.error   = null;

  } catch (err) {
    leadsState.error = err.message || 'שגיאה בטעינת לידים';
  } finally {
    leadsState.loading = false;
  }

  leadsRenderSummary();
  leadsRenderFilters();
  leadsRenderTable();
}

function leadsRenderSummary() {
  const el = document.getElementById('leads-summary-row');
  if (!el) return;
  const s = leadsState.summary;
  if (!s) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="leads-kpi-grid">
      <div class="leads-kpi"><div class="leads-kpi-val">${s.total}</div><div class="leads-kpi-lbl">סה"כ לידים</div></div>
      <div class="leads-kpi leads-kpi-blue"><div class="leads-kpi-val">${s.new}</div><div class="leads-kpi-lbl">חדשים</div></div>
      <div class="leads-kpi leads-kpi-yellow"><div class="leads-kpi-val">${s.contacted}</div><div class="leads-kpi-lbl">ביצירת קשר</div></div>
      <div class="leads-kpi leads-kpi-green"><div class="leads-kpi-val">${s.closed}</div><div class="leads-kpi-lbl">סגורים</div></div>
    </div>`;
}

function leadsRenderFilters() {
  const el = document.getElementById('leads-filters');
  if (!el) return;
  const f = leadsState.filters;

  const assetOptions = leadsState.assets.map(a =>
    `<option value="${a.assetId}" ${f.assetId === a.assetId ? 'selected' : ''}>${escHtml(a.title || a.assetId.slice(0,8))}</option>`
  ).join('');

  el.innerHTML = `
    <div class="leads-filters-bar">
      <input type="search" class="leads-filter-input" placeholder="חיפוש שם / טלפון / מייל..."
        value="${escHtml(f.search)}" oninput="leadsSetFilter('search', this.value)" style="flex:2;min-width:160px">
      <select class="leads-filter-select" onchange="leadsSetFilter('status', this.value)">
        <option value="">כל הסטטוסים</option>
        <option value="new"       ${f.status==='new'       ?'selected':''}>חדש</option>
        <option value="contacted" ${f.status==='contacted' ?'selected':''}>ביצירת קשר</option>
        <option value="qualified" ${f.status==='qualified' ?'selected':''}>מוסמך</option>
        <option value="closed"    ${f.status==='closed'    ?'selected':''}>סגור</option>
        <option value="archived"  ${f.status==='archived'  ?'selected':''}>בארכיון</option>
      </select>
      ${leadsState.assets.length > 0 ? `
      <select class="leads-filter-select" onchange="leadsSetFilter('assetId', this.value)">
        <option value="">כל הדפים</option>
        ${assetOptions}
      </select>` : ''}
      <input type="date" class="leads-filter-input" value="${f.dateFrom}"
        onchange="leadsSetFilter('dateFrom', this.value)" style="max-width:150px">
      <input type="date" class="leads-filter-input" value="${f.dateTo}"
        onchange="leadsSetFilter('dateTo', this.value)" style="max-width:150px">
      <select class="leads-filter-select" onchange="leadsSetFilter('sort', this.value)" style="max-width:130px">
        <option value="newest" ${f.sort==='newest'?'selected':''}>חדש ראשון</option>
        <option value="oldest" ${f.sort==='oldest'?'selected':''}>ישן ראשון</option>
      </select>
      <button class="btn btn-sm btn-secondary" onclick="leadsResetFilters()">איפוס</button>
    </div>`;
}

function leadsRenderTable(overrideHtml) {
  const el = document.getElementById('leads-table-wrap');
  if (!el) return;

  if (overrideHtml) { el.innerHTML = overrideHtml; return; }

  if (leadsState.error) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-title">שגיאה בטעינה</div>
      <div class="empty-state-desc">${escHtml(leadsState.error)}</div>
      <button class="btn btn-primary btn-sm" onclick="leadsLoadAll()">נסה שוב</button>
    </div>`; return;
  }

  if (leadsState.leads.length === 0) {
    const hasFilters = Object.values(leadsState.filters).some(v => v && v !== 'newest');
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📭</div>
      <div class="empty-state-title">${hasFilters ? 'אין תוצאות לפילטר הנוכחי' : 'עדיין אין לידים'}</div>
      <div class="empty-state-desc">${hasFilters
        ? 'נסה לשנות את הפילטרים או לאפס אותם.'
        : 'לידים יופיעו כאן ברגע שגולשים ימלאו טפסים בדפי הנחיתה שלך.'}</div>
      ${hasFilters ? '<button class="btn btn-secondary btn-sm" onclick="leadsResetFilters()">איפוס פילטרים</button>' : ''}
    </div>`; return;
  }

  const rows = leadsState.leads.map(lead => {
    const status = lead.status || 'new';
    const date   = lead.created_at ? new Date(lead.created_at).toLocaleDateString('he-IL') : '—';
    const source = escHtml(lead.asset_title || lead.asset_id?.slice(0, 8) || '—');
    return `<tr class="leads-tr">
      <td class="leads-td">${escHtml(lead.name || '—')}</td>
      <td class="leads-td">
        ${lead.phone ? `<span class="leads-copy" title="העתק" onclick="leadsCopy('${escHtml(lead.phone)}')">${escHtml(lead.phone)}</span>` : '—'}
      </td>
      <td class="leads-td">
        ${lead.email ? `<span class="leads-copy" title="העתק" onclick="leadsCopy('${escHtml(lead.email)}')">${escHtml(lead.email)}</span>` : '—'}
      </td>
      <td class="leads-td leads-td-source">${source}</td>
      <td class="leads-td">${date}</td>
      <td class="leads-td">
        <select class="leads-status-select badge ${STATUS_BADGE[status] || 'badge-gray'}"
          onchange="leadsUpdateStatus('${lead.id}', this.value, this)">
          ${['new','contacted','qualified','closed','archived'].map(s =>
            `<option value="${s}" ${s===status?'selected':''}>${STATUS_LABELS[s]}</option>`
          ).join('')}
        </select>
      </td>
      <td class="leads-td leads-td-actions">
        <button class="btn btn-sm btn-secondary" onclick="leadsShowDetail('${lead.id}')">פרטים</button>
        ${lead.asset_id ? `<button class="btn btn-sm btn-secondary" onclick="window.open('/.netlify/functions/serve-asset?id=${escHtml(lead.asset_id)}','_blank')" title="פתח דף">🔗</button>` : ''}
        <button class="btn btn-sm" style="color:var(--red)" onclick="leadsConfirmDelete('${lead.id}')">🗑</button>
      </td>
    </tr>`;
  }).join('');

  const { offset, limit } = leadsState.pagination;
  const total = leadsState.total;
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  el.innerHTML = `
    <div class="leads-table-wrap">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;border-bottom:1px solid var(--gray-100)">
        <span style="font-size:.85rem;color:var(--gray-500)">${total} לידים סה"כ</span>
        <div style="display:flex;gap:.5rem">
          <button class="btn btn-sm btn-secondary" onclick="leadsPaginate(-1)" ${!hasPrev?'disabled':''}>→ הקודם</button>
          <button class="btn btn-sm btn-secondary" onclick="leadsPaginate(1)"  ${!hasNext?'disabled':''}>הבא ←</button>
        </div>
      </div>
      <div class="leads-table-scroll">
        <table class="leads-table">
          <thead>
            <tr>
              <th class="leads-th">שם</th>
              <th class="leads-th">טלפון</th>
              <th class="leads-th">מייל</th>
              <th class="leads-th">דף מקור</th>
              <th class="leads-th">תאריך</th>
              <th class="leads-th">סטטוס</th>
              <th class="leads-th">פעולות</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function leadsRenderDetail() {
  const el = document.getElementById('leads-detail-modal');
  if (!el) return;
  const lead = leadsState.detailLead;
  if (!lead) { el.innerHTML = ''; return; }

  const meta = Object.entries(lead.metadata || {})
    .filter(([k]) => !['source_url','user_agent','submitted_at'].includes(k))
    .map(([k, v]) => `<tr><td style="color:var(--gray-500);padding:.25rem .5rem">${escHtml(k)}</td><td style="padding:.25rem .5rem">${escHtml(String(v||''))}</td></tr>`)
    .join('');

  el.innerHTML = `
    <div class="modal-overlay" onclick="leadsCloseDetail()">
      <div class="modal-box" onclick="event.stopPropagation()" style="max-width:540px;width:100%">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
          <div class="modal-title" style="margin:0">פרטי ליד</div>
          <button onclick="leadsCloseDetail()" style="font-size:1.25rem;color:var(--gray-400);background:none;border:none;cursor:pointer">✕</button>
        </div>
        <table style="width:100%;font-size:.9rem;border-collapse:collapse">
          <tr><td class="leads-detail-label">שם</td><td>${escHtml(lead.name||'—')}</td></tr>
          <tr><td class="leads-detail-label">טלפון</td><td>${lead.phone?`<span class="leads-copy" onclick="leadsCopy('${escHtml(lead.phone)}')">${escHtml(lead.phone)}</span>`:'—'}</td></tr>
          <tr><td class="leads-detail-label">מייל</td><td>${lead.email?`<span class="leads-copy" onclick="leadsCopy('${escHtml(lead.email)}')">${escHtml(lead.email)}</span>`:'—'}</td></tr>
          <tr><td class="leads-detail-label">סטטוס</td><td><span class="badge ${STATUS_BADGE[lead.status]||'badge-gray'}">${STATUS_LABELS[lead.status]||lead.status}</span></td></tr>
          <tr><td class="leads-detail-label">דף מקור</td><td>${escHtml(lead.asset_title||lead.asset_id||'—')}</td></tr>
          <tr><td class="leads-detail-label">תאריך</td><td>${lead.created_at?new Date(lead.created_at).toLocaleString('he-IL'):'—'}</td></tr>
          ${lead.metadata?.source_url?`<tr><td class="leads-detail-label">מקור URL</td><td style="word-break:break-all;font-size:.8rem">${escHtml(lead.metadata.source_url)}</td></tr>`:''}
          ${meta?`<tr><td colspan="2" style="padding-top:.75rem;font-weight:600;font-size:.8rem;color:var(--gray-600)">שדות נוספים</td></tr>${meta}`:''}
        </table>
        <div style="margin-top:1.25rem;display:flex;gap:.5rem;justify-content:flex-end">
          ${lead.asset_id?`<button class="btn btn-sm btn-secondary" onclick="window.open('/.netlify/functions/serve-asset?id=${lead.asset_id}','_blank')">פתח דף נחיתה 🔗</button>`:''}
          <button class="btn btn-sm btn-secondary" onclick="leadsCloseDetail()">סגור</button>
        </div>
      </div>
    </div>`;
}

// ── Leads action handlers ─────────────────────────────────────────────────────

let leadsSearchTimer;
function leadsSetFilter(key, value) {
  leadsState.filters[key] = value;
  leadsState.pagination.offset = 0;
  clearTimeout(leadsSearchTimer);
  if (key === 'search') {
    leadsSearchTimer = setTimeout(() => leadsLoadAll(), 400);
  } else {
    leadsLoadAll();
  }
}

function leadsResetFilters() {
  leadsState.filters = { search: '', status: '', assetId: '', dateFrom: '', dateTo: '', sort: 'newest' };
  leadsState.pagination.offset = 0;
  leadsLoadAll();
}

function leadsPaginate(dir) {
  const { limit, offset } = leadsState.pagination;
  const newOffset = Math.max(0, offset + dir * limit);
  if (newOffset === offset) return;
  leadsState.pagination.offset = newOffset;
  leadsLoadAll();
}

async function leadsUpdateStatus(leadId, newStatus, selectEl) {
  try {
    await api('PATCH', 'update-lead', { lead_id: leadId, status: newStatus });
    // Update local state without full reload
    const lead = leadsState.leads.find(l => l.id === leadId);
    if (lead) lead.status = newStatus;
    if (selectEl) {
      selectEl.className = `leads-status-select badge ${STATUS_BADGE[newStatus] || 'badge-gray'}`;
    }
    if (leadsState.summary) {
      leadsState.summary = null; // invalidate — reload on next full fetch
    }
    toast('סטטוס עודכן', 'success');
  } catch (err) {
    toast(err.message || 'שגיאה בעדכון', 'error');
  }
}

function leadsConfirmDelete(leadId) {
  if (!confirm('האם למחוק את הליד לצמיתות?')) return;
  leadsDeleteLead(leadId);
}

async function leadsDeleteLead(leadId) {
  try {
    await api('DELETE', 'delete-lead', { lead_id: leadId });
    leadsState.leads = leadsState.leads.filter(l => l.id !== leadId);
    leadsState.total = Math.max(0, leadsState.total - 1);
    leadsState.summary = null;
    leadsRenderTable();
    toast('הליד נמחק', 'success');
  } catch (err) {
    toast(err.message || 'שגיאה במחיקה', 'error');
  }
}

async function leadsShowDetail(leadId) {
  const cached = leadsState.leads.find(l => l.id === leadId);
  leadsState.detailLead = cached || null;
  leadsRenderDetail();
  if (!cached) {
    try {
      const data = await api('GET', `get-leads?lead_id=${leadId}`);
      leadsState.detailLead = data;
      leadsRenderDetail();
    } catch { /* show what we have */ }
  }
}

function leadsCloseDetail() {
  leadsState.detailLead = null;
  leadsRenderDetail();
}

async function leadsExportCSV() {
  try {
    const f = leadsState.filters;
    const params = new URLSearchParams();
    if (f.status)   params.set('status',    f.status);
    if (f.assetId)  params.set('asset_id',  f.assetId);
    if (f.search)   params.set('search',    f.search);
    if (f.dateFrom) params.set('date_from', f.dateFrom);
    if (f.dateTo)   params.set('date_to',   f.dateTo);

    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${CONFIG.apiBase}/export-leads?${params.toString()}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) { toast('שגיאה בייצוא', 'error'); return; }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `leads-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('הקובץ הורד', 'success');
  } catch (err) {
    toast(err.message || 'שגיאה בייצוא', 'error');
  }
}

function leadsCopy(text) {
  navigator.clipboard?.writeText(text).then(() => toast('הועתק!', 'success')).catch(() => {});
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  if (params.has('success') || params.has('canceled') || params.has('session_id')) return 'settings';
  if (params.has('connected') || (params.has('error') && window.location.search)) return 'settings';
  // Restore page from URL hash on refresh
  const hash = window.location.hash.slice(1);
  if (hash && routes[hash]) return hash;
  return 'dashboard';
}

const BOOT_CACHE_KEY = 'cb_boot_v1';

function saveBootCache(data) {
  try { localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify({ ...data, _ts: Date.now() })); } catch {}
}
function loadBootCache() {
  try {
    const raw = localStorage.getItem(BOOT_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    // Cache valid for 30 minutes
    if (Date.now() - (c._ts || 0) > 30 * 60 * 1000) return null;
    return c;
  } catch { return null; }
}
function clearBootCache() {
  try { localStorage.removeItem(BOOT_CACHE_KEY); } catch {}
}

async function boot() {
  const initialPage = resolveInitialPage();
  let bootCompleted = false;


  sb.auth.onAuthStateChange(async (event, session) => {
    // Don't mark boot completed yet if token refresh may still be in progress
    if (event !== 'INITIAL_SESSION' || session) bootCompleted = true;

    // INITIAL_SESSION with null session = JWT refresh in progress — do NOT flash login screen
    // bootCompleted stays false so the 8-second fallback can call renderAuth() if no session arrives
    if (event === 'INITIAL_SESSION' && !session) return;

    // Token refresh — just update the token silently, no re-render needed
    if (event === 'TOKEN_REFRESHED') {
      if (session) state.accessToken = session.access_token;
      return;
    }

    if (!session) {
      clearBootCache();
      renderAuth();
      return;
    }

    state.user        = session.user;
    state.accessToken = session.access_token;

    // ── Step 1: instant render from localStorage cache ────────────────────────
    const cached = loadBootCache();
    if (cached && cached.userId === session.user.id) {
      state.profile         = cached.profile         || {};
      state.subscription    = cached.subscription    || { plan: 'free' };
      state.businessProfile = cached.businessProfile || null;
      state.campaigns       = cached.campaigns       || [];
      state.onboardingSteps = cached.onboardingSteps || {};
      state.unlockedScreens = computeUnlockedScreens(state.onboardingSteps);
      if (state.currentPage === 'dashboard' && initialPage !== 'dashboard') {
        state.currentPage = initialPage;
      }
      render();                // ← page appears instantly
    } else {
      // No cache — show shell with spinner only; Step 2 will render the real page.
      // Do NOT call render() here — it triggers page API calls and creates a
      // double-render race condition with Step 2.
      state.profile         = {};
      state.subscription    = { plan: 'free' };
      state.campaigns       = [];
      state.integrations    = [];
      state.unlockedScreens = new Set(['dashboard', 'business-profile', 'landing-pages']);
      // Respect hash routing even in no-cache path
      if (initialPage !== 'dashboard') state.currentPage = initialPage;
      renderShell('<div style="height:60vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1rem"><div class="spinner"></div><p style="color:#64748b;font-size:0.9rem;">טוען...</p></div>');
    }

    // ── Step 2: fetch fresh data in background ────────────────────────────────
    try {
      const [profile, sub, onboardingRes, bpRes, campsRes, intRes] = await Promise.all([
        sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('subscriptions').select('plan,status,payment_status').eq('user_id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('onboarding_progress').select('steps,current_step').eq('user_id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('business_profiles').select('*').eq('user_id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('campaigns').select('id,name,created_at').eq('owner_user_id', session.user.id).order('created_at', { ascending: false }).then(r => r.data),
        api('GET', 'integration-connect').catch(() => []),
      ]);

      state.profile         = profile  || {};
      state.subscription    = sub      || { plan: 'free' };
      state.businessProfile = bpRes    || null;
      state.campaigns       = campsRes || [];
      state.integrations    = Array.isArray(intRes) ? intRes : [];

      const steps = onboardingRes?.steps || {
        profile_started: !!(bpRes?.offer || bpRes?.business_name),
        first_asset:     false,
        multiple_assets: false,
        has_metrics:     false,
        has_ab_data:     false,
      };
      state.onboardingSteps = steps;
      state.unlockedScreens = computeUnlockedScreens(steps);

      // Save fresh data to cache for next visit
      saveBootCache({
        userId: session.user.id,
        profile, subscription: sub || { plan: 'free' },
        businessProfile: bpRes, campaigns: campsRes || [],
        onboardingSteps: steps,
      });

      // Local personal notifications count (stored in localStorage)
      state.localNotifCount = getLocalNotifications().filter(n => !n.read).length;

      // Fetch system updates — count only unread ones for bell
      api('GET', 'get-updates').then(data => {
        if (!Array.isArray(data)) return;
        const seenKey = 'seen_updates_' + session.user.id;
        const seen = new Set(JSON.parse(localStorage.getItem(seenKey) || '[]'));
        state.updatesCount = data.filter(u => !seen.has(u.id)).length;
        refreshBellBadge();
      }).catch(() => {});

      // Admin: load open support ticket count for sidebar badge
      if (state.profile?.is_admin) {
        api('GET', 'admin-support?status=open&limit=1').then(d => {
          state.supportCount = d?.total || 0;
          // re-render sidebar badge without full page re-render
          const adminNavItem = document.querySelector('.nav-item[data-page="admin"]');
          if (adminNavItem && state.supportCount > 0) {
            if (!adminNavItem.querySelector('[data-support-badge]')) {
              const badge = document.createElement('span');
              badge.setAttribute('data-support-badge', '');
              badge.style.cssText = 'margin-right:auto;background:#ef4444;color:#fff;font-size:0.6rem;font-weight:700;min-width:1.1rem;height:1.1rem;border-radius:9999px;display:inline-flex;align-items:center;justify-content:center;padding:0 3px';
              badge.textContent = state.supportCount > 99 ? '99+' : state.supportCount;
              adminNavItem.appendChild(badge);
            }
          }
        }).catch(() => {});
      }

      // New user flow: no business profile + no prior session → ai-creation
      const isNewUser = !bpRes && !cached && initialPage === 'dashboard';
      if (isNewUser) state.currentPage = 'ai-creation';

      // Re-render only if we didn't show cached version (first-ever load)
      if (!cached || cached.userId !== session.user.id) {
        if (!isNewUser && state.currentPage === 'dashboard' && initialPage !== 'dashboard') {
          state.currentPage = initialPage;
        }
        render();
      } else {
        // Redirect to settings with right tab for OAuth callbacks
        const _qp = new URLSearchParams(window.location.search);
        if (initialPage === 'settings' && _qp.has('connected')) {
          settingsTab = 'integrations';
        }
        if (initialPage === 'settings' && (_qp.has('success') || _qp.has('session_id'))) {
          settingsTab = 'billing';
        }
      }
    } catch {
      if (!cached) {
        state.profile      = {};
        state.subscription = { plan: 'free' };
        state.campaigns    = [];
        if (state.currentPage === 'dashboard' && initialPage !== 'dashboard') {
          state.currentPage = initialPage;
        }
        render();
      }
    }
    // Re-render once with all data loaded (only if we skipped cache)
  });

  setTimeout(() => {
    if (!bootCompleted && document.querySelector('.loading-screen')) renderAuth();
  }, 8000);

  keepAlive();
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
window.runAnalysis                = runAnalysis;
window.clearPersonalNotifications = clearPersonalNotifications;
window.showCampaignDetail    = showCampaignDetail;
window.connectIntegration    = connectIntegration;
window.disconnectIntegration = disconnectIntegration;
window.showCRMConnect        = showCRMConnect;
window.saveCRMWebhook        = saveCRMWebhook;
window.deleteAISavedWork     = deleteAISavedWork;
window.copyText              = copyText;
window.confirmPayment        = confirmPayment;
window.claimPayment          = claimPayment;
window.submitClaim           = submitClaim;
window.activateUserPayment   = activateUserPayment;
window.adminChangePlanInline = adminChangePlanInline;
window.adminChangePlanByEmail = adminChangePlanByEmail;
window.adminSaveUpdate       = adminSaveUpdate;
window.adminTogglePublish    = adminTogglePublish;
window.adminDeleteUpdate     = adminDeleteUpdate;
window.adminToggleReply      = adminToggleReply;
window.adminSendReply        = adminSendReply;
window.adminSetTicketStatus  = adminSetTicketStatus;
window.adminSupportTab       = adminSupportTab;
window.saveProfile           = saveProfile;
window.exportData            = exportData;
window.deleteAccount         = deleteAccount;
window.refreshLiveStats      = refreshLiveStats;
window.leadsSetFilter        = leadsSetFilter;
window.leadsResetFilters     = leadsResetFilters;
window.leadsPaginate         = leadsPaginate;
window.leadsUpdateStatus     = leadsUpdateStatus;
window.leadsConfirmDelete    = leadsConfirmDelete;
window.leadsShowDetail       = leadsShowDetail;
window.leadsCloseDetail      = leadsCloseDetail;
window.leadsExportCSV        = leadsExportCSV;
window.leadsCopy             = leadsCopy;
window.leadsLoadAll          = leadsLoadAll;
window.sendSupportMessage    = sendSupportMessage;
window.renderSupport         = renderSupport;
window.switchSettingsTab      = switchSettingsTab;
window.switchInsightsTab      = switchInsightsTab;
window.renderInsights         = renderInsights;
window._renderAICreationShell = _renderAICreationShell;
window.showQuickConnectModal  = showQuickConnectModal;

boot();
