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
  dashboard:               renderDashboard,
  'business-from-scratch': renderBusinessFromScratch,
  'ai-creation':           renderAICreation,
  'landing-pages':         renderLandingPages,
  campaigns:               renderCampaigns,
  leads:                   renderLeads,
  insights:                renderInsights,
  settings:                renderSettings,
  support:                 renderSupport,
  admin:                   renderAdmin,
  updates:                 renderUpdates,
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
    { id: 'dashboard',             icon: '📊', label: 'דשבורד' },
    { id: 'business-from-scratch', icon: '🧠', label: 'בניית עסק מאפס' },
    { id: 'ai-creation',           icon: '🤖', label: 'צור נכסים בAI' },
    { id: 'campaigns',             icon: '🎯', label: 'קמפיינים' },
    { id: 'leads',                 icon: '📥', label: 'לידים' },
    { id: 'insights',              icon: '📈', label: 'תובנות' },
    { id: 'settings',              icon: '⚙️', label: 'הגדרות' },
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

    <!-- ── Barrel Effect Card ──────────────────────────────────────────────── -->
    <div id="barrel-card" class="card mb-4" style="display:none"></div>

    <!-- ── Campaign Score Card ───────────────────────────────────────────────── -->
    <div id="score-card" class="card mb-4" style="display:none"></div>

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

  // Load Barrel Effect + Campaign Score in background
  if (state.campaigns?.length > 0 || state.currentCampaignId) {
    setTimeout(() => loadBarrelAndScore(), 400);
  }

  // Check for new achievements (delayed to avoid blocking render)
  setTimeout(() => checkNewAchievements(), 2000);
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
    // Scopes: ads_management + business_management require Meta app approval
    // They are listed here so the request is ready the moment approval is granted
    const scope = 'ads_read,read_insights,ads_management,business_management,pages_manage_ads';
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
        <div class="card-title">🖼️ מודעה ויזואלית מוכנה</div>
        <p class="text-sm text-muted mb-4">AI מעצב עבורך קריאייטיב ויזואלי מוכן לפרסום — מותאם לפלטפורמה שבחרת</p>
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
        <div class="form-group">
          <label class="form-label">שם העסק / מותג</label>
          <input class="form-input" id="creative-brand" value="${(bp.business_name||'').replace(/"/g,'&quot;')}" placeholder="שם העסק שיופיע במודעה" />
        </div>
        <button class="btn btn-gradient mt-4" style="width:auto;padding:0.75rem 2.5rem"
          id="ai-gen-creative-btn" onclick="generateAdCreative()">
          🖼️ צור מודעה ויזואלית
        </button>
        <div id="ai-result-creative" style="display:none" class="mt-4">
          <div class="flex items-center justify-between mb-3" style="background:#fff;padding:0.75rem 1rem;border-radius:0.75rem;border:1px solid #e2e8f0">
            <div class="card-title" style="margin:0">✅ הקריאייטיב שלך מוכן</div>
            <div class="flex gap-2">
              <button id="ai-save-creative-btn" class="btn btn-sm btn-secondary" style="display:none">💾 שמור</button>
              <button class="btn btn-sm btn-secondary" onclick="downloadAdCreative()">⬇️ הורד HTML</button>
              <button class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:none;border-radius:0.5rem;padding:0.35rem 0.75rem;font-size:0.8rem;cursor:pointer" onclick="clearAdCreative()">🗑️ נקה</button>
            </div>
          </div>
          <div id="ai-result-creative-text"></div>
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
  if (tab === 'ad_creative') setTimeout(restoreAdCreative, 0);
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
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'מעצב קריאייטיב...';
  const platform = document.getElementById('creative-platform')?.value || 'facebook';
  const type     = document.getElementById('creative-type')?.value || 'conversion';
  const offer    = document.getElementById('creative-offer')?.value.trim() || '';
  const audience = document.getElementById('creative-audience')?.value.trim() || '';
  const deal     = document.getElementById('creative-deal')?.value.trim() || '';
  const brand    = document.getElementById('creative-brand')?.value.trim() || offer.split(' ')[0] || 'המותג שלך';
  if (!offer) { toast('נא למלא את שדה המוצר / שירות', 'error'); btn.disabled = false; btn.textContent = '🖼️ צור מודעה ויזואלית'; return; }
  const typeLabels = { awareness: 'חשיפה ומודעות', lead: 'לידים', conversion: 'המרה ומכירה', retargeting: 'ריטרגטינג' };
  const platformNames = { facebook: 'פייסבוק', instagram: 'אינסטגרם', google: 'Google Ads', tiktok: 'TikTok' };
  const platformSpecs = {
    facebook:  { width: '500px', ratio: '1200x628', style: 'כרטיס רוחבי עם אזור תמונה גדול, לוגו וטקסט בתחתית' },
    instagram: { width: '420px', ratio: '1080x1080', style: 'ריבוע מרובע, עיצוב מרכזי עם ויזואל חזק ומינימליסטי' },
    tiktok:    { width: '340px', ratio: '1080x1920', style: 'אנכי מלא מסך, כהה ודינמי, טקסט ב overlay' },
    google:    { width: '560px', ratio: 'טקסט בלבד', style: 'מודעת חיפוש: כותרת כחולה, URL ירוק, תיאור אפור' },
  };
  const spec = platformSpecs[platform] || platformSpecs.facebook;

  try {
    const result = await api('POST', 'campaigner-chat', {
      message: `[DIRECT_AD] אתה מעצב גרפי מקצועי ומומחה לפרסום ברשתות חברתיות. צור קוד HTML+CSS מלא לקריאייטיב מודעה מקצועי ל${platformNames[platform]||platform}.

פרטי המודעה:
- מוצר/שירות: ${offer}
- מותג/שם עסק: ${brand}
- קהל יעד: ${audience||'קהל ישראלי כללי'}
- הצעת ערך / מבצע: ${deal||'לא צוין'}
- מטרת הקמפיין: ${typeLabels[type]||type}
- יחס גובה-רוחב: ${spec.ratio}
- סגנון הפלטפורמה: ${spec.style}

דרישות טכניות:
- צור קוד HTML מלא ועצמאי (כולל <!DOCTYPE html> וכל הסגנונות inline)
- רוחב מוגדר: ${spec.width}
- עיצוב ויזואלי מקצועי ברמת פרסומאי מקצועי — גרדיאנטים, צבעים חזקים, טיפוגרפיה ברורה
- כל הטקסטים בעברית (כיוון RTL: dir="rtl")
- צבעי מותג עקביים ויפים
- אלמנטים ויזואליים: צורות גיאומטריות, גרדיאנטים, אייקונים (emoji בלבד, אין תמונות חיצוניות)
- כפתור CTA בולט עם hover effect
- "ממומן" badge קטן
- נראה כמו מודעה אמיתית שמוכנה לפרסום

החזר אך ורק את קוד ה-HTML המלא, ללא הסברים, ללא markdown, ללא \`\`\` — רק הקוד עצמו שמתחיל ב-<!DOCTYPE html>`,
      history: [],
    });

    const raw = result.reply || '';
    const htmlMatch = raw.match(/<!DOCTYPE html[\s\S]*/i) || raw.match(/<html[\s\S]*/i);
    const adHtml = htmlMatch ? htmlMatch[0] : raw.trim();

    if (!adHtml || adHtml.length < 100) {
      toast('שגיאה ביצירת הקריאייטיב', 'error');
      return;
    }

    const stored = { platform, brand, offer, html: adHtml, timestamp: Date.now() };
    try { localStorage.setItem('lastAdCreative', JSON.stringify(stored)); } catch {}

    _renderAdCreativeResult(stored);
    const saveBtn = document.getElementById('ai-save-creative-btn');
    if (saveBtn) { saveBtn.style.display = ''; saveBtn.onclick = () => saveAIWork('ad_creative', `מודעה ויזואלית — ${platformNames[platform]||platform}`, `פלטפורמה: ${platformNames[platform]||platform}\nמותג: ${brand}\nמוצר: ${offer}`); }
    toast('הקריאייטיב מוכן!', 'success');
  } catch (err) {
    toast(err.message || 'שגיאה ביצירת מודעה', 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🖼️ צור מודעה ויזואלית';
  }
}

function _renderAdCreativeResult(stored) {
  const resBox  = document.getElementById('ai-result-creative');
  const resText = document.getElementById('ai-result-creative-text');
  if (!resBox || !resText) return;
  resBox.style.display = '';
  const iframeId = 'ad-creative-iframe';
  resText.innerHTML = `
    <div style="display:flex;justify-content:center;padding:1rem 0">
      <iframe id="${iframeId}" style="border:none;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);max-width:100%" scrolling="no"></iframe>
    </div>`;
  const iframe = document.getElementById(iframeId);
  if (iframe) {
    iframe.srcdoc = stored.html;
    iframe.onload = function() {
      try {
        const h = iframe.contentDocument?.body?.scrollHeight;
        if (h && h > 50) iframe.style.height = h + 'px';
        const w = iframe.contentDocument?.body?.scrollWidth;
        if (w && w > 50) iframe.style.width = Math.min(w, 600) + 'px';
      } catch {}
    };
  }
  resBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function restoreAdCreative() {
  try {
    const raw = localStorage.getItem('lastAdCreative');
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (!stored?.html) return;
    _renderAdCreativeResult(stored);
    const resBox = document.getElementById('ai-result-creative');
    if (resBox) resBox.scrollIntoView = () => {};
  } catch {}
}

function clearAdCreative() {
  try { localStorage.removeItem('lastAdCreative'); } catch {}
  const resBox = document.getElementById('ai-result-creative');
  if (resBox) resBox.style.display = 'none';
  const resText = document.getElementById('ai-result-creative-text');
  if (resText) resText.innerHTML = '';
  toast('המודעה נמחקה', 'success');
}

function downloadAdCreative() {
  try {
    const raw = localStorage.getItem('lastAdCreative');
    if (!raw) { toast('אין מודעה להורדה', 'error'); return; }
    const stored = JSON.parse(raw);
    const blob = new Blob([stored.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ad-creative-${stored.platform || 'ad'}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('הקריאייטיב הורד!', 'success');
  } catch { toast('שגיאה בהורדה', 'error'); }
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
    { id: 'team',         icon: '👥', label: 'צוות' },
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
    } else if (settingsTab === 'account') {
      const fresh = await api('GET', 'account-profile');
      if (fresh) state.profile = { ...state.profile, ...fresh };
      if (!window._acctSubTab) window._acctSubTab = 'profile';
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

  const buildAccountTab = () => {
    const plan      = state.subscription?.plan || 'free';
    const isPaid    = ['early_bird','starter','pro','agency'].includes(plan);
    const email     = state.profile?.email || state.user?.email || '';
    const fullName  = state.profile?.full_name || state.profile?.name || '';
    const avatarUrl = state.profile?.avatar_url || '';
    const initials  = fullName ? fullName.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
                               : email.slice(0,2).toUpperCase();
    const memberSince = state.profile?.created_at
      ? new Date(state.profile.created_at).toLocaleDateString('he-IL', { year:'numeric', month:'long' })
      : '—';

    const planLabel = { free:'חינמי', early_bird:'Early Bird', starter:'Starter', pro:'Pro', agency:'Agency' }[plan] || plan;
    const planColor = isPaid ? '#166534' : '#1e40af';
    const planBg    = isPaid ? '#dcfce7' : '#dbeafe';

    const subTabs = [
      { id:'profile',  label:'פרופיל' },
      { id:'security', label:'אבטחה' },
      { id:'data',     label:'נתונים' },
    ];
    const sub = window._acctSubTab || 'profile';

    const subTabBar = `<div style="display:flex;gap:0;border-bottom:1px solid #e2e8f0;margin-bottom:1.5rem">
      ${subTabs.map(t=>`
        <button onclick="switchAcctSubTab('${t.id}')"
          style="padding:0.55rem 1.1rem;border:none;border-bottom:2px solid ${sub===t.id?'#6366f1':'transparent'};
                 margin-bottom:-1px;background:none;cursor:pointer;font-size:0.83rem;
                 font-weight:${sub===t.id?'700':'500'};color:${sub===t.id?'#6366f1':'#64748b'};white-space:nowrap">
          ${t.label}
        </button>`).join('')}
    </div>`;

    // ── Profile sub-tab ──────────────────────────────────────────────────────
    const profileTab = `
      <div style="display:flex;align-items:center;gap:1.25rem;margin-bottom:1.75rem">
        <div style="position:relative;cursor:pointer" onclick="document.getElementById('avatar-file-input').click()">
          ${avatarUrl
            ? `<img src="${avatarUrl}" alt="avatar"
                style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2px solid #e2e8f0" />`
            : `<div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);
                            display:flex;align-items:center;justify-content:center;font-size:1.5rem;
                            font-weight:700;color:#fff;border:2px solid #e2e8f0;user-select:none">
                ${initials}
               </div>`}
          <div style="position:absolute;bottom:0;left:0;width:22px;height:22px;background:#6366f1;
                      border-radius:50%;display:flex;align-items:center;justify-content:center;
                      border:2px solid #fff;font-size:0.6rem;color:#fff">✎</div>
          <input type="file" id="avatar-file-input" accept="image/jpeg,image/png,image/webp"
            style="display:none" onchange="uploadAvatar(this)" />
        </div>
        <div>
          <div style="font-weight:700;font-size:1rem">${fullName || email}</div>
          <div style="font-size:0.8rem;color:#64748b">${email}</div>
          <div style="font-size:0.75rem;color:#94a3b8;margin-top:0.2rem">לחץ על התמונה לשינוי</div>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:1.25rem">
        <label class="form-label">שם מלא</label>
        <input class="form-input" id="profile-fullname"
          value="${fullName.replace(/"/g,'&quot;')}"
          oninput="_acctMarkDirty()"
          placeholder="השם שיוצג בממשק" />
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">אימייל</label>
        <input class="form-input" type="email" value="${email}"
          readonly style="opacity:0.55;cursor:not-allowed;background:#f8fafc" />
        <div style="font-size:0.75rem;color:#94a3b8;margin-top:0.35rem">האימייל לא ניתן לשינוי כאן</div>
      </div>`;

    // ── Security sub-tab ─────────────────────────────────────────────────────
    const securityTab = `
      <div class="card mb-4" style="margin-bottom:1rem">
        <div style="font-weight:700;font-size:0.95rem;margin-bottom:1rem">🔑 שינוי סיסמה</div>
        <div class="form-group">
          <label class="form-label">סיסמה חדשה</label>
          <input class="form-input" type="password" id="new-password" placeholder="לפחות 8 תווים" autocomplete="new-password" />
        </div>
        <div class="form-group" style="margin-bottom:1rem">
          <label class="form-label">אשר סיסמה חדשה</label>
          <input class="form-input" type="password" id="confirm-password" placeholder="חזור על הסיסמה" autocomplete="new-password" />
        </div>
        <button class="btn btn-primary" style="width:auto" onclick="savePassword()">עדכן סיסמה</button>
      </div>
      <div class="card mb-4" style="margin-bottom:1rem">
        <div style="font-weight:700;font-size:0.95rem;margin-bottom:0.5rem">📱 כל המכשירים</div>
        <p style="font-size:0.83rem;color:#64748b;margin-bottom:1rem">התנתק מכל המכשירים האחרים שמחוברים לחשבון זה</p>
        <button class="btn btn-secondary" style="width:auto" onclick="signOutAllDevices()">התנתק מכל המכשירים</button>
      </div>
      <div class="card" style="border:1px solid #e2e8f0;background:#f8fafc;opacity:0.7">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-weight:700;font-size:0.95rem;margin-bottom:0.25rem">🔒 אימות דו-שלבי</div>
            <p style="font-size:0.83rem;color:#64748b;margin:0">הגנה נוספת על חשבונך</p>
          </div>
          <span style="font-size:0.72rem;background:#fef3c7;color:#92400e;padding:0.2rem 0.6rem;border-radius:9999px;font-weight:600">בקרוב</span>
        </div>
      </div>`;

    // ── Data sub-tab ─────────────────────────────────────────────────────────
    const dataTab = `
      <div class="card mb-4" style="margin-bottom:1rem">
        <div style="font-weight:700;font-size:0.95rem;margin-bottom:0.5rem">📥 ייצוא נתונים</div>
        <p style="font-size:0.83rem;color:#64748b;margin-bottom:1rem">הורד עותק של כל הנתונים שלך (GDPR)</p>
        <button class="btn btn-secondary" style="width:auto" onclick="exportData()">הורד את הנתונים שלי</button>
      </div>
      <div class="card" style="border:1px solid #fca5a5;background:#fff5f5">
        <div style="font-weight:700;font-size:0.95rem;color:#991b1b;margin-bottom:0.5rem">⚠️ מחיקת חשבון</div>
        <p style="font-size:0.83rem;color:#64748b;margin-bottom:1rem">
          פעולה זו בלתי הפיכה. כל הנתונים שלך יימחקו לצמיתות.
        </p>
        <div class="form-group" style="margin-bottom:1rem">
          <label class="form-label" style="color:#991b1b">אשר על ידי הקלדת המייל שלך: <strong>${email}</strong></label>
          <input class="form-input" type="email" id="delete-confirm-email"
            placeholder="${email}"
            style="border-color:#fca5a5" />
        </div>
        <button class="btn btn-danger" style="width:auto" onclick="deleteAccount()">מחק את החשבון לצמיתות</button>
      </div>`;

    const subContent = sub === 'security' ? securityTab
                     : sub === 'data'     ? dataTab
                     : profileTab;

    const dirtySaveBar = `
      <div id="acct-save-bar" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:1000;
           background:#fff;border-top:1px solid #e2e8f0;padding:0.875rem 1.5rem;
           box-shadow:0 -4px 12px rgba(0,0,0,0.08);align-items:center;justify-content:space-between;gap:1rem">
        <span style="font-size:0.875rem;color:#64748b">יש שינויים שלא נשמרו</span>
        <div style="display:flex;gap:0.5rem">
          <button class="btn btn-secondary" style="width:auto" onclick="_acctCancelChanges()">ביטול</button>
          <button class="btn btn-primary" style="width:auto" onclick="saveAcctChanges()">שמור שינויים</button>
        </div>
      </div>`;

    return `
      <div class="card" style="margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem">
        <div>
          <div style="font-size:0.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem">מצב חשבון</div>
          <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
            <span style="font-weight:700;font-size:1rem">${fullName || email}</span>
            <span style="font-size:0.75rem;background:${planBg};color:${planColor};
                         padding:0.2rem 0.65rem;border-radius:9999px;font-weight:600">${planLabel}</span>
          </div>
          <div style="font-size:0.8rem;color:#94a3b8;margin-top:0.2rem">חבר מאז ${memberSince}</div>
        </div>
        ${!isPaid ? `<button class="btn btn-gradient" style="width:auto" onclick="switchSettingsTab('billing');renderSettings()">שדרג תוכנית →</button>` : ''}
      </div>
      <div class="card">
        ${subTabBar}
        ${subContent}
      </div>
      ${sub === 'profile' ? dirtySaveBar : ''}`;
  };

  const buildTeamTab = () => {
    const plan = state.subscription?.plan || 'free';
    const paidPlans = ['early_bird','starter','pro','agency'];
    const isPaid = paidPlans.includes(plan);
    const limits = { early_bird: 2, starter: 3, pro: 10, agency: 50 };
    const maxMembers = limits[plan] || 0;
    if (!isPaid) return `
      <div class="card" style="text-align:center;padding:2.5rem">
        <div style="font-size:2rem;margin-bottom:1rem">👥</div>
        <div style="font-weight:700;font-size:1.1rem;margin-bottom:0.5rem">הזמן חברי צוות</div>
        <div style="color:#64748b;margin-bottom:1.5rem">שתף גישה לדוחות ולקמפיינים עם אנשי הצוות שלך</div>
        <button class="btn btn-gradient" style="width:auto" onclick="switchSettingsTab('billing');renderSettings()">שדרג לצוות →</button>
      </div>`;

    return `
      <div class="flex flex-col gap-4">
        <div class="card">
          <div class="card-title flex items-center justify-between">
            <span>👥 חברי צוות</span>
            <span style="font-size:0.75rem;color:#64748b">עד ${maxMembers} חברים בתוכנית ${plan}</span>
          </div>
          <div style="display:flex;gap:0.75rem;margin-bottom:1.25rem">
            <input id="team-email-input" type="email" placeholder="כתובת אימייל של חבר הצוות" class="form-input" style="flex:1;margin:0" />
            <select id="team-role-select" class="form-input" style="width:auto;margin:0">
              <option value="viewer">צופה</option>
              <option value="admin">מנהל</option>
            </select>
            <button class="btn btn-primary" style="width:auto;white-space:nowrap" onclick="teamInvite()">הזמן</button>
          </div>
          <div id="team-members-list"><div style="color:#94a3b8;font-size:0.875rem;text-align:center;padding:1rem">טוען...</div></div>
        </div>
        <div class="card">
          <div class="card-title">הרשאות לפי תפקיד</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;font-size:0.8rem;text-align:center">
            <div style="font-weight:700;padding:0.5rem;background:#f8fafc;border-radius:8px">פעולה</div>
            <div style="font-weight:700;padding:0.5rem;background:#f8fafc;border-radius:8px">מנהל</div>
            <div style="font-weight:700;padding:0.5rem;background:#f8fafc;border-radius:8px">צופה</div>
            ${[['צפייה בדוחות','✓','✓'],['עריכת הגדרות','✓','✗'],['יצירת קמפיינים','✓','✗'],['ניהול חיוב','✗','✗']].map(([a,ad,vi])=>`
              <div style="padding:0.4rem;border-bottom:1px solid #f1f5f9">${a}</div>
              <div style="padding:0.4rem;border-bottom:1px solid #f1f5f9;color:${ad==='✓'?'#22c55e':'#ef4444'};font-weight:700">${ad}</div>
              <div style="padding:0.4rem;border-bottom:1px solid #f1f5f9;color:${vi==='✓'?'#22c55e':'#ef4444'};font-weight:700">${vi}</div>
            `).join('')}
          </div>
        </div>
      </div>`;
  };

  const tabContent = settingsTab === 'business'     ? buildBusinessTab()
                   : settingsTab === 'integrations' ? buildIntegrationsTab()
                   : settingsTab === 'team'          ? buildTeamTab()
                   : settingsTab === 'billing'       ? buildBillingTab()
                   : buildAccountTab();

  renderShell(`
    <div class="page-header"><h1 class="page-title">⚙️ הגדרות</h1></div>
    ${_settingsTabBar()}
    ${tabContent}
  `);

  // Auto-load team members list when on team tab
  if (settingsTab === 'team') setTimeout(() => teamLoadMembers(), 100);
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
  if (e) e.preventDefault();
  try {
    const nameEl = document.getElementById('profile-fullname');
    if (!nameEl) return;
    const updates = { name: nameEl.value.trim(), full_name: nameEl.value.trim() };
    const profile = await api('PUT', 'account-profile', updates);
    state.profile = { ...state.profile, ...profile };
    toast('הפרופיל עודכן!', 'success');
    _acctCancelChanges();
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
  const emailEl = document.getElementById('delete-confirm-email');
  const userEmail = state.profile?.email || state.user?.email || '';
  if (!emailEl || emailEl.value.trim().toLowerCase() !== userEmail.toLowerCase()) {
    toast('האימייל שהזנת אינו תואם — נסה שוב', 'error');
    return;
  }
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

function switchAcctSubTab(sub) {
  window._acctSubTab = sub;
  window._acctDirty  = false;
  renderSettings();
}

function _acctMarkDirty() {
  if (window._acctDirty) return;
  window._acctDirty = true;
  const bar = document.getElementById('acct-save-bar');
  if (bar) bar.style.display = 'flex';
}

function _acctCancelChanges() {
  window._acctDirty = false;
  const bar = document.getElementById('acct-save-bar');
  if (bar) bar.style.display = 'none';
  renderSettings();
}

async function saveAcctChanges() {
  await saveProfile();
}

async function uploadAvatar(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('הקובץ גדול מדי — מקסימום 2MB', 'error'); return; }
  try {
    toast('מעלה תמונה...', 'info');
    const ext  = file.name.split('.').pop().toLowerCase();
    const path = `${state.user.id}/avatar.${ext}`;
    const { data, error } = await sb.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;
    const { data: { publicUrl } } = sb.storage.from('avatars').getPublicUrl(path);
    const profile = await api('PUT', 'account-profile', { avatarUrl: publicUrl });
    state.profile = { ...state.profile, ...profile, avatar_url: publicUrl };
    toast('התמונה עודכנה!', 'success');
    renderSettings();
  } catch (err) {
    toast(err.message || 'שגיאה בהעלאת תמונה', 'error');
  }
}

async function savePassword() {
  const newPw  = document.getElementById('new-password')?.value || '';
  const confPw = document.getElementById('confirm-password')?.value || '';
  if (!newPw || newPw.length < 8) { toast('הסיסמה חייבת להכיל לפחות 8 תווים', 'error'); return; }
  if (newPw !== confPw) { toast('הסיסמאות אינן תואמות', 'error'); return; }
  try {
    const { error } = await sb.auth.updateUser({ password: newPw });
    if (error) throw error;
    toast('הסיסמה עודכנה בהצלחה!', 'success');
    document.getElementById('new-password').value     = '';
    document.getElementById('confirm-password').value = '';
  } catch (err) {
    toast(err.message || 'שגיאה בעדכון סיסמה', 'error');
  }
}

async function signOutAllDevices() {
  if (!confirm('להתנתק מכל המכשירים?')) return;
  try {
    const { error } = await sb.auth.signOut({ scope: 'global' });
    if (error) throw error;
    state = { user: null, profile: null, subscription: null, campaigns: [], integrations: [], liveStats: {}, liveStatsLoading: false, currentPage: 'dashboard', currentCampaignId: null, accessToken: null };
    renderAuth();
    toast('התנתקת מכל המכשירים', 'info');
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

// ── Admin Control Center ──────────────────────────────────────────────────────
let adminUserFilter  = 'all';
var adminSupportTab  = 'open';
var adminTab         = 'overview';
var adminUsersSearch = '';
var adminUsersPage   = 1;
var adminAuditPage   = 1;
var adminJobsFilter  = '';
var _adminCache      = {}; // short-lived cache: { tab: { data, ts } }

function _adminCacheGet(key) {
  const c = _adminCache[key];
  return c && (Date.now() - c.ts < 30000) ? c.data : null;
}
function _adminCacheSet(key, data) { _adminCache[key] = { data, ts: Date.now() }; }

async function switchAdminTab(tab) {
  adminTab = tab;
  _adminCache = {};
  renderAdmin();
}

function _adminTabBar() {
  const tabs = [
    { id:'overview',      icon:'📊', label:'סקירה'      },
    { id:'users',         icon:'👤', label:'משתמשים'    },
    { id:'billing',       icon:'💳', label:'חיוב'       },
    { id:'system',        icon:'⚙️', label:'מערכת'      },
    { id:'ai-costs',      icon:'🤖', label:'עלויות AI'  },
    { id:'audit',         icon:'📋', label:'לוג פעולות' },
    { id:'support',       icon:'🎫', label:'תמיכה'      },
    { id:'announcements', icon:'📣', label:'הודעות'     },
    { id:'ai-models',     icon:'🧠', label:'מודלי AI'   },
  ];
  return `<div style="display:flex;gap:0;border-bottom:2px solid #e2e8f0;margin-bottom:1.5rem;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none">
    ${tabs.map(t => `
      <button onclick="switchAdminTab('${t.id}')"
        style="padding:0.55rem 0.85rem;border:none;border-bottom:2px solid ${adminTab===t.id?'#6366f1':'transparent'};
               margin-bottom:-2px;background:none;cursor:pointer;font-size:0.78rem;white-space:nowrap;
               font-weight:${adminTab===t.id?'700':'500'};color:${adminTab===t.id?'#6366f1':'#64748b'};transition:color .15s">
        ${t.icon} ${t.label}
      </button>`).join('')}
  </div>`;
}

async function renderAdmin(opts = {}) {
  if (!state.profile?.is_admin) { navigate('dashboard'); return; }

  const savedScroll = opts.keepScroll ? (document.getElementById('page-content')?.scrollTop || 0) : 0;

  renderShell(`
    <div class="page-header" style="margin-bottom:0">
      <h1 class="page-title">🛡️ Control Center</h1>
      <p class="page-subtitle">לוח פיקוד ושליטה</p>
    </div>
    ${_adminTabBar()}
    <div id="admin-tab-content" style="min-height:200px">
      <div class="loading-screen" style="height:50vh"><div class="spinner"></div></div>
    </div>
  `);

  const html = await _adminLoadTab(adminTab, opts).catch(e =>
    `<div class="card"><p class="text-muted">שגיאה בטעינה: ${e.message}</p></div>`
  );
  const el = document.getElementById('admin-tab-content');
  if (el) el.innerHTML = html;

  if (adminTab === 'ai-models') setTimeout(() => adminLoadAIModels(), 100);
  if (savedScroll > 0) requestAnimationFrame(() => {
    const pc = document.getElementById('page-content');
    if (pc) pc.scrollTop = savedScroll;
  });
}

// ── Tab loader ────────────────────────────────────────────────────────────────
async function _adminLoadTab(tab) {
  const fmt  = n => n == null ? '—' : Number(n).toLocaleString('he-IL');
  const pct  = n => n == null ? '—' : (Number(n) * 100).toFixed(1) + '%';
  const curr = n => n == null ? '—' : '$' + (Number(n)).toFixed(2);
  const currILS = n => n == null ? '—' : '₪' + (Number(n) / 100).toFixed(0);
  const pBadge  = { free:'badge-gray', early_bird:'badge-blue', starter:'badge-blue', pro:'badge-green', agency:'badge-green' };

  if (tab === 'overview') {
    let ov = _adminCacheGet('overview');
    if (!ov) { ov = await api('GET', 'admin-overview').catch(() => null); _adminCacheSet('overview', ov); }
    return _adminBuildOverview(ov, fmt, pct, currILS);
  }

  if (tab === 'users') {
    const q = `admin-users?limit=50&page=${adminUsersPage}${adminUsersSearch ? '&search=' + encodeURIComponent(adminUsersSearch) : ''}${adminUserFilter !== 'all' ? '&plan=' + adminUserFilter : ''}`;
    const usersData = await api('GET', q).catch(() => ({ users: [], total: 0 }));
    return _adminBuildUsers(usersData, pBadge);
  }

  if (tab === 'billing') {
    let billing = _adminCacheGet('billing');
    if (!billing) { billing = await api('GET', 'admin-billing?days=30').catch(() => null); _adminCacheSet('billing', billing); }
    return _adminBuildBilling(billing, fmt, curr, currILS);
  }

  if (tab === 'system') {
    const [system, jobs] = await Promise.all([
      api('GET', 'admin-system').catch(() => null),
      api('GET', `admin-jobs?limit=30${adminJobsFilter ? '&status=' + adminJobsFilter : ''}`).catch(() => ({ jobs: [], total: 0, summary24h: {} })),
    ]);
    return _adminBuildSystem(system, jobs, fmt);
  }

  if (tab === 'ai-costs') {
    let aiData = _adminCacheGet('ai-costs');
    if (!aiData) { aiData = await api('GET', 'admin-ai-models').catch(() => null); _adminCacheSet('ai-costs', aiData); }
    return _adminBuildAICosts(aiData, curr);
  }

  if (tab === 'audit') {
    const audit = await api('GET', `admin-audit?limit=50&page=${adminAuditPage}`).catch(() => ({ entries: [], total: 0 }));
    return _adminBuildAudit(audit);
  }

  if (tab === 'support') {
    const supportData = await api('GET', 'admin-support?limit=50').catch(() => ({ tickets: [], total: 0 }));
    const openCount = (supportData.tickets || []).filter(t => t.status === 'open').length;
    state.supportCount = openCount;
    return buildSupportSection(supportData);
  }

  if (tab === 'announcements') {
    const updatesData = await api('GET', 'admin-updates').catch(() => []);
    return _adminBuildAnnouncements(updatesData);
  }

  if (tab === 'ai-models') {
    return `<div class="card" id="admin-ai-models-section">
      <div class="flex items-center justify-between mb-3">
        <div style="font-weight:700;font-size:1rem">🧠 ניהול מודלי AI</div>
        <button class="btn btn-sm btn-secondary" onclick="adminLoadAIModels()">🔄 רענן</button>
      </div>
      <div id="admin-ai-models-content">
        <div style="color:#94a3b8;text-align:center;padding:1.5rem"><div class="spinner" style="width:20px;height:20px;margin:0 auto .5rem"></div>טוען...</div>
      </div>
    </div>`;
  }

  return '<div class="card"><p class="text-muted">טאב לא ידוע</p></div>';
}

// ── Overview Tab ──────────────────────────────────────────────────────────────
function _adminBuildOverview(ov, fmt, pct, currILS) {
  const health  = ov?.systemHealth || {};
  const failedJ = health.failedJobs24h || 0;
  const failedP = ov?.failedPayments24h || 0;
  const hasAlert = failedJ > 0 || failedP > 0;

  return `
    ${hasAlert ? `<div class="card mb-4" style="border:2px solid #fca5a5;background:#fff5f5;padding:1rem">
      <div style="font-weight:700;color:#b91c1c;margin-bottom:.5rem">⚠️ התראות פעילות</div>
      <div style="display:flex;gap:1rem;flex-wrap:wrap;font-size:.875rem">
        ${failedP > 0 ? `<span style="color:#b91c1c">💳 ${failedP} תשלומים כושלים (24ש')</span>` : ''}
        ${failedJ > 0 ? `<span style="color:#b91c1c">⚙️ ${failedJ} תהליכים כושלים (24ש')</span>` : ''}
      </div>
    </div>` : ''}

    <div class="stats-grid" style="margin-bottom:1.5rem">
      <div class="stat-card"><div class="stat-label">MRR</div><div class="stat-value">${currILS(ov?.mrr)}</div></div>
      <div class="stat-card"><div class="stat-label">סה"כ משתמשים</div><div class="stat-value">${fmt(ov?.totalUsers)}</div></div>
      <div class="stat-card"><div class="stat-label">מנויים פעילים</div><div class="stat-value">${fmt(ov?.activeSubscriptions)}</div></div>
      <div class="stat-card"><div class="stat-label">בניסיון (Trial)</div><div class="stat-value">${fmt(ov?.trialSubscriptions)}</div></div>
      <div class="stat-card"><div class="stat-label">הרשמות 24ש'</div><div class="stat-value">${fmt(ov?.newSignups24h)}</div></div>
      <div class="stat-card"><div class="stat-label">Churn Rate</div><div class="stat-value">${pct(ov?.churnRate)}</div></div>
      <div class="stat-card"><div class="stat-label">המרה לתשלום</div><div class="stat-value">${pct(ov?.conversionRate)}</div></div>
      <div class="stat-card" style="${failedP > 0 ? 'border-color:#fca5a5;background:#fff5f5' : ''}">
        <div class="stat-label">תשלומים כושלים 24ש'</div>
        <div class="stat-value" style="${failedP > 0 ? 'color:#ef4444' : ''}">${fmt(failedP)}</div>
      </div>
    </div>

    <div class="card mb-4">
      <div style="font-weight:700;margin-bottom:1rem">⚙️ בריאות מערכת</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1rem">
        <div style="text-align:center;padding:.75rem;background:#f8fafc;border-radius:.5rem">
          <div style="font-size:1.5rem;font-weight:700">${fmt(health.pendingJobs)}</div>
          <div style="font-size:.75rem;color:#64748b">ממתינים</div>
        </div>
        <div style="text-align:center;padding:.75rem;background:#f8fafc;border-radius:.5rem">
          <div style="font-size:1.5rem;font-weight:700;color:#2563eb">${fmt(health.runningJobs)}</div>
          <div style="font-size:.75rem;color:#64748b">פועלים</div>
        </div>
        <div style="text-align:center;padding:.75rem;background:${failedJ > 0 ? '#fff5f5' : '#f8fafc'};border-radius:.5rem">
          <div style="font-size:1.5rem;font-weight:700;color:${failedJ > 0 ? '#ef4444' : '#111'}">${fmt(failedJ)}</div>
          <div style="font-size:.75rem;color:#64748b">כשלו 24ש'</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div style="font-weight:700;margin-bottom:1rem">⚡ פעולות מהירות</div>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap">
        <button class="btn btn-secondary" style="width:auto" onclick="switchAdminTab('users')">👤 חפש משתמש</button>
        <button class="btn btn-secondary" style="width:auto" onclick="switchAdminTab('system')">⚙️ צפה בתהליכים</button>
        <button class="btn btn-secondary" style="width:auto" onclick="switchAdminTab('billing')">💳 מצב חיוב</button>
        <button class="btn btn-secondary" style="width:auto" onclick="switchAdminTab('audit')">📋 לוג פעולות</button>
        ${failedJ > 0 ? `<button class="btn btn-primary" style="width:auto" onclick="adminJobsFilter='failed';switchAdminTab('system')">🔁 Retry Jobs כושלים</button>` : ''}
      </div>
    </div>`;
}

// ── Users Tab ─────────────────────────────────────────────────────────────────
function _adminBuildUsers(usersData, pBadge) {
  const users  = usersData?.users || [];
  const total  = usersData?.total || 0;
  const plans  = ['all','free','early_bird','starter','pro','agency'];

  function buildRow(u) {
    const planOpts = ['free','early_bird','starter','pro','agency'].map(p =>
      `<option value="${p}"${u.plan===p?' selected':''}>${p}</option>`).join('');
    const lastActive = u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleDateString('he-IL') : '—';
    const joined     = u.createdAt    ? new Date(u.createdAt).toLocaleDateString('he-IL')    : '—';
    return `<tr style="border-bottom:1px solid #f1f5f9;cursor:pointer" onclick="adminLoadUserDetail('${u.id}')">
      <td style="padding:.45rem .6rem">
        <div style="font-size:.85rem">${u.email}${u.isAdmin ? ' <span class="badge badge-blue" style="font-size:.6rem">admin</span>' : ''}</div>
        <div style="font-size:.72rem;color:#94a3b8">${u.name || ''}</div>
      </td>
      <td style="padding:.45rem .6rem"><span class="badge ${pBadge[u.plan]||'badge-gray'}" style="font-size:.72rem">${getPlanLabel(u.plan)}</span></td>
      <td style="padding:.45rem .6rem;font-size:.8rem">${u.campaignCount||0}</td>
      <td style="padding:.45rem .6rem;font-size:.78rem;color:#64748b">${lastActive}</td>
      <td style="padding:.45rem .6rem;font-size:.78rem;color:#64748b">${joined}</td>
      <td style="padding:.45rem .6rem" onclick="event.stopPropagation()">
        <div style="display:flex;gap:.25rem;align-items:center">
          <select id="ipl-${u.id}" style="padding:.15rem .3rem;border:1px solid #d1d5db;border-radius:.35rem;font-size:.72rem;max-width:85px">${planOpts}</select>
          <button class="btn btn-sm btn-primary" onclick="adminChangePlanInline('${u.id}')" style="padding:.2rem .4rem;font-size:.7rem">שנה</button>
          ${u.paymentStatus === 'pending' ? `<button class="btn btn-sm" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:.2rem .4rem;font-size:.7rem" onclick="activateUserPayment('${u.id}','${u.plan}')">הפעל</button>` : ''}
        </div>
      </td>
    </tr>`;
  }

  return `
    <div class="card mb-4">
      <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem">
        <input id="admin-users-search" class="form-input" placeholder="חפש לפי אימייל..."
          value="${adminUsersSearch}"
          style="flex:1;min-width:180px;padding:.4rem .75rem;font-size:.875rem"
          onkeydown="if(event.key==='Enter'){adminUsersSearch=this.value;adminUsersPage=1;renderAdmin()}" />
        <button class="btn btn-primary" style="width:auto" onclick="adminUsersSearch=document.getElementById('admin-users-search').value;adminUsersPage=1;renderAdmin()">חפש</button>
        <select onchange="adminUserFilter=this.value;adminUsersPage=1;renderAdmin()" style="padding:.4rem .6rem;border:1.5px solid #d1d5db;border-radius:.5rem;font-size:.8rem;background:#fff">
          ${plans.map(p => `<option value="${p}"${adminUserFilter===p?' selected':''}>${p==='all'?'כל התוכניות':p}</option>`).join('')}
        </select>
        <button class="btn btn-secondary" style="width:auto;font-size:.8rem" onclick="adminExportUsersCSV()">📥 ייצוא CSV</button>
      </div>
      <div style="font-size:.78rem;color:#94a3b8;margin-bottom:.75rem">סה"כ ${total} משתמשים</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.83rem">
          <thead><tr style="border-bottom:1px solid #e2e8f0;color:#64748b">
            <th style="text-align:right;padding:.4rem .6rem;font-weight:500">אימייל / שם</th>
            <th style="text-align:right;padding:.4rem .6rem;font-weight:500">תוכנית</th>
            <th style="text-align:right;padding:.4rem .6rem;font-weight:500">קמפיינים</th>
            <th style="text-align:right;padding:.4rem .6rem;font-weight:500">פעיל אחרון</th>
            <th style="text-align:right;padding:.4rem .6rem;font-weight:500">הצטרף</th>
            <th style="text-align:right;padding:.4rem .6rem;font-weight:500">תוכנית</th>
          </tr></thead>
          <tbody>${users.length ? users.map(buildRow).join('') : '<tr><td colspan="6" style="padding:1rem;color:#94a3b8;text-align:center">אין תוצאות</td></tr>'}</tbody>
        </table>
      </div>
      ${total > 50 ? `<div style="display:flex;justify-content:center;gap:.5rem;margin-top:1rem">
        ${adminUsersPage > 1 ? `<button class="btn btn-sm btn-secondary" onclick="adminUsersPage--;renderAdmin()">← הקודם</button>` : ''}
        <span style="font-size:.8rem;color:#64748b;line-height:2">עמוד ${adminUsersPage}</span>
        ${users.length === 50 ? `<button class="btn btn-sm btn-secondary" onclick="adminUsersPage++;renderAdmin()">הבא →</button>` : ''}
      </div>` : ''}
    </div>
    <!-- User detail modal target -->
    <div id="admin-user-detail-modal"></div>`;
}

// ── Billing Tab ───────────────────────────────────────────────────────────────
function _adminBuildBilling(billing, fmt, curr, currILS) {
  if (!billing) return `<div class="card"><p class="text-muted">לא ניתן לטעון נתוני חיוב</p></div>`;
  const planLabel = { free:'חינמי', early_bird:'Early Bird', starter:'Starter', pro:'Pro', agency:'Agency' };
  const planColor = { free:'#94a3b8', early_bird:'#3b82f6', starter:'#3b82f6', pro:'#22c55e', agency:'#8b5cf6' };

  const revByPlan = billing.revenueByPlan || {};
  const failedPays = (billing.failedPayments || []).slice(0, 15);
  const churned    = (billing.churnedSubscriptions || []).slice(0, 10);

  return `
    <div class="stats-grid mb-4">
      <div class="stat-card"><div class="stat-label">MRR</div><div class="stat-value">${currILS(billing.mrr)}</div></div>
      <div class="stat-card"><div class="stat-label">ARR</div><div class="stat-value">${currILS(billing.arr)}</div></div>
      <div class="stat-card"><div class="stat-label">מנויים פעילים</div><div class="stat-value">${fmt(billing.activeSubscriptions)}</div></div>
      <div class="stat-card"><div class="stat-label">בניסיון</div><div class="stat-value">${fmt(billing.trialSubscriptions)}</div></div>
    </div>

    <div class="card mb-4">
      <div style="font-weight:700;margin-bottom:1rem">💰 הכנסות לפי תוכנית (30 יום)</div>
      ${Object.keys(revByPlan).length ? Object.entries(revByPlan).map(([plan, cents]) => `
        <div style="display:flex;align-items:center;gap:1rem;padding:.5rem 0;border-bottom:1px solid #f1f5f9">
          <span style="font-weight:600;color:${planColor[plan]||'#64748b'};width:90px">${planLabel[plan]||plan}</span>
          <div style="flex:1;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
            <div style="width:${Math.min(100, (cents / Math.max(...Object.values(revByPlan))) * 100)}%;height:100%;background:${planColor[plan]||'#6366f1'};border-radius:4px"></div>
          </div>
          <span style="font-size:.85rem;font-weight:700;width:70px;text-align:left">${currILS(cents)}</span>
        </div>`).join('') : '<p class="text-muted text-sm">אין נתוני הכנסה לתקופה זו</p>'}
    </div>

    ${failedPays.length ? `<div class="card mb-4" style="border-color:#fca5a5">
      <div style="font-weight:700;color:#b91c1c;margin-bottom:.75rem">⚠️ תשלומים כושלים (30 יום) — ${failedPays.length}</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr style="border-bottom:1px solid #fca5a5;color:#64748b">
          <th style="text-align:right;padding:.4rem .6rem;font-weight:500">אימייל</th>
          <th style="text-align:right;padding:.4rem .6rem;font-weight:500">סכום</th>
          <th style="text-align:right;padding:.4rem .6rem;font-weight:500">תאריך</th>
        </tr></thead>
        <tbody>${failedPays.map(p => `<tr style="border-bottom:1px solid #fff5f5">
          <td style="padding:.4rem .6rem">${p.profiles?.email || p.user_id || '—'}</td>
          <td style="padding:.4rem .6rem">${currILS(p.amount_cents)}</td>
          <td style="padding:.4rem .6rem;color:#94a3b8">${p.created_at ? new Date(p.created_at).toLocaleDateString('he-IL') : '—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>` : ''}

    ${churned.length ? `<div class="card">
      <div style="font-weight:700;margin-bottom:.75rem">👋 ביטולים (30 יום) — ${churned.length}</div>
      ${churned.map(s => `<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #f1f5f9;font-size:.83rem">
        <div>${s.profiles?.email || s.user_id || '—'}</div>
        <div style="display:flex;gap:.5rem;align-items:center">
          <span class="badge badge-gray" style="font-size:.7rem">${s.plan||'—'}</span>
          <span style="color:#94a3b8;font-size:.75rem">${s.updated_at ? new Date(s.updated_at).toLocaleDateString('he-IL') : '—'}</span>
          <button class="btn btn-sm btn-secondary" style="padding:.15rem .4rem;font-size:.7rem" onclick="adminChangePlanInlineById('${s.user_id}')">שחזר</button>
        </div>
      </div>`).join('')}
    </div>` : ''}`;
}

// ── System Tab ────────────────────────────────────────────────────────────────
function _adminBuildSystem(system, jobsData, fmt) {
  const jobs     = jobsData?.jobs || [];
  const jobTotal = jobsData?.total || 0;
  const summary  = jobsData?.summary24h || {};
  const errors   = (system?.requestMetrics?.recentErrors || []).slice(0, 20);
  const metrics  = system?.requestMetrics || {};
  const providers = system?.providerHealth || [];

  const statusColor = { queued:'#f59e0b', pending:'#f59e0b', processing:'#3b82f6', running:'#3b82f6', completed:'#22c55e', failed:'#ef4444', canceled:'#94a3b8', timed_out:'#ef4444', retrying:'#8b5cf6' };
  const statusLabel = { queued:'ממתין', pending:'ממתין', processing:'מעבד', running:'פועל', completed:'הושלם', failed:'כשל', canceled:'בוטל', timed_out:'פג זמן', retrying:'מנסה שנית' };

  const filters = ['','queued','running','failed','completed','canceled'];

  return `
    <div class="stats-grid mb-4">
      <div class="stat-card"><div class="stat-label">Jobs ממתינים</div><div class="stat-value">${fmt(summary.queued||0)}</div></div>
      <div class="stat-card"><div class="stat-label">Jobs פועלים</div><div class="stat-value" style="color:#3b82f6">${fmt(summary.running||0)}</div></div>
      <div class="stat-card" style="${(summary.failed||0) > 0 ? 'border-color:#fca5a5;background:#fff5f5' : ''}">
        <div class="stat-label">Jobs כשלו 24ש'</div>
        <div class="stat-value" style="${(summary.failed||0) > 0 ? 'color:#ef4444' : ''}">${fmt(summary.failed||0)}</div>
      </div>
      <div class="stat-card"><div class="stat-label">שגיאות 1ש'</div><div class="stat-value">${(metrics.errorRate1h * 100).toFixed(1)}%</div></div>
      <div class="stat-card"><div class="stat-label">זמן תגובה ממוצע</div><div class="stat-value">${metrics.avgDurationMs||'—'}ms</div></div>
      <div class="stat-card"><div class="stat-label">סה"כ בקשות 1ש'</div><div class="stat-value">${fmt(metrics.totalRequests1h)}</div></div>
    </div>

    <div class="card mb-4">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">
        <div style="font-weight:700">⚙️ תהליכים (Jobs)</div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          ${filters.map(f => `<button class="btn btn-sm ${adminJobsFilter===f?'btn-primary':'btn-secondary'}" style="padding:.2rem .5rem;font-size:.75rem"
            onclick="adminJobsFilter='${f}';switchAdminTab('system')">${f===''?'הכל':statusLabel[f]||f}</button>`).join('')}
        </div>
      </div>
      <div style="font-size:.75rem;color:#94a3b8;margin-bottom:.5rem">סה"כ ${jobTotal} תהליכים</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.8rem">
          <thead><tr style="border-bottom:1px solid #e2e8f0;color:#64748b">
            <th style="text-align:right;padding:.4rem .5rem;font-weight:500">משתמש</th>
            <th style="text-align:right;padding:.4rem .5rem;font-weight:500">סטטוס</th>
            <th style="text-align:right;padding:.4rem .5rem;font-weight:500">שגיאה</th>
            <th style="text-align:right;padding:.4rem .5rem;font-weight:500">משך</th>
            <th style="text-align:right;padding:.4rem .5rem;font-weight:500">נוצר</th>
            <th style="text-align:right;padding:.4rem .5rem;font-weight:500">פעולה</th>
          </tr></thead>
          <tbody>${jobs.length ? jobs.map(j => `<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:.4rem .5rem;font-size:.78rem">${j.userEmail || j.user_id?.slice(0,8) || '—'}</td>
            <td style="padding:.4rem .5rem"><span style="font-size:.7rem;padding:.15rem .4rem;border-radius:9999px;background:${statusColor[j.status]||'#94a3b8'}20;color:${statusColor[j.status]||'#94a3b8'};font-weight:600">${statusLabel[j.status]||j.status}</span></td>
            <td style="padding:.4rem .5rem;font-size:.72rem;color:#ef4444;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(j.error_message||'').replace(/"/g,'&quot;')}">${j.error_message ? j.error_message.slice(0,40)+'…' : '—'}</td>
            <td style="padding:.4rem .5rem;font-size:.75rem;color:#64748b">${j.durationMs ? (j.durationMs/1000).toFixed(1)+'s' : '—'}</td>
            <td style="padding:.4rem .5rem;font-size:.72rem;color:#94a3b8">${j.created_at ? new Date(j.created_at).toLocaleString('he-IL',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
            <td style="padding:.4rem .5rem">
              ${['failed','canceled','timed_out'].includes(j.status) ? `<button class="btn btn-sm btn-primary" style="padding:.2rem .4rem;font-size:.7rem" onclick="adminRetryJob('${j.id}')">Retry</button>` : ''}
              ${!['completed','canceled'].includes(j.status) ? ` <button class="btn btn-sm btn-secondary" style="padding:.2rem .4rem;font-size:.7rem" onclick="adminCancelJob('${j.id}')">בטל</button>` : ''}
            </td>
          </tr>`).join('') : '<tr><td colspan="6" style="padding:1rem;color:#94a3b8;text-align:center">אין תהליכים</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    ${errors.length ? `<div class="card">
      <div style="font-weight:700;margin-bottom:.75rem;color:#b91c1c">🔴 שגיאות אחרונות (24ש')</div>
      ${errors.map(e => `<div style="border-bottom:1px solid #f1f5f9;padding:.5rem 0">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem">
          <div style="font-size:.8rem;font-weight:600;color:#374151">${e.function_name||'—'}</div>
          <div style="font-size:.72rem;color:#94a3b8;white-space:nowrap">${e.created_at ? new Date(e.created_at).toLocaleTimeString('he-IL') : ''}</div>
        </div>
        <div style="font-size:.78rem;color:#ef4444;margin-top:.15rem">${e.message||''}</div>
      </div>`).join('')}
    </div>` : ''}`;
}

// ── AI Costs Tab ──────────────────────────────────────────────────────────────
function _adminBuildAICosts(aiData, curr) {
  if (!aiData) return `<div class="card"><p class="text-muted">לא ניתן לטעון נתוני עלות AI</p></div>`;
  const summary   = aiData.costSummary || {};
  const byTask    = summary.byTask || {};
  const total30d  = summary.totalCost30d || 0;
  const calls30d  = summary.totalCalls30d || 0;

  const taskRows = Object.entries(byTask).sort((a,b) => b[1].cost - a[1].cost);
  const maxCost  = taskRows.length ? Math.max(...taskRows.map(([,v]) => v.cost)) : 1;

  return `
    <div class="stats-grid mb-4">
      <div class="stat-card"><div class="stat-label">עלות 30 יום</div><div class="stat-value">$${total30d.toFixed(4)}</div></div>
      <div class="stat-card"><div class="stat-label">קריאות 30 יום</div><div class="stat-value">${calls30d.toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">עלות ממוצע לקריאה</div><div class="stat-value">${calls30d ? '$'+(total30d/calls30d).toFixed(5) : '—'}</div></div>
    </div>

    <div class="card mb-4">
      <div style="font-weight:700;margin-bottom:1rem">💸 עלות לפי Task Type (30 יום)</div>
      ${taskRows.length ? taskRows.map(([task, v]) => `
        <div style="display:grid;grid-template-columns:120px 1fr 70px 60px;gap:.5rem;align-items:center;padding:.4rem 0;border-bottom:1px solid #f1f5f9">
          <span style="font-size:.82rem;font-weight:600;color:#374151">${task}</span>
          <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
            <div style="width:${maxCost > 0 ? (v.cost/maxCost*100).toFixed(1) : 0}%;height:100%;background:linear-gradient(to left,#8b5cf6,#6366f1);border-radius:4px"></div>
          </div>
          <span style="font-size:.78rem;text-align:right;color:#374151">$${v.cost.toFixed(4)}</span>
          <span style="font-size:.72rem;color:#94a3b8;text-align:right">${v.calls} קריאות</span>
        </div>`).join('') : '<p class="text-muted text-sm">אין נתוני עלות עדיין</p>'}
    </div>

    <div class="card">
      <div style="font-weight:700;margin-bottom:1rem">🧠 מודלים מוגדרים</div>
      ${(aiData.configs || []).map(c => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid #f1f5f9;font-size:.83rem">
          <div>
            <span style="font-weight:600">${c.task_type}</span>
            <span style="color:#64748b;font-size:.75rem;margin-right:.5rem">${c.primary_model}</span>
          </div>
          <span style="font-size:.72rem;padding:.15rem .4rem;border-radius:9999px;background:${c.enabled?'#dcfce7':'#f1f5f9'};color:${c.enabled?'#166534':'#94a3b8'}">${c.enabled?'פעיל':'כבוי'}</span>
        </div>`).join('')}
      <div style="margin-top:.75rem;text-align:left">
        <button class="btn btn-secondary" style="width:auto;font-size:.8rem" onclick="switchAdminTab('ai-models')">ניהול מלא →</button>
      </div>
    </div>`;
}

// ── Audit Tab ─────────────────────────────────────────────────────────────────
function _adminBuildAudit(audit) {
  const entries = audit?.entries || [];
  const total   = audit?.total   || 0;

  const actionColor = {
    'admin.change_plan':'#3b82f6','admin.cancel_subscription':'#ef4444',
    'admin.grant_admin':'#8b5cf6','admin.revoke_admin':'#f59e0b',
    'admin.retry_job':'#22c55e','admin.cancel_job':'#94a3b8',
    'admin.suspend_user':'#ef4444','admin.toggle_admin':'#8b5cf6',
  };

  return `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem">
        <div style="font-weight:700">📋 יומן פעולות אדמין</div>
        <div style="font-size:.78rem;color:#94a3b8">סה"כ ${total} רשומות</div>
      </div>
      ${entries.length ? `<div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.8rem">
          <thead><tr style="border-bottom:1px solid #e2e8f0;color:#64748b">
            <th style="text-align:right;padding:.4rem .6rem;font-weight:500">זמן</th>
            <th style="text-align:right;padding:.4rem .6rem;font-weight:500">פעולה</th>
            <th style="text-align:right;padding:.4rem .6rem;font-weight:500">על משתמש</th>
            <th style="text-align:right;padding:.4rem .6rem;font-weight:500">פרטים</th>
          </tr></thead>
          <tbody>${entries.map(e => `<tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:.4rem .6rem;color:#94a3b8;font-size:.72rem;white-space:nowrap">${e.created_at ? new Date(e.created_at).toLocaleString('he-IL',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
            <td style="padding:.4rem .6rem"><span style="font-size:.72rem;padding:.15rem .4rem;border-radius:9999px;background:${actionColor[e.action]||'#6366f1'}20;color:${actionColor[e.action]||'#6366f1'};font-weight:600">${e.action||'—'}</span></td>
            <td style="padding:.4rem .6rem;font-size:.78rem">${e.userEmail || e.user_id?.slice(0,8) || '—'}</td>
            <td style="padding:.4rem .6rem;font-size:.72rem;color:#64748b;max-width:200px;overflow:hidden;text-overflow:ellipsis">${e.metadata ? JSON.stringify(e.metadata).slice(0,60) : '—'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div style="display:flex;justify-content:center;gap:.5rem;margin-top:1rem">
        ${adminAuditPage > 1 ? `<button class="btn btn-sm btn-secondary" onclick="adminAuditPage--;renderAdmin()">← הקודם</button>` : ''}
        <span style="font-size:.8rem;color:#64748b;line-height:2">עמוד ${adminAuditPage}</span>
        ${entries.length === 50 ? `<button class="btn btn-sm btn-secondary" onclick="adminAuditPage++;renderAdmin()">הבא →</button>` : ''}
      </div>` : '<p class="text-muted text-sm">אין רשומות עדיין</p>'}
    </div>`;
}

// ── Announcements Tab ─────────────────────────────────────────────────────────
function _adminBuildAnnouncements(updatesData) {
  return `<div class="card">
    <div style="font-weight:700;margin-bottom:1rem">📣 הודעות מערכת</div>
    <form onsubmit="adminSaveUpdate(event)" style="display:grid;gap:.6rem;margin-bottom:1.25rem">
      <input class="form-input" id="adm-upd-title" placeholder="כותרת ההודעה *" required style="padding:.45rem .75rem;border:1.5px solid #d1d5db;border-radius:.5rem;font-size:.875rem"/>
      <textarea class="form-input" id="adm-upd-content" placeholder="תוכן ההודעה *" rows="3" required style="padding:.45rem .75rem;border:1.5px solid #d1d5db;border-radius:.5rem;font-size:.875rem;resize:vertical"></textarea>
      <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
        <select id="adm-upd-type" style="padding:.45rem .75rem;border:1.5px solid #d1d5db;border-radius:.5rem;font-size:.875rem;background:#fff">
          <option value="new">חדש</option><option value="improved">שיפור</option><option value="fixed">תיקון</option>
        </select>
        <label style="display:flex;align-items:center;gap:.35rem;font-size:.875rem;cursor:pointer">
          <input type="checkbox" id="adm-upd-published" checked> פרסם מיד
        </label>
        <button type="submit" class="btn btn-primary">פרסם הודעה</button>
      </div>
    </form>
    <div id="admin-updates-list">
      ${(updatesData || []).length === 0 ? '<p class="text-muted text-sm">אין הודעות עדיין</p>'
        : (updatesData || []).slice(0,10).map(u => `
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;padding:.6rem 0;border-bottom:1px solid #f1f5f9">
            <div style="flex:1">
              <div style="font-weight:600;font-size:.875rem">${u.title}</div>
              <div class="text-muted" style="font-size:.78rem;margin-top:.15rem">${u.content.slice(0,80)}${u.content.length>80?'…':''}</div>
              <div style="margin-top:.25rem;display:flex;gap:.4rem;flex-wrap:wrap">
                <span class="badge ${u.type==='new'?'badge-green':u.type==='improved'?'badge-blue':'badge-yellow'}">${u.type}</span>
                <span class="badge ${u.is_published?'badge-green':'badge-gray'}">${u.is_published?'פורסם':'טיוטה'}</span>
              </div>
            </div>
            <div style="display:flex;gap:.35rem;flex-shrink:0">
              <button class="btn btn-sm btn-secondary" onclick="adminTogglePublish('${u.id}',${!u.is_published})">${u.is_published?'הסתר':'פרסם'}</button>
              <button class="btn btn-sm" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5" onclick="adminDeleteUpdate('${u.id}')">מחק</button>
            </div>
          </div>`).join('')}
    </div>
  </div>`;
}

// ── Admin Action Helpers ──────────────────────────────────────────────────────

async function adminLoadUserDetail(userId) {
  const modal = document.getElementById('admin-user-detail-modal');
  if (!modal) return;
  modal.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:1rem" onclick="if(event.target===this)this.innerHTML=''">
    <div style="background:#fff;border-radius:1rem;padding:1.5rem;max-width:600px;width:100%;max-height:85vh;overflow-y:auto;position:relative">
      <div style="text-align:center;padding:2rem"><div class="spinner"></div></div>
    </div>
  </div>`;

  try {
    const d = await api('GET', `admin-user?userId=${userId}`);
    const p = d.profile || {};
    const s = d.subscription || {};
    const pBadge = { free:'badge-gray', early_bird:'badge-blue', starter:'badge-blue', pro:'badge-green', agency:'badge-green' };
    const planLabel = { free:'חינמי', early_bird:'Early Bird', starter:'Starter', pro:'Pro', agency:'Agency' };

    modal.innerHTML = `<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;display:flex;align-items:center;justify-content:center;padding:1rem" onclick="if(event.target===this)this.innerHTML=''">
      <div style="background:#fff;border-radius:1rem;padding:1.5rem;max-width:620px;width:100%;max-height:85vh;overflow-y:auto;position:relative">
        <button onclick="document.getElementById('admin-user-detail-modal').innerHTML=''"
          style="position:absolute;top:1rem;left:1rem;background:none;border:none;font-size:1.25rem;cursor:pointer;color:#94a3b8">✕</button>

        <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem">
          <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem">
            ${(p.name||p.email||'?')[0].toUpperCase()}
          </div>
          <div>
            <div style="font-weight:700;font-size:1rem">${p.name||p.email||'—'}</div>
            <div style="font-size:.83rem;color:#64748b">${p.email||'—'}</div>
            <div style="margin-top:.25rem"><span class="badge ${pBadge[s.plan]||'badge-gray'}">${planLabel[s.plan]||s.plan||'—'}</span></div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem;font-size:.83rem">
          <div style="background:#f8fafc;padding:.75rem;border-radius:.5rem"><div style="color:#94a3b8;font-size:.72rem">מנוי</div><strong>${s.status||'—'}</strong></div>
          <div style="background:#f8fafc;padding:.75rem;border-radius:.5rem"><div style="color:#94a3b8;font-size:.72rem">תשלום</div><strong>${s.payment_status||'—'}</strong></div>
          <div style="background:#f8fafc;padding:.75rem;border-radius:.5rem"><div style="color:#94a3b8;font-size:.72rem">קמפיינים</div><strong>${(d.campaigns||[]).length}</strong></div>
          <div style="background:#f8fafc;padding:.75rem;border-radius:.5rem"><div style="color:#94a3b8;font-size:.72rem">פעילות 30 יום</div><strong>${d.usageStats?.eventsLast30d||0} אירועים</strong></div>
          <div style="background:#f8fafc;padding:.75rem;border-radius:.5rem"><div style="color:#94a3b8;font-size:.72rem">הצטרף</div><strong>${p.created_at ? new Date(p.created_at).toLocaleDateString('he-IL') : '—'}</strong></div>
          <div style="background:#f8fafc;padding:.75rem;border-radius:.5rem"><div style="color:#94a3b8;font-size:.72rem">ניתוחים 30 יום</div><strong>${d.usageStats?.analysisRuns30d||0}</strong></div>
        </div>

        <div style="font-weight:700;margin-bottom:.75rem">⚡ פעולות מהירות</div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.25rem">
          <select id="modal-plan-${p.id}" style="padding:.35rem .6rem;border:1.5px solid #d1d5db;border-radius:.5rem;font-size:.82rem;background:#fff">
            ${['free','early_bird','starter','pro','agency'].map(pl => `<option value="${pl}"${(s.plan||'free')===pl?' selected':''}>${pl}</option>`).join('')}
          </select>
          <button class="btn btn-sm btn-primary" onclick="adminChangePlanModal('${p.id}')">שנה תוכנית</button>
          ${p.is_admin ? '' : `<button class="btn btn-sm btn-secondary" onclick="adminToggleAdminStatus('${p.id}',true)">הענק Admin</button>`}
          ${p.is_admin ? `<button class="btn btn-sm" style="background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;padding:.2rem .5rem;font-size:.75rem" onclick="adminToggleAdminStatus('${p.id}',false)">הסר Admin</button>` : ''}
        </div>

        ${(d.recentAuditLog||[]).length ? `<div style="font-weight:700;margin-bottom:.5rem;font-size:.85rem">📋 פעולות אחרונות</div>
          ${d.recentAuditLog.slice(0,5).map(e => `<div style="font-size:.75rem;color:#64748b;padding:.25rem 0;border-bottom:1px solid #f1f5f9">${e.action} — ${e.created_at ? new Date(e.created_at).toLocaleString('he-IL') : ''}</div>`).join('')}` : ''}
      </div>
    </div>`;
  } catch (e) {
    modal.innerHTML = '';
    toast(e.message || 'שגיאה בטעינת פרטי משתמש', 'error');
  }
}

async function adminChangePlanModal(userId) {
  const sel = document.getElementById('modal-plan-' + userId);
  if (!sel) return;
  if (!confirm(`שינוי תוכנית ל-${sel.value}?`)) return;
  try {
    await api('POST', 'admin-user', { action: 'change_plan', targetUserId: userId, plan: sel.value });
    toast(`✓ תוכנית שונתה ל-${sel.value}`, 'success');
    document.getElementById('admin-user-detail-modal').innerHTML = '';
    _adminCache = {};
    renderAdmin({ keepScroll: true });
  } catch (e) { toast(e.message, 'error'); }
}

async function adminToggleAdminStatus(userId, makeAdmin) {
  if (!confirm(makeAdmin ? `להעניק הרשאת Admin?` : `להסיר הרשאת Admin?`)) return;
  try {
    await api('POST', 'admin-user', { action: 'toggle_admin', targetUserId: userId });
    toast(`✓ הרשאות עודכנו`, 'success');
    document.getElementById('admin-user-detail-modal').innerHTML = '';
    _adminCache = {};
    renderAdmin({ keepScroll: true });
  } catch (e) { toast(e.message, 'error'); }
}

async function adminRetryJob(jobId) {
  try {
    await api('POST', 'admin-jobs', { action: 'retry', jobId });
    toast('✓ Job הוחזר לתור', 'success');
    _adminCache = {};
    renderAdmin({ keepScroll: true });
  } catch (e) { toast(e.message, 'error'); }
}

async function adminCancelJob(jobId) {
  if (!confirm('לבטל את התהליך?')) return;
  try {
    await api('POST', 'admin-jobs', { action: 'cancel', jobId });
    toast('✓ Job בוטל', 'success');
    _adminCache = {};
    renderAdmin({ keepScroll: true });
  } catch (e) { toast(e.message, 'error'); }
}

async function adminChangePlanInlineById(userId) {
  const newPlan = prompt('תוכנית חדשה (free/early_bird/starter/pro/agency):');
  if (!newPlan) return;
  try {
    await api('POST', 'admin-user', { action: 'change_plan', targetUserId: userId, plan: newPlan });
    toast(`✓ תוכנית שונתה ל-${newPlan}`, 'success');
    _adminCache = {};
    renderAdmin({ keepScroll: true });
  } catch (e) { toast(e.message, 'error'); }
}

function adminExportUsersCSV() {
  const content = document.querySelector('#admin-tab-content table');
  if (!content) { toast('אין נתונים לייצוא', 'error'); return; }
  const rows = Array.from(content.querySelectorAll('tr')).map(tr =>
    Array.from(tr.querySelectorAll('th,td')).map(td => '"' + td.innerText.replace(/"/g,'""').trim() + '"').join(',')
  );
  const csv  = rows.join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `users-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('✓ CSV יורד', 'success');
}

// ── Admin AI Models ───────────────────────────────────────────────────────────
var _adminAIData = null;

async function adminLoadAIModels() {
  const el = document.getElementById('admin-ai-models-content');
  if (!el) return;

  try {
    const data = await api('GET', 'admin-ai-models');
    _adminAIData = data;
    el.innerHTML = _renderAIModelsPanel(data);
  } catch (e) {
    el.innerHTML = `<div style="color:#ef4444;font-size:0.875rem">שגיאה בטעינת הגדרות: ${e.message}</div>`;
  }
}

function _renderAIModelsPanel(data) {
  if (!data?.configs) return '<div style="color:#94a3b8">אין נתונים</div>';

  const { configs, availableModels, costSummary } = data;
  const modelOptions = (availableModels || []).map(m =>
    `<option value="${m.id}">${m.label} (${m.provider})</option>`
  ).join('');

  const taskLabels = {
    chat: 'שיחה עם AI', quick: 'תגובה מהירה', creative: 'יצירת תוכן',
    research: 'מחקר שוק', strategy: 'אסטרטגיה', execution: 'ביצוע',
    qa: 'בקרת איכות', analysis: 'ניתוח נתונים', router: 'סוכן ממיין',
  };

  const costRows = configs.map(c => {
    const taskCost  = costSummary?.byTask?.[c.task_type];
    const costStr   = taskCost ? `$${taskCost.cost.toFixed(4)}` : '—';
    const callsStr  = taskCost ? taskCost.calls : '—';
    const via       = c.use_openrouter ? '🌐 OpenRouter' : '🔗 Direct API';
    const badgeColor = c.use_openrouter ? '#6366f1' : '#0ea5e9';

    return `
    <tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:0.75rem;font-weight:600;white-space:nowrap">${taskLabels[c.task_type] || c.task_type}</td>
      <td style="padding:0.75rem">
        <select onchange="adminUpdateModel('${c.task_type}','primary_model',this.value)"
          style="width:100%;padding:0.35rem;border:1px solid #e2e8f0;border-radius:6px;font-size:0.8rem;background:#fff">
          ${(availableModels || []).map(m =>
            `<option value="${m.id}" ${m.id === c.primary_model ? 'selected' : ''}>${m.label}</option>`
          ).join('')}
        </select>
      </td>
      <td style="padding:0.75rem">
        <select onchange="adminUpdateModel('${c.task_type}','fallback_model',this.value)"
          style="width:100%;padding:0.35rem;border:1px solid #e2e8f0;border-radius:6px;font-size:0.8rem;background:#fff">
          <option value="">ללא fallback</option>
          ${(availableModels || []).map(m =>
            `<option value="${m.id}" ${m.id === c.fallback_model ? 'selected' : ''}>${m.label}</option>`
          ).join('')}
        </select>
      </td>
      <td style="padding:0.75rem;text-align:center">
        <span style="font-size:0.72rem;padding:2px 8px;border-radius:99px;background:${badgeColor}20;color:${badgeColor};white-space:nowrap">${via}</span>
        <br>
        <label style="display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;margin-top:4px;cursor:pointer">
          <input type="checkbox" ${c.use_openrouter ? 'checked' : ''}
            onchange="adminUpdateModel('${c.task_type}','use_openrouter',this.checked)">
          <span>OpenRouter</span>
        </label>
      </td>
      <td style="padding:0.75rem;text-align:center">
        <input type="number" value="${c.temperature}" min="0" max="2" step="0.1"
          style="width:60px;padding:0.3rem;border:1px solid #e2e8f0;border-radius:6px;font-size:0.8rem;text-align:center"
          onchange="adminUpdateModel('${c.task_type}','temperature',parseFloat(this.value))">
      </td>
      <td style="padding:0.75rem;text-align:center">
        <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer">
          <input type="checkbox" ${c.enabled ? 'checked' : ''}
            onchange="adminUpdateModel('${c.task_type}','enabled',this.checked)">
        </label>
      </td>
      <td style="padding:0.75rem;text-align:center;font-size:0.8rem;color:#64748b">${costStr}<br><span style="font-size:0.7rem">${callsStr} קריאות</span></td>
      <td style="padding:0.75rem;text-align:center">
        <button onclick="adminTestModel('${c.task_type}','${c.primary_model}')"
          style="padding:0.3rem 0.6rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:0.72rem;cursor:pointer">
          בדוק
        </button>
      </td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-bottom:1rem;padding:0.875rem;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;display:flex;align-items:center;justify-between;gap:1rem;flex-wrap:wrap">
      <div>
        <span style="font-weight:700;color:#16a34a">💰 עלות חודשית: $${(costSummary?.totalCost30d || 0).toFixed(3)}</span>
        <span style="color:#64748b;font-size:0.8rem;margin-right:1rem">${costSummary?.totalCalls30d || 0} קריאות ב-30 יום האחרונים</span>
      </div>
      <div style="font-size:0.75rem;color:#64748b">
        שינויים נכנסים לתוקף מיידית — אין צורך ב-deploy
      </div>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem">
        <thead>
          <tr style="background:#f8fafc;text-align:right">
            <th style="padding:0.6rem 0.75rem;color:#64748b;font-weight:600">משימה</th>
            <th style="padding:0.6rem 0.75rem;color:#64748b;font-weight:600">מודל ראשי</th>
            <th style="padding:0.6rem 0.75rem;color:#64748b;font-weight:600">Fallback</th>
            <th style="padding:0.6rem 0.75rem;color:#64748b;font-weight:600;text-align:center">ערוץ</th>
            <th style="padding:0.6rem 0.75rem;color:#64748b;font-weight:600;text-align:center">Temp</th>
            <th style="padding:0.6rem 0.75rem;color:#64748b;font-weight:600;text-align:center">פעיל</th>
            <th style="padding:0.6rem 0.75rem;color:#64748b;font-weight:600;text-align:center">עלות 30י'</th>
            <th style="padding:0.6rem 0.75rem;color:#64748b;font-weight:600;text-align:center">בדיקה</th>
          </tr>
        </thead>
        <tbody>${costRows}</tbody>
      </table>
    </div>
    <div id="admin-model-test-result" style="margin-top:1rem;display:none"></div>`;
}

async function adminUpdateModel(taskType, field, value) {
  try {
    await api('PUT', 'admin-ai-models', { task_type: taskType, [field]: value });
    showToast(`✓ ${taskType} עודכן`);
  } catch (e) { showToast('שגיאה: ' + e.message); }
}

async function adminTestModel(taskType, model) {
  const resultEl = document.getElementById('admin-model-test-result');
  if (!resultEl) return;
  resultEl.style.display = '';
  resultEl.innerHTML = `<div style="padding:0.75rem;background:#f8fafc;border-radius:8px;color:#64748b;font-size:0.875rem">
    <div class="spinner" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-left:0.5rem"></div>
    בודק מודל ${model}...
  </div>`;

  try {
    const res = await api('POST', 'admin-ai-models/test', { model, prompt: 'אמור שלום בעברית במשפט אחד.' });
    const ok  = res?.ok;
    resultEl.innerHTML = `
      <div style="padding:0.875rem;background:${ok?'#f0fdf4':'#fef2f2'};border:1px solid ${ok?'#bbf7d0':'#fecaca'};border-radius:8px">
        <div style="font-weight:600;color:${ok?'#16a34a':'#dc2626'};margin-bottom:0.35rem">
          ${ok ? '✓ המודל עובד' : '✗ המודל נכשל'}
          <span style="font-weight:400;font-size:0.8rem;color:#64748b;margin-right:0.5rem">
            ${res?.latency_ms || 0}ms | $${(res?.cost_usd || 0).toFixed(5)} | via ${res?.via || '?'}
          </span>
        </div>
        ${res?.reply ? `<div style="font-size:0.875rem;color:#1e293b">"${res.reply}"</div>` : ''}
        ${res?.error ? `<div style="font-size:0.8rem;color:#dc2626">${res.error}</div>` : ''}
      </div>`;
  } catch (e) {
    resultEl.innerHTML = `<div style="padding:0.75rem;background:#fef2f2;border-radius:8px;color:#dc2626;font-size:0.875rem">שגיאה: ${e.message}</div>`;
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

      // New user flow: no onboarding done → forced wizard
      const isNewUser = !bpRes && !cached && initialPage === 'dashboard';
      const wizardDone = (onboardingRes?.steps || {}).onboarding_wizard_done;
      const forceWizard = isNewUser && !wizardDone;

      // Re-render only if we didn't show cached version (first-ever load)
      if (!cached || cached.userId !== session.user.id) {
        if (!forceWizard && state.currentPage === 'dashboard' && initialPage !== 'dashboard') {
          state.currentPage = initialPage;
        }
        render();
        if (forceWizard) setTimeout(() => showOnboardingWizard(), 300);
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


// ══════════════════════════════════════════════════════════════════════════════
// 🧠 BUSINESS FROM SCRATCH — Agent System
// ══════════════════════════════════════════════════════════════════════════════

var bfsAgentTab = 'research'; // active agent tab
var bfsResearchJob   = null;  // { jobId, status, steps, lastStepIndex, pollTimer, reportId }
var bfsStrategyJob   = null;  // { jobId, status, steps, lastStepIndex, pollTimer, reportId }
var bfsExecutionJob  = null;  // { jobId, status, steps, lastStepIndex, pollTimer, reportId }
var bfsAnalysisJob       = null;  // { jobId, status, steps, lastStepIndex, pollTimer, reportId }
var bfsOrchestrationJob  = null;  // { jobId, status, pollTimer, result }

function renderBusinessFromScratch() {
  const agents = [
    { id: 'research',      icon: '🔍', label: 'סוכן מחקר',       status: 'active', desc: 'מחקר שוק, מתחרים ואווטר קהל יעד' },
    { id: 'strategy',      icon: '🎯', label: 'סוכן אסטרטגיה',   status: 'active', desc: 'קובע כיוון, קהל, זווית והצעה' },
    { id: 'execution',     icon: '🧱', label: 'סוכן ביצוע',      status: 'active', desc: 'מייצר מודעות, דפי נחיתה וטקסטים' },
    { id: 'qa',            icon: '🧪', label: 'סוכן QA',          status: 'active', desc: 'בודק ומדרג את התוצרים' },
    { id: 'analysis',      icon: '📊', label: 'סוכן ניתוח',      status: 'active', desc: 'מנתח דאטה אמיתי מהקמפיינים' },
    { id: 'orchestration', icon: '🎭', label: 'שכבת אורקסטרציה', status: 'active', desc: 'ניהול סשן מרובה-סוכנים עם ניהול מצב ואישורים' },
  ];

  const bp = state.businessProfile || {};

  const agentCards = agents.map(a => `
    <div onclick="${a.status === 'active' ? `bfsAgentTab='${a.id}';renderBusinessFromScratch()` : ''}"
         style="background:${bfsAgentTab === a.id ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : a.status === 'soon' ? '#f8fafc' : '#fff'};
                border:2px solid ${bfsAgentTab === a.id ? '#6366f1' : a.status === 'soon' ? '#e2e8f0' : '#e2e8f0'};
                border-radius:1rem;padding:1.25rem 1rem;cursor:${a.status === 'active' ? 'pointer' : 'default'};
                opacity:${a.status === 'soon' ? '0.65' : '1'};transition:all 0.2s;text-align:center;position:relative">
      <div style="font-size:1.8rem;margin-bottom:0.4rem">${a.icon}</div>
      <div style="font-weight:700;font-size:0.88rem;color:${bfsAgentTab === a.id ? '#fff' : '#1e293b'}">${a.label}</div>
      <div style="font-size:0.72rem;color:${bfsAgentTab === a.id ? 'rgba(255,255,255,0.8)' : '#64748b'};margin-top:0.25rem">${a.desc}</div>
      ${a.status === 'soon' ? `<div style="position:absolute;top:0.5rem;left:0.5rem;background:#e2e8f0;color:#64748b;font-size:0.6rem;font-weight:700;padding:2px 6px;border-radius:9999px">בקרוב</div>` : ''}
      ${a.status === 'active' && bfsAgentTab !== a.id ? `<div style="position:absolute;top:0.5rem;left:0.5rem;background:#dcfce7;color:#16a34a;font-size:0.6rem;font-weight:700;padding:2px 6px;border-radius:9999px">פעיל</div>` : ''}
    </div>`).join('');

  const researchPanel = `
    <div class="card" style="margin-top:1.5rem">
      <div class="card-title">🔍 סוכן מחקר — מודיעין שוק</div>
      <p class="text-sm text-muted mb-4">הסוכן יחקור את השוק, יזהה מתחרים, יבין את קהל היעד ויחזיר לך דוח מוכן לפעולה</p>

      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">נישה / תחום עסקי <span style="color:#ef4444">*</span></label>
          <input class="form-input" id="bfs-niche" placeholder="לדוגמה: קורסים דיגיטליים, קוסמטיקה, שירותי SEO"
            value="${(bp.industry || '').replace(/"/g,'&quot;')}" />
        </div>
        <div class="form-group">
          <label class="form-label">רמת מחקר</label>
          <select class="form-input" id="bfs-depth">
            <option value="low">בדיקת שוק מהירה (1 קרדיט, ~1 דקה)</option>
            <option value="medium" selected>מחקר שוק אסטרטגי (3 קרדיטים, ~3 דקות)</option>
            <option value="high">מודיעין שוק עמוק (6 קרדיטים, ~7 דקות)</option>
          </select>
        </div>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label">שם העסק</label>
          <input class="form-input" id="bfs-biz-name" placeholder="שם העסק שלך"
            value="${(bp.business_name || '').replace(/"/g,'&quot;')}" />
        </div>
        <div class="form-group">
          <label class="form-label">קהל יעד</label>
          <input class="form-input" id="bfs-audience" placeholder="לדוגמה: נשים 25-45, בעלי עסקים קטנים"
            value="${(bp.target_audience || '').replace(/"/g,'&quot;')}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">המוצר / שירות המרכזי</label>
        <input class="form-input" id="bfs-offer" placeholder="מה אתם מוכרים?"
          value="${(bp.offer || '').replace(/"/g,'&quot;')}" />
      </div>

      <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-top:1rem">
        <button class="btn btn-gradient" style="width:auto;padding:0.75rem 2rem" id="bfs-start-btn" onclick="startResearch()">
          🔍 התחל מחקר שוק
        </button>
        <div style="font-size:0.78rem;color:#64748b;flex:1">
          ⚡ הסוכן יכתוב לך בדיוק מה הוא עושה בזמן אמת
        </div>
      </div>
    </div>

    <div id="bfs-progress-area" style="display:none;margin-top:1.5rem">
      <div class="card" style="padding:0">
        <div style="background:linear-gradient(135deg,#1e293b,#334155);border-radius:1rem 1rem 0 0;padding:1rem 1.25rem;display:flex;align-items:center;gap:0.75rem">
          <div id="bfs-status-dot" style="width:10px;height:10px;border-radius:50%;background:#fbbf24;animation:pulse 1.5s infinite"></div>
          <div style="color:#fff;font-weight:600;font-size:0.9rem" id="bfs-status-label">מחכה להתחלה...</div>
          <div style="margin-right:auto;display:flex;align-items:center;gap:0.5rem">
            <div style="width:120px;height:6px;background:rgba(255,255,255,0.15);border-radius:9999px;overflow:hidden">
              <div id="bfs-progress-bar" style="height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:9999px;transition:width 0.5s;width:0%"></div>
            </div>
            <span id="bfs-progress-pct" style="color:rgba(255,255,255,0.7);font-size:0.75rem">0%</span>
          </div>
        </div>
        <div id="bfs-steps-log" style="background:#0f172a;border-radius:0 0 1rem 1rem;padding:1rem 1.25rem;min-height:200px;max-height:420px;overflow-y:auto;font-family:'Courier New',monospace;font-size:0.8rem;direction:rtl"></div>
      </div>
    </div>

    <div id="bfs-report-area" style="display:none;margin-top:1.5rem"></div>`;

  // ── Strategy Panel ─────────────────────────────────────────────────────────
  const savedResearchReportId = bfsResearchJob?.reportId || (() => {
    try { return JSON.parse(localStorage.getItem('lastResearchJob') || '{}').reportId || ''; } catch { return ''; }
  })();

  const strategyPanel = `
    <div class="card" style="margin-top:1.5rem">
      <div class="card-title">🎯 סוכן אסטרטגיה — בניית אסטרטגיה שיווקית</div>
      <p class="text-sm text-muted mb-4">הסוכן בונה מוצר, בידול, מסר ליבה, משפך שיווקי ותכנית בדיקות — הכל על בסיס דוח המחקר שלך</p>

      <div class="form-group">
        <label class="form-label">מזהה דוח מחקר <span style="color:#ef4444">*</span></label>
        <input class="form-input" id="strategy-report-id" placeholder="הכנס את מזהה דוח המחקר (UUID)"
          value="${savedResearchReportId.replace(/"/g,'&quot;')}" />
        <div style="font-size:0.75rem;color:#64748b;margin-top:0.3rem">
          ${savedResearchReportId ? '✅ נמצא דוח מחקר אחרון — ניתן להתחיל' : '⚠️ הכנס מזהה דוח מחקר מהכרטיס "דוח מוכן" בלשונית מחקר'}
        </div>
      </div>

      <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-top:1rem">
        <button class="btn btn-gradient" style="width:auto;padding:0.75rem 2rem;background:linear-gradient(135deg,#f59e0b,#ef4444)"
          id="strategy-start-btn" onclick="startStrategy()">
          🎯 התחל בניית אסטרטגיה
        </button>
        <div style="font-size:0.78rem;color:#64748b;flex:1">
          ⚡ ~6 קריאות AI | ~2 דקות | 20 מודולים של ניתוח אסטרטגי
        </div>
      </div>
    </div>

    <div id="strategy-progress-area" style="display:none;margin-top:1.5rem">
      <div class="card" style="padding:0">
        <div style="background:linear-gradient(135deg,#78350f,#92400e);border-radius:1rem 1rem 0 0;padding:1rem 1.25rem;display:flex;align-items:center;gap:0.75rem">
          <div id="strategy-status-dot" style="width:10px;height:10px;border-radius:50%;background:#fbbf24;animation:pulse 1.5s infinite"></div>
          <div style="color:#fff;font-weight:600;font-size:0.9rem" id="strategy-status-label">מכין אסטרטגיה...</div>
          <div style="margin-right:auto;display:flex;align-items:center;gap:0.5rem">
            <div style="width:120px;height:6px;background:rgba(255,255,255,0.15);border-radius:9999px;overflow:hidden">
              <div id="strategy-progress-bar" style="height:100%;background:linear-gradient(90deg,#f59e0b,#ef4444);border-radius:9999px;transition:width 0.5s;width:0%"></div>
            </div>
            <span id="strategy-progress-pct" style="color:rgba(255,255,255,0.7);font-size:0.75rem">0%</span>
          </div>
        </div>
        <div id="strategy-steps-log" style="background:#1c0a00;border-radius:0 0 1rem 1rem;padding:1rem 1.25rem;min-height:200px;max-height:420px;overflow-y:auto;font-family:'Courier New',monospace;font-size:0.8rem;direction:rtl"></div>
      </div>
    </div>

    <div id="strategy-report-area" style="display:none;margin-top:1.5rem"></div>`;

  // ── Execution Panel ────────────────────────────────────────────────────────
  const savedStrategyReportId = bfsStrategyJob?.reportId || (() => {
    try { return JSON.parse(localStorage.getItem('lastStrategyJob') || '{}').reportId || ''; } catch { return ''; }
  })();

  const executionPanel = `
    <div class="card" style="margin-top:1.5rem">
      <div class="card-title">🧱 סוכן ביצוע — יצירת נכסי שיווק</div>
      <p class="text-sm text-muted mb-4">הסוכן מייצר מודעות, דפי נחיתה, hooks, סקריפטים ואימיילים בהתאם לאסטרטגיה שנבנתה</p>

      <div class="form-group">
        <label class="form-label">מזהה דוח אסטרטגיה <span style="color:#ef4444">*</span></label>
        <input class="form-input" id="exec-strategy-report-id" placeholder="הכנס את מזהה דוח האסטרטגיה (UUID)"
          value="${savedStrategyReportId.replace(/"/g,'&quot;')}" />
        <div style="font-size:0.75rem;color:#64748b;margin-top:0.3rem">
          ${savedStrategyReportId ? '✅ נמצא דוח אסטרטגיה אחרון — ניתן להתחיל' : '⚠️ הכנס מזהה דוח אסטרטגיה מלשונית אסטרטגיה'}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem">
        <div class="form-group">
          <label class="form-label">פלטפורמה</label>
          <select class="form-input" id="exec-platform">
            <option value="meta">Meta / Facebook</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="google">Google Ads</option>
            <option value="youtube">YouTube</option>
            <option value="linkedin">LinkedIn</option>
            <option value="email">Email</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">מצב ביצוע</label>
          <select class="form-input" id="exec-mode">
            <option value="draft">טיוטה (וריאנט 1 — מהיר)</option>
            <option value="smart" selected>חכם (3 וריאנטים + ציון)</option>
            <option value="premium">פרימיום (5 וריאנטים + מלא)</option>
          </select>
        </div>
      </div>

      <div class="form-group" style="margin-top:0.5rem">
        <label class="form-label">נכסים ליצירה</label>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.4rem">
          ${[['ads','מודעות'],['hooks','Hooks'],['cta','CTA'],['landing_page','דף נחיתה'],['scripts','סקריפט וידאו'],['email','אימייל']].map(([val,lbl]) => `
            <label style="display:flex;align-items:center;gap:0.4rem;background:#f1f5f9;border:1.5px solid #e2e8f0;border-radius:0.6rem;padding:0.4rem 0.75rem;cursor:pointer;font-size:0.82rem">
              <input type="checkbox" id="exec-asset-${val}" value="${val}" ${['ads','hooks','cta'].includes(val) ? 'checked' : ''} style="accent-color:#6366f1">
              ${lbl}
            </label>`).join('')}
        </div>
      </div>

      <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-top:1rem">
        <button class="btn btn-gradient" style="width:auto;padding:0.75rem 2rem;background:linear-gradient(135deg,#059669,#0ea5e9)"
          id="exec-start-btn" onclick="startExecution()">
          🧱 צור נכסי שיווק
        </button>
        <div style="font-size:0.78rem;color:#64748b;flex:1">
          ⚡ ~8-18 קריאות AI | ~2-3 דקות | 18 שלבי ביצוע
        </div>
      </div>
    </div>

    <div id="exec-progress-area" style="display:none;margin-top:1.5rem">
      <div class="card" style="padding:0">
        <div style="background:linear-gradient(135deg,#064e3b,#065f46);border-radius:1rem 1rem 0 0;padding:1rem 1.25rem;display:flex;align-items:center;gap:0.75rem">
          <div id="exec-status-dot" style="width:10px;height:10px;border-radius:50%;background:#34d399;animation:pulse 1.5s infinite"></div>
          <div style="color:#fff;font-weight:600;font-size:0.9rem" id="exec-status-label">מייצר נכסים...</div>
          <div style="margin-right:auto;display:flex;align-items:center;gap:0.5rem">
            <div style="width:120px;height:6px;background:rgba(255,255,255,0.15);border-radius:9999px;overflow:hidden">
              <div id="exec-progress-bar" style="height:100%;background:linear-gradient(90deg,#34d399,#0ea5e9);border-radius:9999px;transition:width 0.5s;width:0%"></div>
            </div>
            <span id="exec-progress-pct" style="color:rgba(255,255,255,0.7);font-size:0.75rem">0%</span>
          </div>
        </div>
        <div id="exec-steps-log" style="background:#022c22;border-radius:0 0 1rem 1rem;padding:1rem 1.25rem;min-height:200px;max-height:420px;overflow-y:auto;font-family:'Courier New',monospace;font-size:0.8rem;direction:rtl"></div>
      </div>
    </div>

    <div id="exec-report-area" style="display:none;margin-top:1.5rem"></div>`;

  const qaPanel = `
    <div class="card" style="margin-top:1.5rem">
      <div class="card-title">🧪 סוכן QA — בקרת איכות נכסים</div>
      <p class="text-sm text-muted mb-4">בודק את כל הנכסים שנוצרו: הוקים, מודעות, דף נחיתה, CTA. 12 קטגוריות בדיקה + סימולציה + תוכנית A/B</p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:0.75rem;padding:0.85rem;margin-bottom:1rem;font-size:0.82rem;color:#374151">
        <div style="font-weight:600;margin-bottom:0.3rem">מה QA בודק:</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.2rem">
          ${['🎣 עוצמת הוק','💢 עומק כאב','🎯 בידול','💎 הצעת ערך','🧲 שכנוע','🗣️ שפה ואנושיות','🧠 עומס קוגניטיבי','🔐 אמון','📊 התאמת מודעות','📡 Tracking','🔁 Flow מלא','💀 Kill Signals'].map(item => `<div>• ${item}</div>`).join('')}
        </div>
      </div>

      <button class="btn btn-gradient w-full" onclick="startQa()" style="background:linear-gradient(135deg,#7c3aed,#db2777)">🧪 הרץ QA Agent על הנכסים</button>

      <div id="qa-panel-area" style="display:none;margin-top:1.5rem">
        <div style="background:#0f0f1a;border-radius:1rem 1rem 0 0;padding:1rem 1.25rem;display:flex;justify-content:space-between;align-items:center">
          <span id="qa-status-label" style="color:#a78bfa;font-weight:600;font-size:0.88rem">בודק נכסים...</span>
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div style="width:120px;height:6px;background:rgba(255,255,255,0.1);border-radius:9999px;overflow:hidden">
              <div id="qa-progress-bar" style="height:100%;background:linear-gradient(90deg,#a78bfa,#db2777);border-radius:9999px;transition:width 0.5s;width:0%"></div>
            </div>
            <span id="qa-progress-pct" style="color:rgba(255,255,255,0.7);font-size:0.75rem">0%</span>
          </div>
        </div>
        <div id="qa-log" style="background:#0f0f1a;border-radius:0 0 1rem 1rem;padding:1rem 1.25rem;min-height:150px;max-height:300px;overflow-y:auto;font-family:'Courier New',monospace;font-size:0.8rem;direction:rtl"></div>
      </div>
    </div>
    <div id="qa-report-area" style="margin-top:1.5rem"></div>`;

  renderShell(`
    <div class="page-header">
      <h1 class="page-title">🧠 בניית עסק מאפס</h1>
      <p class="page-subtitle">מערכת סוכנים חכמה שבונה את כל אסטרטגיית השיווק שלך — מחקר, אסטרטגיה, ביצוע ובקרת איכות</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:0.75rem;margin-bottom:1rem">
      ${agentCards}
    </div>

    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem 1rem;background:#fef3c7;border:1px solid #fcd34d;border-radius:0.75rem;margin-bottom:0.5rem">
      <span style="font-size:1rem">💡</span>
      <span style="font-size:0.8rem;color:#92400e">הסוכנים עובדים בסדר — מחקר → אסטרטגיה → ביצוע → QA → ניתוח. כל 5 הסוכנים פעילים.</span>
    </div>

    ${bfsAgentTab === 'strategy' ? strategyPanel : bfsAgentTab === 'execution' ? executionPanel : bfsAgentTab === 'qa' ? qaPanel : bfsAgentTab === 'analysis' ? _buildAnalysisPanel() : bfsAgentTab === 'orchestration' ? renderOrchestrationPanel() : researchPanel}
  `);

  // Restore active job if exists
  if (bfsAgentTab === 'research') {
    setTimeout(() => restoreResearchJob(), 50);
  } else if (bfsAgentTab === 'strategy') {
    setTimeout(() => restoreStrategyJob(), 50);
  } else if (bfsAgentTab === 'execution') {
    setTimeout(() => restoreExecutionJob(), 50);
  } else if (bfsAgentTab === 'qa') {
    setTimeout(() => restoreQaJob(), 50);
  } else if (bfsAgentTab === 'analysis') {
    setTimeout(() => restoreAnalysisJob(), 50);
  } else if (bfsAgentTab === 'orchestration') {
    if (bfsOrchestrationJob) setTimeout(() => _orchStartPolling(bfsOrchestrationJob), 100);
  }
}

// ── Research Agent: Start ──────────────────────────────────────────────────────
async function startResearch() {
  const btn      = document.getElementById('bfs-start-btn');
  const niche    = document.getElementById('bfs-niche')?.value.trim();
  const depth    = document.getElementById('bfs-depth')?.value || 'medium';
  const bizName  = document.getElementById('bfs-biz-name')?.value.trim();
  const audience = document.getElementById('bfs-audience')?.value.trim();
  const offer    = document.getElementById('bfs-offer')?.value.trim();

  if (!niche) { toast('נא להזין נישה / תחום עסקי', 'error'); return; }

  // ── No sources popup ─────────────────────────────────────────────────
  const hasConnected = (state.integrations || []).some(i => i.connection_status !== 'revoked');
  if (!hasConnected) {
    const proceed = await new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" style="max-width:440px;text-align:center">
          <div style="font-size:2.5rem;margin-bottom:0.75rem">🔌</div>
          <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:0.5rem">אין מקורות מחוברים</h3>
          <p style="font-size:0.875rem;color:#64748b;margin-bottom:1.25rem;line-height:1.6">
            הסוכן יעבוד עם מאגר הידע של הבינה המלאכותית בלבד.<br>
            לתוצאות מדויקות יותר, מומלץ לחבר את חשבונות הפרסום שלך
            (Google Ads, Meta, TikTok).
          </p>
          <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-secondary" style="width:auto" onclick="this.closest('.modal-overlay').remove();navigate('settings')">
              🔌 חבר מקורות
            </button>
            <button class="btn btn-gradient" style="width:auto" id="_bfs-proceed-btn">
              המשך בכל זאת
            </button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      document.getElementById('_bfs-proceed-btn').onclick = () => { overlay.remove(); resolve(true); };
      overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
    });
    if (!proceed) return;
  }

  btn.disabled = true; btn.textContent = 'מתחיל...';

  // Show progress area
  const progressArea = document.getElementById('bfs-progress-area');
  const stepsLog     = document.getElementById('bfs-steps-log');
  if (progressArea) progressArea.style.display = '';
  if (stepsLog) stepsLog.innerHTML = '';
  _bfsLog('🚀 שולח בקשת מחקר...', 'info');

  try {
    const result = await api('POST', 'research-start', {
      niche, depth_level: depth,
      business_name: bizName || undefined,
      target_audience: audience || undefined,
      main_offer: offer || undefined,
    });

    const { jobId, estimatedMinutes, depthLabel } = result;
    bfsResearchJob = { jobId, status: 'queued', steps: [], lastStepIndex: 0 };

    // Save to localStorage for persistence
    try { localStorage.setItem('lastResearchJob', JSON.stringify({ jobId, niche, depth, depthLabel })); } catch {}

    _bfsLog(`✅ מחקר "${depthLabel}" התחיל! צפוי לקחת כ-${estimatedMinutes} דקות`, 'success');
    _bfsLog('⏳ הסוכן עובד... ניתן לנווט לדפים אחרים ולחזור לאחר מכן', 'info');
    _bfsUpdateStatus('running', 5);

    btn.textContent = 'מחקר פעיל...';

    // Start polling
    _bfsStartPolling(jobId);

  } catch (err) {
    _bfsLog(`❌ שגיאה: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = '🔍 התחל מחקר שוק';
  }
}

// ── Polling ────────────────────────────────────────────────────────────────────
function _bfsStartPolling(jobId) {
  if (bfsResearchJob?.pollTimer) clearInterval(bfsResearchJob.pollTimer);
  const timer = setInterval(() => _bfsPoll(jobId), 2500);
  if (bfsResearchJob) bfsResearchJob.pollTimer = timer;
}

async function _bfsPoll(jobId) {
  if (!jobId) return;
  try {
    const since  = bfsResearchJob?.lastStepIndex || 0;
    const result = await api('GET', `research-status?jobId=${jobId}&since=${since}`);

    const { status, progress, steps, reportId, error } = result;

    // Render new steps
    if (steps?.length > 0) {
      steps.forEach(s => {
        const type = s.status === 'error' ? 'error' : s.status === 'done' ? 'done' : 'running';
        _bfsLog(s.message, type, s.created_at);
        if (bfsResearchJob) bfsResearchJob.lastStepIndex = Math.max(bfsResearchJob.lastStepIndex, s.step_index);
      });
    }

    _bfsUpdateStatus(status, progress);

    if (status === 'completed') {
      if (bfsResearchJob?.pollTimer) clearInterval(bfsResearchJob.pollTimer);
      bfsResearchJob.status   = 'completed';
      bfsResearchJob.reportId = reportId;
      try { const saved = JSON.parse(localStorage.getItem('lastResearchJob') || '{}'); saved.reportId = reportId; localStorage.setItem('lastResearchJob', JSON.stringify(saved)); } catch {}
      const btn = document.getElementById('bfs-start-btn');
      if (btn) { btn.disabled = false; btn.textContent = '🔍 התחל מחקר חדש'; }
      if (reportId) {
        _bfsLog('📋 טוען דוח מחקר...', 'info');
        await _bfsLoadReport(reportId);
      }
    } else if (status === 'failed') {
      if (bfsResearchJob?.pollTimer) clearInterval(bfsResearchJob.pollTimer);
      _bfsLog(`❌ המחקר נכשל: ${error || 'שגיאה לא ידועה'}`, 'error');
      const btn = document.getElementById('bfs-start-btn');
      if (btn) { btn.disabled = false; btn.textContent = '🔍 נסה שוב'; }
    }
  } catch (e) {
    console.warn('[bfs-poll] error:', e.message);
  }
}

function _bfsUpdateStatus(status, progress) {
  const dot      = document.getElementById('bfs-status-dot');
  const label    = document.getElementById('bfs-status-label');
  const bar      = document.getElementById('bfs-progress-bar');
  const pct      = document.getElementById('bfs-progress-pct');
  const labels   = { queued: 'ממתין בתור...', running: 'הסוכן עובד...', completed: 'המחקר הושלם!', failed: 'נכשל' };
  const colors   = { queued: '#fbbf24', running: '#6366f1', completed: '#22c55e', failed: '#ef4444' };
  if (dot)   dot.style.background = colors[status] || '#fbbf24';
  if (dot)   dot.style.animation  = status === 'running' ? 'pulse 1.5s infinite' : 'none';
  if (label) label.textContent    = labels[status] || status;
  if (bar)   bar.style.width      = (progress || 0) + '%';
  if (pct)   pct.textContent      = (progress || 0) + '%';
}

function _bfsLog(message, type = 'info', timestamp = null) {
  const log = document.getElementById('bfs-steps-log');
  if (!log) return;
  const colors = { info: '#94a3b8', success: '#4ade80', error: '#f87171', done: '#4ade80', running: '#fbbf24' };
  const color  = colors[type] || '#94a3b8';
  const time   = timestamp
    ? new Date(timestamp).toLocaleTimeString('he-IL')
    : new Date().toLocaleTimeString('he-IL');
  const line   = document.createElement('div');
  line.style.cssText = `color:${color};margin-bottom:4px;line-height:1.5;direction:rtl`;
  line.innerHTML = `<span style="color:#475569;font-size:0.72em;margin-left:8px">${time}</span>${message}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// ── Report Renderer ────────────────────────────────────────────────────────────
async function _bfsLoadReport(reportId) {
  try {
    const { report } = await api('GET', `research-report?reportId=${reportId}`);
    _bfsRenderReport(report);
  } catch (e) {
    _bfsLog(`⚠️ שגיאה בטעינת דוח: ${e.message}`, 'error');
  }
}

function _bfsRenderReport(report) {
  const area = document.getElementById('bfs-report-area');
  if (!area) return;
  area.style.display = '';

  const mm  = report.market_map  || {};
  const av  = report.avatar      || {};
  const ins = report.insights    || {};
  const rec = report.recommendations || [];
  const meta= report.meta        || {};

  const competitorCards = (mm.top_competitors || []).map(c => `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:0.75rem;padding:1rem;position:relative">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem">
        <div style="width:8px;height:8px;border-radius:50%;background:${c.strength==='high'?'#ef4444':c.strength==='medium'?'#f59e0b':'#22c55e'}"></div>
        <strong style="font-size:0.9rem">${c.name}</strong>
        ${c.domain ? `<span style="font-size:0.72rem;color:#64748b">${c.domain}</span>` : ''}
      </div>
      ${c.main_offering ? `<div style="font-size:0.8rem;color:#374151;margin-bottom:0.3rem">🎯 ${c.main_offering}</div>` : ''}
      ${c.key_message   ? `<div style="font-size:0.78rem;color:#6366f1;font-style:italic">"${c.key_message}"</div>` : ''}
      <div style="display:flex;gap:0.3rem;flex-wrap:wrap;margin-top:0.5rem">
        ${(c.platforms||[]).map(p=>`<span style="background:#e0e7ff;color:#4338ca;font-size:0.65rem;padding:2px 6px;border-radius:9999px">${p}</span>`).join('')}
      </div>
      <div style="position:absolute;top:0.5rem;left:0.5rem;font-size:0.65rem;color:#fff;background:${c.strength==='high'?'#ef4444':c.strength==='medium'?'#f59e0b':'#22c55e'};padding:2px 6px;border-radius:9999px">
        ${c.strength==='high'?'חזק':c.strength==='medium'?'בינוני':'חלש'}
      </div>
    </div>`).join('');

  const signalSection = (title, icon, items) => items?.length > 0 ? `
    <div style="margin-bottom:1rem">
      <div style="font-weight:600;font-size:0.85rem;margin-bottom:0.5rem;color:#1e293b">${icon} ${title}</div>
      <div style="display:flex;flex-direction:column;gap:0.4rem">
        ${items.map(s=>`<div style="background:#f8fafc;border-right:3px solid #6366f1;padding:0.5rem 0.75rem;border-radius:0 0.5rem 0.5rem 0;font-size:0.82rem;color:#374151">${s}</div>`).join('')}
      </div>
    </div>` : '';

  const insightCards = (arr, color, bgColor) => (arr||[]).filter(i=>i.confidence>=50).map(i=>`
    <div style="background:${bgColor};border:1px solid ${color}33;border-radius:0.75rem;padding:1rem;margin-bottom:0.75rem">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.4rem">
        <div style="font-weight:700;font-size:0.88rem;color:#1e293b">${i.title}</div>
        <span style="margin-right:auto;background:${color};color:#fff;font-size:0.65rem;padding:2px 6px;border-radius:9999px">${i.priority==='high'?'גבוה':i.priority==='medium'?'בינוני':'נמוך'}</span>
      </div>
      <div style="font-size:0.8rem;color:#374151;margin-bottom:0.5rem">${i.description}</div>
      ${i.evidence?.length>0?`<div style="font-size:0.72rem;color:#64748b">ראיה: ${i.evidence[0]}</div>`:''}
      <div style="font-size:0.72rem;color:#94a3b8;margin-top:0.4rem">ביטחון: ${i.confidence}%</div>
    </div>`).join('');

  const recCards = rec.map((r,i)=>`
    <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1px solid #bbf7d0;border-radius:0.75rem;padding:1rem;margin-bottom:0.75rem">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
        <div style="width:1.5rem;height:1.5rem;border-radius:50%;background:#16a34a;color:#fff;font-size:0.75rem;font-weight:700;display:flex;align-items:center;justify-content:center">${i+1}</div>
        <div style="font-weight:700;font-size:0.9rem;color:#14532d">${r.title}</div>
        <span style="margin-right:auto;background:${r.urgency==='high'?'#ef4444':'#f59e0b'};color:#fff;font-size:0.65rem;padding:2px 6px;border-radius:9999px">${r.urgency==='high'?'דחוף':'בינוני'}</span>
      </div>
      ${r.summary?`<div style="font-size:0.82rem;color:#374151;margin-bottom:0.5rem">${r.summary}</div>`:''}
      ${r.hook?`<div style="background:#fff;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.82rem;color:#6366f1;font-style:italic;margin-bottom:0.5rem">💬 הוק: "${r.hook}"</div>`:''}
      ${r.action_steps?.length>0?`
        <div style="font-size:0.78rem;font-weight:600;color:#166534;margin-bottom:0.25rem">שלבי פעולה:</div>
        <ol style="margin:0;padding-right:1.25rem;font-size:0.78rem;color:#374151;line-height:1.7">
          ${r.action_steps.map(s=>`<li>${s}</li>`).join('')}
        </ol>` : ''}
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem">
        ${r.platform?`<span style="background:#e0e7ff;color:#4338ca;font-size:0.65rem;padding:2px 7px;border-radius:9999px">${r.platform}</span>`:''}
        ${r.content_type?`<span style="background:#fef3c7;color:#92400e;font-size:0.65rem;padding:2px 7px;border-radius:9999px">${r.content_type}</span>`:''}
      </div>
    </div>`).join('');

  area.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.5rem;padding:1rem 1.25rem;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-radius:1rem;border:1px solid #bbf7d0">
      <div style="font-size:2rem">✅</div>
      <div>
        <div style="font-weight:700;font-size:1.05rem;color:#14532d">דוח מחקר מוכן!</div>
        <div style="font-size:0.8rem;color:#166534">${meta.entities_count||0} מתחרים · ${meta.signals_count||0} אותות קהל · ${(ins.patterns?.length||0)+(ins.gaps?.length||0)+(ins.opportunities?.length||0)} תובנות · ביטחון ${meta.confidence_score||0}%</div>
      </div>
      <div style="margin-right:auto;display:flex;gap:0.5rem">
        <button class="btn btn-sm btn-secondary" onclick="startResearch()" style="font-size:0.8rem">🔄 מחקר חדש</button>
        <button class="btn btn-sm btn-gradient" onclick="bfsAgentTab='strategy';renderBusinessFromScratch()" style="font-size:0.8rem;background:linear-gradient(135deg,#f59e0b,#ef4444)">🎯 בנה אסטרטגיה</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.25rem">

      <div class="card">
        <div class="card-title">🏢 מפת מתחרים (${(mm.top_competitors||[]).length})</div>
        <div style="display:flex;flex-direction:column;gap:0.6rem">${competitorCards || '<div class="text-sm text-muted">לא נמצאו מתחרים</div>'}</div>
      </div>

      <div class="card">
        <div class="card-title">👤 פרופיל קהל יעד</div>
        ${av.is_low_confidence ? `<div style="background:#fef3c7;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.78rem;color:#92400e;margin-bottom:0.75rem">⚠️ נתוני אווטר בביטחון חלקי</div>` : ''}
        ${signalSection('כאבים', '🔥', av.core_pains)}
        ${signalSection('פחדים', '😰', av.fears)}
        ${signalSection('רצונות', '✨', av.desires)}
        ${signalSection('שפה', '💬', av.language_patterns?.slice(0,3))}
      </div>
    </div>

    ${(ins.gaps?.length>0||ins.opportunities?.length>0) ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.25rem">
      <div class="card">
        <div class="card-title">💡 פערים בשוק</div>
        ${insightCards(ins.gaps,'#f59e0b','#fffbeb') || '<div class="text-sm text-muted">לא זוהו פערים</div>'}
      </div>
      <div class="card">
        <div class="card-title">🚀 הזדמנויות</div>
        ${insightCards(ins.opportunities,'#6366f1','#f5f3ff') || '<div class="text-sm text-muted">לא זוהו הזדמנויות</div>'}
      </div>
    </div>` : ''}

    ${rec.length > 0 ? `
    <div class="card">
      <div class="card-title">🎯 המלצות פעולה מוכנות לביצוע</div>
      ${recCards}
    </div>` : ''}

    ${ins.patterns?.length > 0 ? `
    <div class="card">
      <div class="card-title">📊 דפוסי שוק</div>
      ${insightCards(ins.patterns,'#0ea5e9','#f0f9ff')}
    </div>` : ''}
  `;

  area.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Restore job after navigation ───────────────────────────────────────────────
async function restoreResearchJob() {
  try {
    const saved = localStorage.getItem('lastResearchJob');
    if (!saved) return;
    const { jobId } = JSON.parse(saved);
    if (!jobId) return;
    const result = await api('GET', `research-status?jobId=${jobId}&since=0`);
    if (result.status === 'completed' && result.reportId) {
      const progressArea = document.getElementById('bfs-progress-area');
      if (progressArea) progressArea.style.display = '';
      _bfsUpdateStatus('completed', 100);
      _bfsLog('📋 טוען דוח קיים...', 'info');
      await _bfsLoadReport(result.reportId);
    } else if (result.status === 'running' || result.status === 'queued') {
      bfsResearchJob = { jobId, status: result.status, steps: [], lastStepIndex: 0 };
      const progressArea = document.getElementById('bfs-progress-area');
      if (progressArea) progressArea.style.display = '';
      _bfsUpdateStatus(result.status, result.progress || 0);
      if (result.steps?.length) {
        result.steps.forEach(s => _bfsLog(s.message, s.status === 'done' ? 'done' : 'running', s.created_at));
        bfsResearchJob.lastStepIndex = result.steps[result.steps.length - 1]?.step_index || 0;
      }
      _bfsLog('🔄 מחבר מחדש למחקר פעיל...', 'info');
      _bfsStartPolling(jobId);
    }
  } catch {}
}

// ══════════════════════════════════════════════════════════════════════════════
// 🎯 STRATEGY AGENT — Client Functions
// ══════════════════════════════════════════════════════════════════════════════

async function startStrategy() {
  const btn            = document.getElementById('strategy-start-btn');
  const researchReportId = document.getElementById('strategy-report-id')?.value.trim();

  if (!researchReportId) { toast('נא להזין מזהה דוח מחקר', 'error'); return; }

  btn.disabled = true; btn.textContent = 'מתחיל...';

  const progressArea = document.getElementById('strategy-progress-area');
  const stepsLog     = document.getElementById('strategy-steps-log');
  if (progressArea) progressArea.style.display = '';
  if (stepsLog) stepsLog.innerHTML = '';
  _strategyLog('🚀 שולח בקשת אסטרטגיה...', 'info');

  try {
    const result = await api('POST', 'strategy-start', { researchReportId });
    const { jobId, estimatedMinutes, niche } = result;

    bfsStrategyJob = { jobId, status: 'queued', steps: [], lastStepIndex: 0 };
    try { localStorage.setItem('lastStrategyJob', JSON.stringify({ jobId, researchReportId, niche })); } catch {}

    _strategyLog(`✅ בניית אסטרטגיה עבור "${niche}" התחילה! צפוי לקחת כ-${estimatedMinutes} דקות`, 'success');
    _strategyLog('⏳ הסוכן עובד על 20 מודולים של ניתוח אסטרטגי...', 'info');
    _strategyUpdateStatus('running', 5);

    btn.textContent = 'אסטרטגיה בבנייה...';
    _strategyStartPolling(jobId);

  } catch (err) {
    _strategyLog(`❌ שגיאה: ${err.message}`, 'error');
    btn.disabled = false;
    btn.textContent = '🎯 התחל בניית אסטרטגיה';
  }
}

function _strategyStartPolling(jobId) {
  if (bfsStrategyJob?.pollTimer) clearInterval(bfsStrategyJob.pollTimer);
  const timer = setInterval(() => _strategyPoll(jobId), 2500);
  if (bfsStrategyJob) bfsStrategyJob.pollTimer = timer;
}

async function _strategyPoll(jobId) {
  if (!jobId) return;
  try {
    const since  = bfsStrategyJob?.lastStepIndex || 0;
    const result = await api('GET', `strategy-status?jobId=${jobId}&since=${since}`);
    const { status, progress, steps, reportId, error } = result;

    if (steps?.length > 0) {
      steps.forEach(s => {
        const type = s.status === 'error' ? 'error' : s.status === 'done' ? 'done' : s.status === 'skipped' ? 'info' : 'running';
        _strategyLog(s.message, type, s.created_at);
        if (bfsStrategyJob) bfsStrategyJob.lastStepIndex = Math.max(bfsStrategyJob.lastStepIndex, s.step_index);
      });
    }

    _strategyUpdateStatus(status, progress);

    if (status === 'completed') {
      if (bfsStrategyJob?.pollTimer) clearInterval(bfsStrategyJob.pollTimer);
      bfsStrategyJob.status   = 'completed';
      bfsStrategyJob.reportId = reportId;
      if (reportId) localStorage.setItem('lastStrategyJob', JSON.stringify({ jobId: bfsStrategyJob?.jobId, reportId }));
      const btn = document.getElementById('strategy-start-btn');
      if (btn) { btn.disabled = false; btn.textContent = '🎯 אסטרטגיה חדשה'; }
      if (reportId) {
        _strategyLog('📋 טוען דוח אסטרטגיה...', 'info');
        await _strategyLoadReport(reportId);
      }
    } else if (status === 'failed') {
      if (bfsStrategyJob?.pollTimer) clearInterval(bfsStrategyJob.pollTimer);
      _strategyLog(`❌ האסטרטגיה נכשלה: ${error || 'שגיאה לא ידועה'}`, 'error');
      const btn = document.getElementById('strategy-start-btn');
      if (btn) { btn.disabled = false; btn.textContent = '🎯 נסה שוב'; }
    }
  } catch (e) {
    console.warn('[strategy-poll] error:', e.message);
  }
}

function _strategyUpdateStatus(status, progress) {
  const dot    = document.getElementById('strategy-status-dot');
  const label  = document.getElementById('strategy-status-label');
  const bar    = document.getElementById('strategy-progress-bar');
  const pct    = document.getElementById('strategy-progress-pct');
  const labels = { queued: 'ממתין בתור...', running: 'סוכן אסטרטגיה עובד...', completed: 'האסטרטגיה הושלמה!', failed: 'נכשל' };
  const colors = { queued: '#fbbf24', running: '#f59e0b', completed: '#22c55e', failed: '#ef4444' };
  if (dot)   dot.style.background = colors[status] || '#fbbf24';
  if (dot)   dot.style.animation  = status === 'running' ? 'pulse 1.5s infinite' : 'none';
  if (label) label.textContent    = labels[status] || status;
  if (bar)   bar.style.width      = (progress || 0) + '%';
  if (pct)   pct.textContent      = (progress || 0) + '%';
}

function _strategyLog(message, type = 'info', timestamp = null) {
  const log = document.getElementById('strategy-steps-log');
  if (!log) return;
  const colors = { info: '#94a3b8', success: '#4ade80', error: '#f87171', done: '#4ade80', running: '#fbbf24' };
  const color  = colors[type] || '#94a3b8';
  const time   = timestamp ? new Date(timestamp).toLocaleTimeString('he-IL') : new Date().toLocaleTimeString('he-IL');
  const line   = document.createElement('div');
  line.style.cssText = `color:${color};margin-bottom:4px;line-height:1.5;direction:rtl`;
  line.innerHTML = `<span style="color:#6b4c1a;font-size:0.72em;margin-left:8px">${time}</span>${message}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

async function _strategyLoadReport(reportId) {
  try {
    const { report } = await api('GET', `strategy-report?reportId=${reportId}`);
    _strategyRenderReport(report);
  } catch (e) {
    _strategyLog(`⚠️ שגיאה בטעינת דוח: ${e.message}`, 'error');
  }
}

function _strategyRenderReport(report) {
  const area = document.getElementById('strategy-report-area');
  if (!area) return;
  area.style.display = '';

  const prod     = report.product     || {};
  const pos      = report.positioning || {};
  const strat    = report.strategy    || {};
  const tp       = report.test_plan   || {};
  const met      = report.metrics     || {};
  const risks    = report.risks       || [];
  const preflight= report.preflight   || {};
  const conf     = report.confidence  || 0;
  const goSig    = report.go_signal || (conf >= 70 ? 'ירוק' : conf >= 45 ? 'צהוב' : 'אדום');

  const goColor = goSig === 'ירוק' ? '#16a34a' : goSig === 'צהוב' ? '#d97706' : '#dc2626';
  const goBg    = goSig === 'ירוק' ? '#f0fdf4' : goSig === 'צהוב' ? '#fefce8' : '#fef2f2';
  const goBorder= goSig === 'ירוק' ? '#bbf7d0' : goSig === 'צהוב' ? '#fde68a' : '#fecaca';
  const goEmoji = goSig === 'ירוק' ? '🟢' : goSig === 'צהוב' ? '🟡' : '🔴';

  const riskBadge = r => `<div style="background:${r.severity==='high'?'#fee2e2':r.severity==='medium'?'#fef3c7':'#f1f5f9'};
    border-right:3px solid ${r.severity==='high'?'#ef4444':r.severity==='medium'?'#f59e0b':'#94a3b8'};
    padding:0.5rem 0.75rem;border-radius:0 0.5rem 0.5rem 0;font-size:0.8rem;color:#374151;margin-bottom:0.5rem">
    ${r.severity==='high'?'🚩':r.severity==='medium'?'⚠️':'ℹ️'} ${r.description}
  </div>`;

  const angleCard = a => `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:0.75rem;padding:0.875rem;margin-bottom:0.6rem">
      <div style="font-size:0.7rem;color:#6366f1;font-weight:600;margin-bottom:0.25rem;text-transform:uppercase">${a.type || ''}</div>
      <div style="font-size:0.82rem;color:#374151;margin-bottom:0.3rem">${a.text || ''}</div>
      ${a.hook ? `<div style="font-size:0.78rem;color:#64748b;font-style:italic">💬 "${a.hook}"</div>` : ''}
    </div>`;

  const hypoCard = h => `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:0.75rem;padding:1rem;margin-bottom:0.75rem">
      <div style="font-weight:700;font-size:0.88rem;color:#14532d;margin-bottom:0.4rem">${h.what || h.id}</div>
      <div style="font-size:0.8rem;color:#374151;margin-bottom:0.5rem">${h.hypothesis || ''}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.78rem">
        <div style="background:#fff;border-radius:0.4rem;padding:0.4rem 0.6rem"><strong>A:</strong> ${h.variant_a || ''}</div>
        <div style="background:#fff;border-radius:0.4rem;padding:0.4rem 0.6rem"><strong>B:</strong> ${h.variant_b || ''}</div>
      </div>
      <div style="font-size:0.72rem;color:#166534;margin-top:0.4rem">מדד הצלחה: ${h.success_metric || ''} | מינימום: ${h.min_impressions ? h.min_impressions.toLocaleString() : '—'} חשיפות</div>
    </div>`;

  const metricRow = (label, obj) => obj?.kpi ? `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;border-bottom:1px solid #f1f5f9;font-size:0.82rem">
      <span style="color:#64748b">${label}</span>
      <strong style="color:#1e293b">${obj.kpi}</strong>
    </div>` : '';

  area.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.5rem;padding:1rem 1.25rem;
      background:${goBg};border-radius:1rem;border:1px solid ${goBorder}">
      <div style="font-size:2rem">${goEmoji}</div>
      <div>
        <div style="font-weight:700;font-size:1.05rem;color:${goColor}">אסטרטגיה מוכנה — אות: ${goSig}</div>
        <div style="font-size:0.8rem;color:${goColor}">ביטחון ${conf}% · ${(risks.filter(r=>r.severity==='high')).length} סיכונים קריטיים · ${(strat.angles||[]).length} זוויות שיווק</div>
      </div>
      <div style="margin-right:auto">
        <button class="btn btn-sm btn-secondary" onclick="startStrategy()" style="font-size:0.8rem">🔄 אסטרטגיה חדשה</button>
        <button class="btn btn-sm btn-gradient" onclick="bfsAgentTab='execution';renderBusinessFromScratch()" style="font-size:0.8rem;background:linear-gradient(135deg,#059669,#0ea5e9)">🧱 צור נכסי ביצוע</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.25rem">

      <div class="card">
        <div class="card-title">📦 המוצר</div>
        <div style="font-size:0.8rem;color:#6366f1;font-weight:600;margin-bottom:0.4rem">${prod.productType || ''}</div>
        ${prod.productName ? `<div style="font-weight:700;font-size:0.95rem;margin-bottom:0.4rem">${prod.productName}</div>` : ''}
        ${prod.outcome ? `<div style="font-size:0.85rem;color:#374151;margin-bottom:0.75rem;line-height:1.5">${prod.outcome}</div>` : ''}
        <div style="background:#f8fafc;border-radius:0.5rem;padding:0.75rem;font-size:0.8rem">
          <div style="margin-bottom:0.3rem"><strong>כאב מרכזי:</strong> ${prod.selectedPain || '—'}</div>
          ${prod.timeToResult ? `<div style="margin-bottom:0.3rem"><strong>זמן לתוצאה:</strong> ${prod.timeToResult}</div>` : ''}
          <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.4rem">
            <strong>כדאיות:</strong>
            <div style="flex:1;height:6px;background:#e2e8f0;border-radius:9999px">
              <div style="height:100%;background:${(prod.viabilityScore||0)>=70?'#22c55e':(prod.viabilityScore||0)>=50?'#f59e0b':'#ef4444'};
                border-radius:9999px;width:${prod.viabilityScore||0}%"></div>
            </div>
            <span>${prod.viabilityScore||0}%</span>
          </div>
        </div>
        ${(prod.productStructure||[]).length>0 ? `
          <div style="margin-top:0.75rem">
            <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.4rem">מבנה המוצר:</div>
            ${prod.productStructure.slice(0,4).map(s=>`
              <div style="display:flex;gap:0.5rem;align-items:flex-start;margin-bottom:0.3rem;font-size:0.78rem">
                <span style="background:#6366f1;color:#fff;border-radius:50%;width:18px;height:18px;font-size:0.65rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">${s.step}</span>
                <span><strong>${s.title}:</strong> ${s.description||''}</span>
              </div>`).join('')}
          </div>` : ''}
      </div>

      <div class="card">
        <div class="card-title">🎯 בידול ומיצוב</div>
        ${pos.selectedPositioning ? `
          <div style="background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border:1px solid #bae6fd;border-radius:0.75rem;padding:0.875rem;margin-bottom:0.75rem">
            <div style="font-weight:700;font-size:0.95rem;color:#0c4a6e;line-height:1.4">"${pos.selectedPositioning}"</div>
            ${pos.whyUs ? `<div style="font-size:0.78rem;color:#0369a1;margin-top:0.4rem">${pos.whyUs}</div>` : ''}
          </div>` : ''}
        ${pos.angleType ? `<div style="font-size:0.8rem;margin-bottom:0.3rem"><strong>סוג זווית:</strong> ${pos.angleType}</div>` : ''}
        ${pos.gapUsed ? `<div style="font-size:0.8rem;margin-bottom:0.3rem"><strong>פער מנוצל:</strong> ${pos.gapUsed}</div>` : ''}
        <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.4rem;font-size:0.8rem">
          <strong>ציון בידול:</strong>
          <div style="flex:1;height:6px;background:#e2e8f0;border-radius:9999px">
            <div style="height:100%;background:#6366f1;border-radius:9999px;width:${pos.positionScore||0}%"></div>
          </div>
          <span>${pos.positionScore||0}%</span>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">📢 מסר ליבה וזוויות שיווק</div>
      ${strat.coreMessage ? `
        <div style="background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1px solid #c4b5fd;border-radius:0.75rem;padding:1rem;margin-bottom:1rem;text-align:center">
          <div style="font-size:0.75rem;color:#7c3aed;font-weight:600;margin-bottom:0.25rem">מסר ליבה</div>
          <div style="font-size:1.05rem;font-weight:700;color:#4c1d95">"${strat.coreMessage}"</div>
          ${strat.targetCustomer ? `<div style="font-size:0.78rem;color:#6d28d9;margin-top:0.4rem">לקוח: ${strat.targetCustomer}</div>` : ''}
        </div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
        <div>
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.5rem">זוויות שיווק (${(strat.angles||[]).length})</div>
          ${(strat.angles||[]).map(angleCard).join('')}
        </div>
        <div>
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.5rem">שיטה ופלטפורמה</div>
          ${strat.method?.primary ? `
            <div style="background:#f8fafc;border-radius:0.5rem;padding:0.75rem;font-size:0.8rem;margin-bottom:0.5rem">
              <div><strong>שיטה:</strong> ${strat.method.primary.label || ''}</div>
              ${strat.tone?.label ? `<div><strong>טון:</strong> ${strat.tone.label}</div>` : ''}
              ${strat.platforms?.primary ? `<div><strong>פלטפורמה ראשית:</strong> ${strat.platforms.primary}</div>` : ''}
            </div>` : ''}
          ${strat.funnel?.hook_strategy ? `
            <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.4rem">המשפך</div>
            <div style="font-size:0.78rem;background:#f8fafc;border-radius:0.5rem;padding:0.75rem">
              ${strat.funnel.traffic_source ? `<div style="margin-bottom:0.25rem">📍 <strong>תנועה:</strong> ${strat.funnel.traffic_source}</div>` : ''}
              ${strat.funnel.hook_strategy ? `<div style="margin-bottom:0.25rem">🪝 <strong>הוק:</strong> ${strat.funnel.hook_strategy}</div>` : ''}
              ${strat.funnel.trust_builder ? `<div style="margin-bottom:0.25rem">🤝 <strong>אמינות:</strong> ${strat.funnel.trust_builder}</div>` : ''}
              ${strat.funnel.offer_structure ? `<div style="margin-bottom:0.25rem">💰 <strong>הצעה:</strong> ${strat.funnel.offer_structure}</div>` : ''}
              ${strat.funnel.conversion_method ? `<div>✅ <strong>המרה:</strong> ${strat.funnel.conversion_method}</div>` : ''}
            </div>` : ''}
          ${strat.system_fit ? `
            <div style="margin-top:0.5rem;font-size:0.78rem;background:${strat.system_fit.isSystemFit?'#f0fdf4':'#fef2f2'};border-radius:0.4rem;padding:0.4rem 0.6rem;color:${strat.system_fit.isSystemFit?'#166534':'#991b1b'}">
              System Fit: ${strat.system_fit.score}% ${strat.system_fit.isSystemFit ? '✅ מתאים למשאבים' : '⚠️ בדוק התאמה למשאבים'}
            </div>` : ''}
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.25rem">

      ${(tp.hypotheses||[]).length > 0 ? `
      <div class="card">
        <div class="card-title">🧪 תכנית בדיקות A/B</div>
        ${tp.priority_reason ? `<div style="font-size:0.78rem;color:#64748b;margin-bottom:0.75rem">${tp.priority_reason}</div>` : ''}
        ${tp.hypotheses.map(hypoCard).join('')}
      </div>` : '<div></div>'}

      <div class="card">
        <div class="card-title">📊 מדדי הצלחה (KPIs)</div>
        ${metricRow('חשיפות (CTR)', met.exposure)}
        ${metricRow('עמוד נחיתה (conv%)', met.interest)}
        ${metricRow('אמון / Lead', met.trust)}
        ${metricRow('פעולה (CPL)', met.action)}
        ${metricRow('מכירה (CAC)', met.payment)}
        ${met.unitEconomics?.roasBreakeven ? `
          <div style="margin-top:0.75rem;background:#f0fdf4;border-radius:0.5rem;padding:0.6rem 0.75rem;font-size:0.78rem;color:#166534">
            ROAS ל-break-even: <strong>${met.unitEconomics.roasBreakeven}x</strong>
          </div>` : ''}
      </div>
    </div>

    ${risks.length > 0 ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">🚩 סיכונים</div>
      ${risks.map(riskBadge).join('')}
    </div>` : ''}

    ${preflight.checklist ? (() => {
      const checks = preflight.checklist;
      const labels = {
        product: 'מוצר ברור', pain_with_backup: 'כאב + גיבוי', differentiation: 'בידול',
        core_message: 'מסר מרכזי', angles_3plus: '3+ זוויות', method: 'שיטת שיווק',
        tone: 'טון', platform: 'פלטפורמה', assets: 'נכסים', funnel_complete: 'משפך שלם',
        test_plan: 'תכנית בדיקות', metrics: 'מדדים',
      };
      return `
      <div class="card" style="margin-bottom:1.25rem">
        <div class="card-title">✅ בדיקת מעבר לסוכן ביצוע (Pre-flight)</div>
        <div style="font-size:0.78rem;color:#64748b;margin-bottom:0.75rem">${preflight.passed || 0}/${preflight.total || 12} בדיקות עברו ${preflight.ready ? '— <strong style="color:#16a34a">מוכן לביצוע</strong>' : '— <strong style="color:#dc2626">יש פערים</strong>'}</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.4rem">
          ${Object.entries(checks).map(([k,v]) => `
            <div style="display:flex;align-items:center;gap:0.3rem;padding:0.35rem 0.5rem;background:${v?'#f0fdf4':'#fef2f2'};border-radius:0.4rem;font-size:0.72rem">
              <span>${v ? '✅' : '❌'}</span>
              <span style="color:${v?'#166534':'#991b1b'}">${labels[k] || k}</span>
            </div>`).join('')}
        </div>
      </div>`;
    })() : ''}
  `;

  area.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function restoreStrategyJob() {
  try {
    const saved = localStorage.getItem('lastStrategyJob');
    if (!saved) return;
    const { jobId } = JSON.parse(saved);
    if (!jobId) return;
    const result = await api('GET', `strategy-status?jobId=${jobId}&since=0`);
    if (result.status === 'completed' && result.reportId) {
      const progressArea = document.getElementById('strategy-progress-area');
      if (progressArea) progressArea.style.display = '';
      _strategyUpdateStatus('completed', 100);
      _strategyLog('📋 טוען דוח קיים...', 'info');
      await _strategyLoadReport(result.reportId);
    } else if (result.status === 'running' || result.status === 'queued') {
      bfsStrategyJob = { jobId, status: result.status, steps: [], lastStepIndex: 0 };
      const progressArea = document.getElementById('strategy-progress-area');
      if (progressArea) progressArea.style.display = '';
      _strategyUpdateStatus(result.status, result.progress || 0);
      if (result.steps?.length) {
        result.steps.forEach(s => _strategyLog(s.message, s.status === 'done' ? 'done' : 'running', s.created_at));
        bfsStrategyJob.lastStepIndex = result.steps[result.steps.length - 1]?.step_index || 0;
      }
      _strategyLog('🔄 מחבר מחדש לאסטרטגיה פעילה...', 'info');
      _strategyStartPolling(jobId);
    }
  } catch {}
}

// ══════════════════════════════════════════════════════════════════════════════
// 🧱 EXECUTION AGENT
// ══════════════════════════════════════════════════════════════════════════════

async function startExecution() {
  const btn        = document.getElementById('exec-start-btn');
  const reportId   = document.getElementById('exec-strategy-report-id')?.value.trim();
  const platform   = document.getElementById('exec-platform')?.value || 'meta';
  const mode       = document.getElementById('exec-mode')?.value || 'smart';
  const assetTypes = ['ads','hooks','cta','landing_page','scripts','email']
    .filter(t => document.getElementById(`exec-asset-${t}`)?.checked);

  if (!reportId) { toast('נא להזין מזהה דוח אסטרטגיה', 'error'); return; }
  if (assetTypes.length === 0) { toast('נא לבחור לפחות נכס אחד', 'error'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ מתחיל...'; }

  try {
    const resp = await apiFetch('/execution-start', {
      method: 'POST',
      body: JSON.stringify({ strategyReportId: reportId, assetTypes, executionMode: mode, platform }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'שגיאה בהפעלת סוכן ביצוע');

    const { jobId } = data;
    bfsExecutionJob = { jobId, status: 'queued', steps: [], lastStepIndex: 0 };
    localStorage.setItem('lastExecutionJob', JSON.stringify({ jobId, reportId }));

    document.getElementById('exec-progress-area').style.display = '';
    _executionLog('✅ סוכן ביצוע הופעל — ממתין לעיבוד...', 'running');
    _executionStartPolling(jobId);
  } catch (err) {
    toast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🧱 צור נכסי שיווק'; }
  }
}

function _executionStartPolling(jobId) {
  if (bfsExecutionJob?.pollTimer) clearInterval(bfsExecutionJob.pollTimer);
  const timer = setInterval(() => _executionPoll(jobId), 3000);
  if (bfsExecutionJob) bfsExecutionJob.pollTimer = timer;
}

async function _executionPoll(jobId) {
  try {
    const since  = bfsExecutionJob?.lastStepIndex || 0;
    const resp   = await apiFetch(`/execution-status?jobId=${jobId}&since=${since}`);
    const result = await resp.json();
    if (!resp.ok) return;

    (result.steps || []).forEach(s => {
      _executionLog(s.message, s.status === 'done' ? 'done' : 'running', s.created_at);
      if (bfsExecutionJob) bfsExecutionJob.lastStepIndex = Math.max(bfsExecutionJob.lastStepIndex, s.step_index);
    });

    _executionUpdateStatus(result.status, result.progress || 0);

    if (result.status === 'completed' && result.reportId) {
      if (bfsExecutionJob?.pollTimer) clearInterval(bfsExecutionJob.pollTimer);
      bfsExecutionJob.status   = 'completed';
      bfsExecutionJob.reportId = result.reportId;
      localStorage.setItem('lastExecutionJob', JSON.stringify({ jobId, reportId: result.reportId }));
      _executionLog('🎉 סוכן ביצוע הסתיים בהצלחה!', 'done');
      await _executionLoadReport(result.reportId);
    } else if (result.status === 'failed') {
      if (bfsExecutionJob?.pollTimer) clearInterval(bfsExecutionJob.pollTimer);
      _executionLog(`❌ שגיאה: ${result.error || 'תקלה לא ידועה'}`, 'error');
      _executionUpdateStatus('failed', 0);
    }
  } catch {}
}

function _executionUpdateStatus(status, progress) {
  const dot   = document.getElementById('exec-status-dot');
  const label = document.getElementById('exec-status-label');
  const bar   = document.getElementById('exec-progress-bar');
  const pct   = document.getElementById('exec-progress-pct');
  if (!label) return;

  const MAP = {
    queued:    { label: 'ממתין בתור...', color: '#fbbf24' },
    running:   { label: `מייצר נכסים... ${progress}%`, color: '#34d399' },
    completed: { label: 'הושלם!', color: '#10b981' },
    failed:    { label: 'שגיאה', color: '#ef4444' },
  };
  const s = MAP[status] || MAP.running;
  label.textContent = s.label;
  if (dot) dot.style.background = s.color;
  if (bar) bar.style.width = progress + '%';
  if (pct) pct.textContent = progress + '%';
}

function _executionLog(message, type, ts) {
  const log = document.getElementById('exec-steps-log');
  if (!log) return;
  const colors = { done: '#34d399', running: '#fbbf24', error: '#ef4444', info: '#94a3b8' };
  const icons  = { done: '✅', running: '⏳', error: '❌', info: 'ℹ️' };
  const time   = ts ? new Date(ts).toLocaleTimeString('he-IL') : new Date().toLocaleTimeString('he-IL');
  const div = document.createElement('div');
  div.style.cssText = `color:${colors[type]||'#e2e8f0'};margin-bottom:0.3rem;display:flex;gap:0.5rem`;
  div.innerHTML = `<span style="color:#4b5563;flex-shrink:0">${time}</span><span>${icons[type]||'•'} ${message}</span>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function _executionLoadReport(reportId) {
  try {
    const resp   = await apiFetch(`/execution-report?reportId=${reportId}`);
    const result = await resp.json();
    if (!resp.ok || !result.report) return;
    _executionRenderReport(result.report);
  } catch {}
}

function _executionRenderReport(report) {
  const area = document.getElementById('exec-report-area');
  if (!area) return;
  area.style.display = '';

  const bundle      = report.assets || {};
  const mc          = report.message_core || {};
  const qa          = report.qa_handoff || {};
  const ranking     = report.ranking || null;
  const feedback    = report.self_feedback || {};
  const summary     = report.summary || {};
  const decisionLayer = report.decision_layer || {};
  const tracking    = report.tracking || {};
  const preQa       = report.pre_qa || {};
  const decisionExp = report.decision_explanation || {};

  // ── QA status banner ───────────────────────────────────────────────────────
  const qaColors = { APPROVED: { bg:'#f0fdf4', border:'#bbf7d0', color:'#15803d', emoji:'✅' },
                     REVIEW_RECOMMENDED: { bg:'#fffbeb', border:'#fde68a', color:'#92400e', emoji:'⚠️' },
                     NEEDS_REVISION: { bg:'#fef2f2', border:'#fecaca', color:'#991b1b', emoji:'❌' } };
  const qac = qaColors[qa.status] || qaColors.REVIEW_RECOMMENDED;

  // ── Ads ───────────────────────────────────────────────────────────────────
  const adsHtml = (bundle.ads || []).map((ad, i) => {
    const t = ad.text || ad;
    return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:0.75rem;padding:1rem;margin-bottom:0.75rem">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem">
        <span style="background:#6366f1;color:#fff;font-size:0.7rem;padding:2px 8px;border-radius:9999px;font-weight:700">וריאנט ${i+1}</span>
        ${ad.theme ? `<span style="font-size:0.78rem;color:#64748b">${ad.theme}</span>` : ''}
        ${ad.score ? `<span style="margin-right:auto;background:#dcfce7;color:#15803d;font-size:0.72rem;padding:2px 6px;border-radius:9999px">ציון ${ad.score}</span>` : ''}
      </div>
      ${t.headline ? `<div style="font-weight:700;font-size:0.95rem;margin-bottom:0.3rem">${t.headline}</div>` : ''}
      ${t.primary_text ? `<div style="font-size:0.82rem;color:#374151;margin-bottom:0.4rem;line-height:1.5">${t.primary_text}</div>` : ''}
      ${t.description ? `<div style="font-size:0.78rem;color:#64748b;margin-bottom:0.4rem">${t.description}</div>` : ''}
      ${t.cta_button ? `<span style="display:inline-block;background:#6366f1;color:#fff;font-size:0.78rem;padding:0.3rem 0.75rem;border-radius:0.4rem;margin-top:0.25rem">${t.cta_button}</span>` : ''}
    </div>`;
  }).join('') || '<div style="color:#94a3b8;font-size:0.85rem">לא נוצרו מודעות</div>';

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const hooksHtml = (bundle.hooks || []).map(h =>
    `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:0.5rem;padding:0.6rem 0.85rem;margin-bottom:0.4rem;font-size:0.85rem;color:#14532d">
      ${h.text || h}
      ${h.type && h.type !== 'general' ? `<span style="margin-right:0.5rem;color:#6b7280;font-size:0.72rem">[${h.type}]</span>` : ''}
    </div>`
  ).join('') || '<div style="color:#94a3b8;font-size:0.85rem">לא נוצרו hooks</div>';

  // ── CTA ───────────────────────────────────────────────────────────────────
  const ctaHtml = (bundle.cta || []).map(c =>
    `<div style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:0.5rem 1.25rem;border-radius:0.6rem;font-size:0.85rem;font-weight:600;margin:0.25rem">
      ${c.text || c}
      ${c.style ? `<span style="opacity:0.7;font-size:0.7rem;margin-right:0.4rem">(${c.style})</span>` : ''}
    </div>`
  ).join('') || '';

  // ── Landing Page ──────────────────────────────────────────────────────────
  const lp = bundle.landing_page?.content?.sections || {};
  const lpHtml = Object.keys(lp).length > 0 ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">🌐 דף נחיתה</div>
      ${lp.hero ? `<div style="background:linear-gradient(135deg,#1e1b4b,#312e81);border-radius:0.75rem;padding:1.25rem;margin-bottom:0.75rem;color:#fff">
        <div style="font-size:1.05rem;font-weight:700;margin-bottom:0.4rem">${lp.hero.headline||''}</div>
        ${lp.hero.subheadline ? `<div style="opacity:0.8;font-size:0.85rem;margin-bottom:0.75rem">${lp.hero.subheadline}</div>` : ''}
        ${lp.hero.cta ? `<span style="background:#fbbf24;color:#78350f;padding:0.4rem 1rem;border-radius:0.4rem;font-weight:700;font-size:0.85rem">${lp.hero.cta}</span>` : ''}
      </div>` : ''}
      ${lp.offer ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:0.75rem;padding:1rem">
        <div style="font-weight:700;margin-bottom:0.4rem;color:#14532d">${lp.offer.headline||''}</div>
        ${(lp.offer.value_stack||[]).map(v=>`<div style="font-size:0.8rem;color:#374151">• ${v}</div>`).join('')}
        ${lp.offer.guarantee ? `<div style="font-size:0.78rem;color:#64748b;margin-top:0.4rem">✅ ${lp.offer.guarantee}</div>` : ''}
      </div>` : ''}
    </div>` : '';

  // ── Email sequence ────────────────────────────────────────────────────────
  const emailHtml = (bundle.email || []).length > 0 ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">📧 סדרת אימיילים (${bundle.email.length} אימיילים)</div>
      ${bundle.email.map((e,i) => {
        const c = e.content || e;
        return `<div style="border:1px solid #e2e8f0;border-radius:0.6rem;padding:0.75rem;margin-bottom:0.5rem">
          <div style="font-weight:600;font-size:0.88rem;margin-bottom:0.3rem">📨 אימייל ${i+1}: ${c.subject||''}</div>
          ${c.preview ? `<div style="font-size:0.78rem;color:#64748b;margin-bottom:0.25rem">Preview: ${c.preview}</div>` : ''}
          ${c.body ? `<div style="font-size:0.8rem;color:#374151;line-height:1.5;max-height:100px;overflow:hidden">${c.body}</div>` : ''}
          ${c.cta_text ? `<div style="margin-top:0.4rem"><span style="background:#6366f1;color:#fff;font-size:0.75rem;padding:0.2rem 0.6rem;border-radius:0.4rem">${c.cta_text}</span></div>` : ''}
        </div>`;
      }).join('')}
    </div>` : '';

  // ── Quality scores ─────────────────────────────────────────────────────────
  const qualityHtml = feedback?.scores ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">⭐ ציוני איכות</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem">
        ${Object.entries(feedback.scores).map(([k,v]) => {
          const labels = { message_clarity:'בהירות מסר', pain_resonance:'תהודת כאב', cta_strength:'עוצמת CTA', tone_consistency:'עקביות טון', uniqueness:'ייחודיות' };
          const color  = v >= 70 ? '#15803d' : v >= 50 ? '#92400e' : '#991b1b';
          const bg     = v >= 70 ? '#f0fdf4' : v >= 50 ? '#fffbeb' : '#fef2f2';
          return `<div style="background:${bg};border-radius:0.6rem;padding:0.6rem;text-align:center">
            <div style="font-size:1.1rem;font-weight:700;color:${color}">${v}</div>
            <div style="font-size:0.7rem;color:#64748b">${labels[k]||k}</div>
          </div>`;
        }).join('')}
      </div>
      ${feedback.overall_score ? `<div style="text-align:center;margin-top:0.75rem;font-size:0.9rem;font-weight:700;color:#6366f1">ציון כולל: ${feedback.overall_score}/100</div>` : ''}
    </div>` : '';

  // ── QA Checklist ──────────────────────────────────────────────────────────
  const qaChecklistHtml = qa.testChecklist?.length > 0 ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">✅ רשימת בדיקות לפני שיגור</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem">
        ${qa.testChecklist.map(item => `
          <div style="display:flex;align-items:flex-start;gap:0.5rem;background:#f8fafc;border-radius:0.4rem;padding:0.4rem 0.6rem;font-size:0.78rem">
            <span>${item.critical ? '🔴' : '🟡'}</span>
            <span style="color:#374151">${item.item}</span>
          </div>`).join('')}
      </div>
    </div>` : '';

  area.innerHTML = `
    <div style="background:${qac.bg};border:1px solid ${qac.border};border-radius:1rem;padding:1rem 1.25rem;margin-bottom:1.5rem;display:flex;align-items:center;gap:0.75rem">
      <span style="font-size:1.5rem">${qac.emoji}</span>
      <div>
        <div style="font-weight:700;font-size:0.95rem;color:${qac.color}">סוכן ביצוע — ${qa.status === 'APPROVED' ? 'מאושר לשיגור' : qa.status === 'REVIEW_RECOMMENDED' ? 'מומלץ לסקירה' : 'נדרש תיקון'}</div>
        <div style="font-size:0.78rem;color:${qac.color}">${summary.totalAssets||0} נכסים נוצרו · ${summary.funnelCoverage?.length||0} שלבי משפך · מצב: ${summary.executionMode||''} · פלטפורמה: ${summary.assetTypes?.join(', ')||''}</div>
      </div>
      ${ranking?.recommendation ? `<div style="margin-right:auto;font-size:0.8rem;color:#6366f1;font-weight:600">${ranking.recommendation}</div>` : ''}
    </div>

    ${mc.headline ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">💬 מסר מרכזי</div>
      <div style="font-size:1.1rem;font-weight:700;color:#1e293b;margin-bottom:0.4rem">${mc.headline}</div>
      ${mc.subheadline ? `<div style="font-size:0.88rem;color:#64748b;margin-bottom:0.5rem">${mc.subheadline}</div>` : ''}
      ${mc.painLine ? `<div style="background:#fef2f2;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.82rem;color:#991b1b">${mc.painLine}</div>` : ''}
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.25rem">
      <div class="card">
        <div class="card-title">🎣 Hooks (${(bundle.hooks||[]).length})</div>
        ${hooksHtml}
      </div>
      <div class="card">
        <div class="card-title">👆 CTA</div>
        ${ctaHtml || '<div style="color:#94a3b8;font-size:0.85rem">לא נוצרו CTAs</div>'}
      </div>
    </div>

    ${(bundle.ads||[]).length > 0 ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">📢 מודעות (${bundle.ads.length} וריאנטים)</div>
      ${adsHtml}
    </div>` : ''}

    ${lpHtml}
    ${emailHtml}

    ${(decisionLayer.emotionPrimary || decisionLayer.primaryAngle) ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">🧠 פרופיל החלטות</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.6rem">
        ${decisionLayer.emotionPrimary ? `<div style="background:#fdf4ff;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.8rem"><span style="color:#a21caf;font-weight:700">רגש ראשי</span><br>${decisionLayer.emotionPrimary}</div>` : ''}
        ${decisionLayer.emotionSecondary ? `<div style="background:#fdf4ff;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.8rem"><span style="color:#a21caf;font-weight:700">רגש משני</span><br>${decisionLayer.emotionSecondary}</div>` : ''}
        ${decisionLayer.primaryAngle ? `<div style="background:#eff6ff;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.8rem"><span style="color:#1d4ed8;font-weight:700">זווית ראשית</span><br>${decisionLayer.primaryAngle}</div>` : ''}
        ${decisionLayer.intensity ? `<div style="background:#f0fdf4;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.8rem"><span style="color:#15803d;font-weight:700">עוצמה</span><br>${decisionLayer.intensity}/5</div>` : ''}
        ${decisionLayer.awarenessLevel ? `<div style="background:#fefce8;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.8rem"><span style="color:#a16207;font-weight:700">מודעות</span><br>${decisionLayer.awarenessLevel}</div>` : ''}
      </div>
      ${decisionLayer.angleDistribution ? `<div style="margin-top:0.6rem;font-size:0.75rem;color:#64748b">חלוקת זוויות: ${Object.entries(decisionLayer.angleDistribution).map(([k,v])=>`${k}:${v}`).join(' · ')}</div>` : ''}
    </div>` : ''}

    ${(decisionExp.rationale || decisionExp.persuasion_logic) ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">💡 הסבר החלטות + לוגיקת שכנוע</div>
      ${decisionExp.rationale ? `<div style="font-size:0.85rem;color:#374151;margin-bottom:0.5rem;line-height:1.6">${decisionExp.rationale}</div>` : ''}
      ${decisionExp.persuasion_logic ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:0.6rem;padding:0.75rem;font-size:0.82rem;color:#14532d">${decisionExp.persuasion_logic}</div>` : ''}
      ${decisionExp.why_this_emotion ? `<div style="margin-top:0.5rem;font-size:0.78rem;color:#64748b">רגש: ${decisionExp.why_this_emotion}</div>` : ''}
      ${decisionExp.why_this_angle ? `<div style="font-size:0.78rem;color:#64748b">זווית: ${decisionExp.why_this_angle}</div>` : ''}
    </div>` : ''}

    ${!preQa.skipped && preQa.overall !== undefined ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">🔍 Pre-QA Simulation</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.6rem;margin-bottom:0.5rem">
        ${(preQa.scores ? Object.entries(preQa.scores) : []).map(([k,v]) => {
          const labels = { is_clear:'ברור?', is_strong:'חזק?', is_focused:'ממוקד?' };
          const color = v >= 7 ? '#15803d' : v >= 5 ? '#92400e' : '#991b1b';
          const bg    = v >= 7 ? '#f0fdf4' : v >= 5 ? '#fffbeb' : '#fef2f2';
          return `<div style="background:${bg};border-radius:0.5rem;padding:0.5rem;text-align:center"><div style="font-size:1.2rem;font-weight:700;color:${color}">${v}/10</div><div style="font-size:0.7rem;color:#64748b">${labels[k]||k}</div></div>`;
        }).join('')}
      </div>
      ${preQa.top_fix ? `<div style="background:#fffbeb;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.82rem;color:#92400e">💡 תיקון מרכזי: ${preQa.top_fix}</div>` : ''}
    </div>` : ''}

    ${tracking.eventMap?.length > 0 ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">📡 Tracking Layer (${tracking.eventMap.length} events)</div>
      <div style="display:flex;flex-wrap:wrap;gap:0.35rem;margin-bottom:0.5rem">
        ${(tracking.pixels || []).map(p => `<span style="background:#e0e7ff;color:#3730a3;font-size:0.72rem;padding:0.2rem 0.5rem;border-radius:0.35rem;font-weight:600">${p}</span>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.35rem">
        ${tracking.eventMap.slice(0,6).map(e => `<div style="background:#f8fafc;border-radius:0.4rem;padding:0.4rem 0.6rem;font-size:0.75rem"><span style="font-weight:600;color:#6366f1">${e.event}</span> <span style="color:#94a3b8">${e.trigger||''}</span></div>`).join('')}
      </div>
      ${tracking.eventMap.length > 6 ? `<div style="font-size:0.72rem;color:#94a3b8;margin-top:0.35rem">+ ${tracking.eventMap.length - 6} events נוספים</div>` : ''}
    </div>` : ''}

    ${qualityHtml}
    ${qaChecklistHtml}

    ${qa.flagged?.length > 0 ? `
    <div class="card" style="margin-bottom:1.25rem;border:1px solid #fde68a">
      <div class="card-title">⚠️ פריטים לתשומת לב (${qa.flagged.length})</div>
      ${qa.flagged.map(f => `
        <div style="background:${f.severity==='error'?'#fef2f2':f.severity==='warning'?'#fffbeb':'#f8fafc'};border-radius:0.5rem;padding:0.6rem 0.85rem;margin-bottom:0.4rem;font-size:0.82rem">
          <span style="font-weight:600">[${f.source}]</span> ${f.message}
          ${f.fix ? `<div style="color:#6366f1;margin-top:0.2rem;font-size:0.78rem">💡 ${f.fix}</div>` : ''}
        </div>`).join('')}
    </div>` : ''}

    <div style="display:flex;gap:0.75rem;margin-top:1rem">
      <button class="btn btn-sm btn-secondary" onclick="startExecution()">🔄 ריצה חדשה</button>
      <button class="btn btn-sm btn-gradient" onclick="startQa()" style="background:linear-gradient(135deg,#7c3aed,#db2777)">🧪 הרץ QA Agent</button>
    </div>
  `;
}

async function restoreExecutionJob() {
  try {
    const saved = JSON.parse(localStorage.getItem('lastExecutionJob') || '{}');
    if (!saved?.jobId) return;
    const jobId = saved.jobId;

    const resp   = await apiFetch(`/execution-status?jobId=${jobId}&since=0`);
    const result = await resp.json();
    if (!resp.ok) return;

    if (result.status === 'completed' && result.reportId) {
      bfsExecutionJob = { jobId, status: 'completed', reportId: result.reportId, steps: [], lastStepIndex: 0 };
      const progressArea = document.getElementById('exec-progress-area');
      if (progressArea) progressArea.style.display = '';
      _executionUpdateStatus('completed', 100);
      if (result.steps?.length) {
        result.steps.forEach(s => _executionLog(s.message, s.status === 'done' ? 'done' : 'running', s.created_at));
      }
      await _executionLoadReport(result.reportId);
    } else if (result.status === 'running' || result.status === 'queued') {
      bfsExecutionJob = { jobId, status: result.status, steps: [], lastStepIndex: 0 };
      const progressArea = document.getElementById('exec-progress-area');
      if (progressArea) progressArea.style.display = '';
      _executionUpdateStatus(result.status, result.progress || 0);
      if (result.steps?.length) {
        result.steps.forEach(s => _executionLog(s.message, s.status === 'done' ? 'done' : 'running', s.created_at));
        bfsExecutionJob.lastStepIndex = result.steps[result.steps.length - 1]?.step_index || 0;
      }
      _executionLog('🔄 מחבר מחדש לביצוע פעיל...', 'info');
      _executionStartPolling(jobId);
    }
  } catch {}
}

// ── QA Agent ──────────────────────────────────────────────────────────────────
var bfsQaJob = null; // { jobId, status, steps, lastStepIndex, pollTimer, reportId }

async function startQa() {
  const execReportId = bfsExecutionJob?.reportId || localStorage.getItem('lastExecutionReportId');
  if (!execReportId) { alert('יש להריץ סוכן ביצוע תחילה'); return; }

  const researchReportId = localStorage.getItem('lastResearchReportId') || null;

  const qaArea = document.getElementById('qa-panel-area');
  if (qaArea) { qaArea.style.display = ''; }
  const qaReport = document.getElementById('qa-report-area');
  if (qaReport) qaReport.innerHTML = '';
  _qaUpdateStatus('queued', 0);
  _qaLog('מתחיל QA Agent...', 'info');

  try {
    const resp = await apiFetch('/qa-start', {
      method: 'POST',
      body: JSON.stringify({ executionReportId: execReportId, researchReportId }),
    });
    const data = await resp.json();
    if (!resp.ok) { _qaLog(`שגיאה: ${data.error}`, 'error'); return; }

    bfsQaJob = { jobId: data.jobId, status: 'queued', steps: [], lastStepIndex: 0 };
    localStorage.setItem('lastQaJob', JSON.stringify({ jobId: data.jobId }));
    _qaStartPolling(data.jobId);
  } catch (e) { _qaLog(`שגיאה: ${e.message}`, 'error'); }
}

function _qaStartPolling(jobId) {
  if (bfsQaJob?.pollTimer) clearInterval(bfsQaJob.pollTimer);
  const timer = setInterval(async () => {
    try {
      const since  = bfsQaJob?.lastStepIndex || 0;
      const resp   = await apiFetch(`/qa-status?jobId=${jobId}&since=${since}`);
      const result = await resp.json();
      if (!resp.ok) return;

      (result.steps || []).forEach(s => {
        _qaLog(s.message, s.status === 'done' ? 'done' : 'running', s.created_at);
        if (bfsQaJob) bfsQaJob.lastStepIndex = Math.max(bfsQaJob.lastStepIndex, s.step_index);
      });

      _qaUpdateStatus(result.status, result.progress || 0);

      if (result.status === 'completed') {
        clearInterval(bfsQaJob.pollTimer);
        bfsQaJob.status   = 'completed';
        bfsQaJob.reportId = result.reportId;
        _qaUpdateStatus('completed', 100);
        if (result.reportId) await _qaLoadReport(result.reportId);
      } else if (result.status === 'failed') {
        clearInterval(bfsQaJob.pollTimer);
        _qaLog(`נכשל: ${result.errorMessage || 'שגיאה לא ידועה'}`, 'error');
        _qaUpdateStatus('failed', 0);
      }
    } catch {}
  }, 3000);
  if (bfsQaJob) bfsQaJob.pollTimer = timer;
}

function _qaUpdateStatus(status, pct) {
  const bar = document.getElementById('qa-progress-bar');
  const pctEl = document.getElementById('qa-progress-pct');
  const statusEl = document.getElementById('qa-status-label');
  if (bar)   bar.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  const labels = { queued:'ממתין...', running:'בודק נכסים...', completed:'QA הושלם', failed:'נכשל' };
  if (statusEl) statusEl.textContent = labels[status] || status;
}

function _qaLog(msg, type, ts) {
  const el = document.getElementById('qa-log');
  if (!el) return;
  const color = type === 'done' ? '#34d399' : type === 'error' ? '#f87171' : type === 'info' ? '#60a5fa' : '#94a3b8';
  const icon  = type === 'done' ? '✓' : type === 'error' ? '✗' : type === 'info' ? '→' : '…';
  el.innerHTML += `<div style="color:${color};font-size:0.78rem;padding:0.15rem 0">${icon} ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

async function _qaLoadReport(reportId) {
  try {
    const resp   = await apiFetch(`/qa-report?reportId=${reportId}`);
    const result = await resp.json();
    if (!resp.ok) return;
    _qaRenderReport(result.report);
  } catch {}
}

function _qaRenderReport(report) {
  const area = document.getElementById('qa-report-area');
  if (!area) return;

  const verdict  = report.verdict || 'improve';
  const score    = report.overall_score || 0;
  const checks   = report.checks || {};
  const sim      = report.simulation || {};
  const routing  = report.routing || {};
  const testPlan = report.test_plan || {};
  const corrections = report.corrections || [];
  const summary  = report.summary || {};

  const vColors = {
    approve: { bg:'#f0fdf4', border:'#bbf7d0', color:'#15803d', emoji:'✅', label:'מאושר לשיגור' },
    improve: { bg:'#fffbeb', border:'#fde68a', color:'#92400e', emoji:'⚠️', label:'נדרש שיפור' },
    reject:  { bg:'#fef2f2', border:'#fecaca', color:'#991b1b', emoji:'❌', label:'נדחה — שלח לתיקון' },
  };
  const vc = vColors[verdict] || vColors.improve;

  // Score bar
  const scoreColor = score >= 72 ? '#15803d' : score >= 45 ? '#d97706' : '#dc2626';

  // Checks grid — 20 checks
  const checkItems = [
    { key:'hook',               label:'הוק',           score: checks.hook?.overall_hook_score },
    { key:'pain',               label:'כאב',           score: checks.pain?.pain_score },
    { key:'differentiation',    label:'בידול',         score: checks.differentiation?.score },
    { key:'offer',              label:'הצעה',           score: checks.offer?.offer_score },
    { key:'persuasion',         label:'שכנוע',          score: checks.persuasion?.persuasion_score },
    { key:'language',           label:'שפה',            score: checks.language?.score },
    { key:'trust',              label:'אמון',           score: checks.trust?.score },
    { key:'cognitive_load',     label:'עומס קוגניטיבי',score: checks.cognitive_load?.score },
    { key:'awareness',          label:'מודעות',         score: checks.awareness?.passed ? 80 : 40 },
    { key:'tracking',           label:'Tracking',       score: checks.tracking?.ready ? 80 : 30 },
    { key:'flow',               label:'Flow E2E',       score: checks.flow?.passed ? 80 : 40 },
    { key:'kill_signals',       label:'Kill Signals',   score: checks.kill_signals?.count === 0 ? 100 : Math.max(0, 100 - (checks.kill_signals?.count||0) * 25) },
    { key:'friction',           label:'Friction',       score: checks.friction?.score },
    { key:'lp_hierarchy',       label:'LP Hierarchy',   score: checks.lp_hierarchy?.passed ? 85 : 45 },
    { key:'implementation',     label:'מוכנות',         score: checks.implementation?.readiness_score },
    { key:'message_clarity',    label:'בהירות מסר',     score: checks.message_clarity?.score },
    { key:'edge_cases',         label:'Edge Cases',     score: checks.edge_cases?.edge_case_score },
    { key:'execution_fidelity', label:'נאמנות ביצוע',   score: checks.execution_fidelity?.fidelity_score },
    { key:'business',           label:'Business Fit',   score: checks.business?.overall_business_score },
    { key:'market_saturation',  label:'Market Fit',     score: (checks.market_saturation?.issues||[]).length === 0 ? 80 : 45 },
  ];

  const checksHtml = checkItems.map(c => {
    const s = c.score ?? 50;
    const bg = s >= 70 ? '#f0fdf4' : s >= 45 ? '#fffbeb' : '#fef2f2';
    const col = s >= 70 ? '#15803d' : s >= 45 ? '#92400e' : '#991b1b';
    return `<div style="background:${bg};border-radius:0.5rem;padding:0.5rem;text-align:center">
      <div style="font-size:1rem;font-weight:700;color:${col}">${s}</div>
      <div style="font-size:0.68rem;color:#64748b">${c.label}</div>
    </div>`;
  }).join('');

  // Simulation + ROI
  const simHtml = sim.scroll_stop_probability !== undefined ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">📊 סימולציית ביצוע + ROI</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;margin-bottom:0.75rem">
        ${[
          { label:'עצירת גלילה', val: Math.round((sim.scroll_stop_probability||0)*100)+'%' },
          { label:'קליק',        val: Math.round((sim.click_probability||0)*100)+'%' },
          { label:'המרה',        val: Math.round((sim.conversion_probability||0)*100)+'%' },
        ].map(s => `<div style="background:#f8fafc;border-radius:0.6rem;padding:0.75rem;text-align:center">
          <div style="font-size:1.4rem;font-weight:700;color:#6366f1">${s.val}</div>
          <div style="font-size:0.72rem;color:#64748b">${s.label}</div>
        </div>`).join('')}
      </div>
      ${sim.roi_estimate ? `<div style="background:#f0fdf4;border-radius:0.6rem;padding:0.6rem 0.85rem;display:flex;gap:1.5rem;font-size:0.78rem;flex-wrap:wrap">
        <span>💰 CPC: ${sim.roi_estimate.estimated_cpc}</span>
        <span>📈 לידים/1K קליקים: ${sim.roi_estimate.leads_per_1k_clicks}</span>
        <span>💵 הכנסה צפויה/1K: ${sim.roi_estimate.estimated_revenue_1k}</span>
        <span style="font-weight:700;color:${sim.roi_estimate.roi_verdict==='positive'?'#15803d':sim.roi_estimate.roi_verdict==='break_even'?'#92400e':'#dc2626'}">ROAS: ${sim.roi_estimate.estimated_roas}x (${sim.roi_estimate.roi_verdict})</span>
      </div>` : ''}
      ${sim.micro_conversions ? `<div style="margin-top:0.5rem;font-size:0.74rem;color:#64748b">Micro: scroll depth ${Math.round((sim.micro_conversions.scroll_depth||0)*100)}% · זמן עמוד: ${sim.micro_conversions.time_on_page||'?'} · hover CTA: ${Math.round((sim.micro_conversions.cta_hover_chance||0)*100)}%</div>` : ''}
      <div style="margin-top:0.3rem;font-size:0.72rem;color:#94a3b8">תחזית בלבד — מבוסס ניתוח נכסים + ממוצעי שוק, לא מדד בפועל</div>
    </div>` : '';

  // Edge Cases + Business + Fidelity insights
  const edgeCasesData  = checks.edge_cases || {};
  const businessData   = checks.business || {};
  const fidelityData   = checks.execution_fidelity || {};
  const extendedHtml = (edgeCasesData.edge_case_score || businessData.roi_outlook || fidelityData.fidelity_score) ? `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1.25rem">
      ${edgeCasesData.edge_case_score !== undefined ? `<div class="card" style="margin-bottom:0">
        <div class="card-title" style="font-size:0.8rem">🚨 Edge Cases</div>
        <div style="font-size:0.75rem;color:#374151">
          <div>סקפטי: <b>${edgeCasesData.skeptic_response||'?'}</b></div>
          <div>קר: <b>${edgeCasesData.cold_user_clarity||'?'}</b></div>
          <div>ניסה: <b>${edgeCasesData.tried_before_differentiation||'?'}</b></div>
          ${edgeCasesData.intent_drift?.exists ? `<div style="color:#dc2626;margin-top:0.3rem">⚠️ Intent Drift: ${edgeCasesData.intent_drift.description||''}</div>` : '<div style="color:#15803d;margin-top:0.3rem">✓ אין Intent Drift</div>'}
        </div>
      </div>` : '<div></div>'}
      ${businessData.roi_outlook ? `<div class="card" style="margin-bottom:0">
        <div class="card-title" style="font-size:0.8rem">💰 Business + ROI</div>
        <div style="font-size:0.75rem;color:#374151">
          <div>ROI: <b style="color:${businessData.roi_outlook==='positive'?'#15803d':businessData.roi_outlook==='negative'?'#dc2626':'#92400e'}">${businessData.roi_outlook||'?'}</b></div>
          <div>Scalable: <b>${businessData.scalable?'כן':'לא'}</b></div>
          <div>Content Fatigue: <b>${businessData.fatigue_risk||'?'}</b></div>
          <div>Over-Opt: <b>${businessData.over_optimized?'כן ⚠️':'לא ✓'}</b></div>
        </div>
      </div>` : '<div></div>'}
      ${fidelityData.fidelity_score !== undefined ? `<div class="card" style="margin-bottom:0">
        <div class="card-title" style="font-size:0.8rem">🎯 נאמנות ביצוע</div>
        <div style="font-size:0.75rem;color:#374151">
          <div>זווית: <b>${fidelityData.angle_fidelity||'?'}</b></div>
          <div>רגש: <b>${fidelityData.emotion_fidelity||'?'}</b></div>
          <div>פלטפורמה: <b>${fidelityData.platform_format_fit||'?'}</b></div>
          <div>ויזואל: <b>${fidelityData.visual_platform_fit||'?'}</b></div>
        </div>
      </div>` : '<div></div>'}
    </div>` : '';

  // Corrections
  const corrHtml = corrections.length > 0 ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">🔧 הוראות תיקון (${corrections.length})</div>
      ${corrections.map(c => `
        <div style="background:${c.priority==='critical'?'#fef2f2':c.priority==='high'?'#fffbeb':'#f8fafc'};border-radius:0.5rem;padding:0.6rem 0.85rem;margin-bottom:0.4rem;font-size:0.82rem">
          <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.2rem">
            <span style="background:${c.priority==='critical'?'#dc2626':c.priority==='high'?'#d97706':'#6b7280'};color:#fff;font-size:0.65rem;padding:1px 6px;border-radius:9999px">${c.priority}</span>
            <span style="font-weight:600">[${c.asset}]</span> ${c.issue}
          </div>
          <div style="color:#6366f1;font-size:0.78rem">💡 ${c.fix}</div>
          ${c.example ? `<div style="color:#94a3b8;font-size:0.72rem;margin-top:0.2rem">${c.example}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  // Routing
  const routingHtml = routing.should_redo ? `
    <div class="card" style="margin-bottom:1.25rem;border:2px solid ${routing.priority==='full_rerun'?'#dc2626':'#d97706'}">
      <div class="card-title">🔁 ניתוב — שלח ל${routing.target_agent === 'execution' ? 'סוכן ביצוע' : 'סוכן אסטרטגיה'}</div>
      <div style="font-size:0.85rem;color:#374151;margin-bottom:0.5rem">${routing.reason}</div>
      ${(routing.instructions || []).slice(0,4).map(i => `
        <div style="display:flex;gap:0.4rem;align-items:flex-start;margin-bottom:0.3rem;font-size:0.8rem">
          <span style="color:${i.priority==='critical'?'#dc2626':'#d97706'};font-size:0.9rem">→</span>
          <span>${i.instruction}</span>
        </div>`).join('')}
      ${routing.target_agent === 'execution' ? `<button class="btn btn-sm" style="margin-top:0.75rem;background:#7c3aed;color:#fff" onclick="startExecution()">🔄 הרץ מחדש סוכן ביצוע</button>` : ''}
    </div>` : '';

  // Test plan
  const testHtml = (testPlan.tests || []).length > 0 ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">🧪 תוכנית A/B Testing (${testPlan.tests.length} בדיקות)</div>
      ${(testPlan.tests || []).map(t => `
        <div style="border:1px solid #e2e8f0;border-radius:0.6rem;padding:0.75rem;margin-bottom:0.5rem;font-size:0.82rem">
          <div style="font-weight:700;margin-bottom:0.3rem">${t.variable} <span style="background:${t.priority==='high'?'#dcfce7':'#fef9c3'};color:${t.priority==='high'?'#15803d':'#a16207'};font-size:0.68rem;padding:1px 6px;border-radius:9999px">${t.priority}</span></div>
          <div style="color:#64748b;margin-bottom:0.2rem">${t.hypothesis}</div>
          <div style="font-size:0.75rem;color:#94a3b8">מדד: ${t.metric}</div>
        </div>`).join('')}
      ${testPlan.estimatedBudget ? `<div style="font-size:0.75rem;color:#6366f1;margin-top:0.25rem">תקציב מומלץ: ${testPlan.estimatedBudget.recommended_total} · ${testPlan.estimatedBudget.note}</div>` : ''}
    </div>` : '';

  area.innerHTML = `
    <div style="background:${vc.bg};border:2px solid ${vc.border};border-radius:1rem;padding:1rem 1.25rem;margin-bottom:1.5rem;display:flex;align-items:center;gap:0.75rem">
      <span style="font-size:2rem">${vc.emoji}</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:1rem;color:${vc.color}">QA Agent — ${vc.label}</div>
        <div style="font-size:0.78rem;color:${vc.color}">עבר ${summary.passed||0}/${summary.totalChecks||12} בדיקות · ${summary.kill_signals||0} Kill Signals · ${summary.corrections_needed||0} תיקונים</div>
      </div>
      <div style="background:#fff;border-radius:0.75rem;padding:0.5rem 1rem;text-align:center;min-width:70px">
        <div style="font-size:1.6rem;font-weight:700;color:${scoreColor}">${score}</div>
        <div style="font-size:0.65rem;color:#94a3b8">ציון כולל</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">📋 12 בדיקות איכות</div>
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:0.5rem">
        ${checksHtml}
      </div>
    </div>

    ${simHtml}
    ${extendedHtml}
    ${corrHtml}
    ${routingHtml}
    ${testHtml}

    ${(report.all_issues || []).length > 0 ? `
    <div class="card" style="margin-bottom:1.25rem">
      <div class="card-title">⚠️ כל הבעיות שנמצאו (${report.all_issues.length})</div>
      ${(report.all_issues || []).map(i => `
        <div style="background:${i.severity==='critical'?'#fef2f2':i.severity==='high'?'#fffbeb':'#f8fafc'};border-radius:0.4rem;padding:0.4rem 0.75rem;margin-bottom:0.3rem;font-size:0.79rem">
          <span style="font-weight:600;color:#64748b">[${i.source}]</span> ${i.issue}
          ${i.fix ? `<div style="color:#6366f1;font-size:0.74rem">→ ${i.fix}</div>` : ''}
        </div>`).join('')}
    </div>` : ''}

    <div style="display:flex;gap:0.75rem;margin-top:1rem">
      <button class="btn btn-sm btn-secondary" onclick="startQa()">🔄 הרץ QA מחדש</button>
    </div>
  `;
}

async function restoreQaJob() {
  try {
    const saved = JSON.parse(localStorage.getItem('lastQaJob') || '{}');
    if (!saved?.jobId) return;
    const jobId = saved.jobId;
    const resp   = await apiFetch(`/qa-status?jobId=${jobId}&since=0`);
    const result = await resp.json();
    if (!resp.ok) return;
    const qaArea = document.getElementById('qa-panel-area');
    if (qaArea) qaArea.style.display = '';
    if (result.status === 'completed' && result.reportId) {
      bfsQaJob = { jobId, status: 'completed', reportId: result.reportId, steps: [], lastStepIndex: 0 };
      _qaUpdateStatus('completed', 100);
      (result.steps || []).forEach(s => _qaLog(s.message, 'done', s.created_at));
      await _qaLoadReport(result.reportId);
    } else if (result.status === 'running' || result.status === 'queued') {
      bfsQaJob = { jobId, status: result.status, steps: [], lastStepIndex: 0 };
      _qaUpdateStatus(result.status, result.progress || 0);
      (result.steps || []).forEach(s => {
        _qaLog(s.message, s.status === 'done' ? 'done' : 'running', s.created_at);
        bfsQaJob.lastStepIndex = Math.max(bfsQaJob.lastStepIndex, s.step_index);
      });
      _qaLog('🔄 מחבר מחדש ל-QA פעיל...', 'info');
      _qaStartPolling(jobId);
    }
  } catch {}
}

// ══════════════════════════════════════════════════════════════════════════════
// Analysis Agent
// ══════════════════════════════════════════════════════════════════════════════

function _buildAnalysisPanel() {
  const campaigns = state.campaigns || [];
  const campaignOptions = campaigns.length
    ? campaigns.map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join('')
    : '<option value="">אין קמפיינים — צור קמפיין תחילה</option>';

  return `
    <div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:1.25rem;padding:1.75rem;margin-top:0.5rem">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.25rem">
        <span style="font-size:2rem">📊</span>
        <div>
          <div style="font-weight:800;font-size:1.15rem;color:#1e293b">סוכן ניתוח</div>
          <div style="font-size:0.82rem;color:#64748b">ניתוח ביצועים עמוק — KPI, סיבתיות, אנומליות, תובנות ועוד</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
        <div>
          <label style="font-size:0.8rem;font-weight:600;color:#374151;display:block;margin-bottom:0.4rem">קמפיין לניתוח</label>
          <select id="analysis-campaign-select" style="width:100%;padding:0.5rem 0.75rem;border:1.5px solid #e2e8f0;border-radius:0.5rem;font-size:0.85rem">
            ${campaignOptions}
          </select>
        </div>
        <div>
          <label style="font-size:0.8rem;font-weight:600;color:#374151;display:block;margin-bottom:0.4rem">מטרת הקמפיין</label>
          <select id="analysis-goal-select" style="width:100%;padding:0.5rem 0.75rem;border:1.5px solid #e2e8f0;border-radius:0.5rem;font-size:0.85rem">
            <option value="leads">לידים (CPL)</option>
            <option value="sales">מכירות (ROAS)</option>
            <option value="content">תוכן (Engagement)</option>
            <option value="awareness">מודעות (CPM)</option>
            <option value="traffic">תנועה (CPC)</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:1rem">
        <label style="font-size:0.8rem;font-weight:600;color:#374151;display:block;margin-bottom:0.4rem">שאלה ספציפית (אופציונלי)</label>
        <input id="analysis-query-input" type="text" placeholder='למשל: "למה ה-CTR ירד?" או "מה הפלטפורמה הטובה ביותר?"'
               style="width:100%;padding:0.5rem 0.75rem;border:1.5px solid #e2e8f0;border-radius:0.5rem;font-size:0.85rem;box-sizing:border-box">
      </div>

      <button class="btn btn-gradient w-full" onclick="startAnalysis()" style="background:linear-gradient(135deg,#0ea5e9,#6366f1)">
        📊 הרץ Analysis Agent
      </button>

      <div id="analysis-panel-area" style="display:none;margin-top:1.5rem"></div>
    </div>`;
}

async function startAnalysis() {
  const campaignId = document.getElementById('analysis-campaign-select')?.value;
  const goal       = document.getElementById('analysis-goal-select')?.value || 'leads';
  const query      = document.getElementById('analysis-query-input')?.value?.trim() || '';

  if (!campaignId) { toast('בחר קמפיין לניתוח', 'error'); return; }

  const area = document.getElementById('analysis-panel-area');
  if (!area) return;

  area.style.display = 'block';
  area.innerHTML = `<div style="text-align:center;padding:1.5rem;color:#6366f1;font-size:0.9rem">מתחיל ניתוח...</div>`;

  try {
    const token = state.accessToken;
    const res   = await fetch(`${CONFIG.apiBase}/analysis-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ campaignId, goal, query }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'שגיאה בהתחלת ניתוח', 'error'); return; }

    bfsAnalysisJob = { jobId: data.jobId, status: 'pending', steps: [], lastStepIndex: 0, pollTimer: null, reportId: null };
    _analysisLog('⚙️ ניתוח התחיל...', 'info');
    _analysisStartPolling(data.jobId);
  } catch (e) {
    toast('שגיאה בהתחלת ניתוח: ' + e.message, 'error');
  }
}

function _analysisLog(message, type = 'info') {
  const area = document.getElementById('analysis-panel-area');
  if (!area) return;
  const colors = { info: '#3b82f6', success: '#10b981', error: '#ef4444', warn: '#f59e0b' };
  const existing = area.querySelector('.analysis-log-box');
  if (!existing) {
    area.innerHTML = `<div class="analysis-log-box" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:0.75rem;padding:1rem;max-height:280px;overflow-y:auto;font-family:monospace;font-size:0.78rem"></div>`;
  }
  const box = area.querySelector('.analysis-log-box');
  if (!box) return;
  const line = document.createElement('div');
  line.style.cssText = `color:${colors[type] || '#374151'};padding:2px 0;border-bottom:1px solid #f1f5f9`;
  line.textContent = `[${new Date().toLocaleTimeString('he-IL')}] ${message}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

function _analysisStartPolling(jobId) {
  if (bfsAnalysisJob?.pollTimer) clearInterval(bfsAnalysisJob.pollTimer);
  bfsAnalysisJob.pollTimer = setInterval(() => _analysisPoll(jobId), 2500);
}

async function _analysisPoll(jobId) {
  try {
    const since = bfsAnalysisJob?.lastStepIndex || 0;
    const token = state.accessToken;
    const res   = await fetch(`${CONFIG.apiBase}/analysis-status?jobId=${jobId}&since=${since}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();

    (data.steps || []).forEach(s => {
      _analysisLog(`${s.step_key}: ${s.message}`, 'info');
      if (s.step_index > (bfsAnalysisJob?.lastStepIndex || 0)) {
        if (bfsAnalysisJob) bfsAnalysisJob.lastStepIndex = s.step_index;
      }
    });

    if (data.progress !== undefined) {
      const area = document.getElementById('analysis-panel-area');
      const prog = area?.querySelector('.analysis-progress-bar');
      if (prog) prog.style.width = `${data.progress}%`;
      else if (area) {
        const bar = document.createElement('div');
        bar.style.cssText = 'height:4px;background:#e2e8f0;border-radius:9999px;margin-bottom:0.75rem;overflow:hidden';
        bar.innerHTML = `<div class="analysis-progress-bar" style="height:100%;background:linear-gradient(90deg,#0ea5e9,#6366f1);width:${data.progress}%;transition:width 0.5s;border-radius:9999px"></div>`;
        area.insertBefore(bar, area.firstChild);
      }
    }

    if (data.status === 'completed') {
      clearInterval(bfsAnalysisJob?.pollTimer);
      bfsAnalysisJob = { ...bfsAnalysisJob, status: 'completed', reportId: data.reportId };
      _analysisLog('✅ ניתוח הושלם!', 'success');
      if (data.reportId) {
        await _renderAnalysisReport(data.reportId);
      }
    } else if (data.status === 'failed') {
      clearInterval(bfsAnalysisJob?.pollTimer);
      _analysisLog(`❌ ניתוח נכשל: ${data.errorMessage || 'שגיאה לא ידועה'}`, 'error');
    }
  } catch (e) {
    console.warn('[analysis-poll]', e.message);
  }
}

async function _renderAnalysisReport(reportId) {
  const area = document.getElementById('analysis-panel-area');
  if (!area) return;

  try {
    const token = state.accessToken;
    const res   = await fetch(`${CONFIG.apiBase}/analysis-report?reportId=${reportId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok || !data.report) { _analysisLog('שגיאה בטעינת הדוח', 'error'); return; }

    const r = data.report;
    const scores         = r.scores || {};
    const kpi            = r.kpi_hierarchy || {};
    const anomalies      = r.anomalies || {};
    const insights       = r.insights || {};
    const causality      = r.causality || {};
    const social         = r.social || {};
    const queryResult    = r.query_result;
    const aiNarrative    = r.ai_narrative;
    const unified        = r.unified || {};
    const recommendations = r.recommendations || [];
    // Extended sections
    const funnel         = r.funnel || {};
    const trends         = r.trends || {};
    const attribution    = r.attribution || {};
    const business       = r.business || {};
    const experimentsObj = r.experiments || {};
    const alertsObj      = r.alerts || {};
    const tradeoffs      = r.tradeoffs || {};
    const patterns       = r.patterns || {};
    const priorityActions = r.priority_actions || [];
    const uncertainty    = r.uncertainty || {};

    const verdictLabel = scores.verdict === 'healthy' ? 'תקין' : scores.verdict === 'needs_improvement' ? 'נדרש שיפור' : 'קריטי';

    let html = `
      <div style="margin-top:1rem;display:flex;flex-direction:column;gap:1rem">

        <!-- Score header -->
        <div style="background:linear-gradient(135deg,#0ea5e9,#6366f1);border-radius:1rem;padding:1.25rem;color:#fff;text-align:center">
          <div style="font-size:2.5rem;font-weight:800">${scores.overall || 0}/100</div>
          <div style="font-size:1rem;font-weight:600;margin-top:0.25rem">ניתוח ביצועים — ${verdictLabel}</div>
          ${aiNarrative?.narrative || insights.narrative ? `<div style="font-size:0.82rem;margin-top:0.5rem;opacity:0.9">${(aiNarrative?.narrative || insights.narrative || '').slice(0, 120)}</div>` : ''}
        </div>

        <!-- Key metrics -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem">
          ${_analysisMetricCard('חשיפות', _fmtNum(unified.impressions))}
          ${_analysisMetricCard('קליקים', _fmtNum(unified.clicks))}
          ${_analysisMetricCard('CTR', _fmtPct(unified.ctr))}
          ${_analysisMetricCard('ROAS', unified.roas ? `${unified.roas.toFixed(2)}x` : 'N/A')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.75rem">
          ${_analysisMetricCard('המרות', _fmtNum(unified.conversions))}
          ${_analysisMetricCard('שיעור המרה', _fmtPct(unified.conversion_rate))}
          ${_analysisMetricCard('CPA', unified.cpa ? `$${unified.cpa.toFixed(2)}` : 'N/A')}
          ${_analysisMetricCard('הוצאה', unified.cost ? `$${unified.cost.toFixed(0)}` : 'N/A')}
        </div>

        <!-- KPI Hierarchy -->
        ${kpi.primary ? `
        <div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:0.75rem;padding:1rem">
          <div style="font-weight:700;color:#1e293b;margin-bottom:0.75rem">יעדי KPI — ${kpi.goal || ''}</div>
          <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;background:#f0f9ff;border-radius:0.5rem;margin-bottom:0.5rem">
            <div style="font-size:1.5rem">🎯</div>
            <div style="flex:1">
              <div style="font-weight:600;font-size:0.85rem">${kpi.primary.label}</div>
              <div style="font-size:1.1rem;font-weight:800;color:#0ea5e9">${kpi.primary.value !== null && kpi.primary.value !== undefined ? (typeof kpi.primary.value === 'number' ? kpi.primary.value.toFixed(2) : kpi.primary.value) : 'N/A'}</div>
            </div>
            <div style="padding:0.3rem 0.75rem;border-radius:9999px;font-size:0.75rem;font-weight:700;background:${ ['excellent','on_target'].includes(kpi.primary.status) ? '#dcfce7' : '#fee2e2' };color:${ ['excellent','on_target'].includes(kpi.primary.status) ? '#16a34a' : '#dc2626' }">
              ${ kpi.primary.status === 'excellent' ? 'מצוין' : kpi.primary.status === 'on_target' ? 'ביעד' : kpi.primary.status === 'no_data' ? 'אין נתונים' : 'מתחת ליעד' }
            </div>
          </div>
          ${(kpi.secondary || []).map(s => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.5rem;border-bottom:1px solid #f1f5f9;font-size:0.8rem">
              <span style="color:#64748b">${s.label}</span>
              <span style="font-weight:600">${s.value !== null ? (typeof s.value === 'number' ? s.value.toFixed(3) : s.value) : 'N/A'}</span>
            </div>`).join('')}
          <div style="margin-top:0.5rem;text-align:center">
            <span style="padding:0.3rem 1rem;border-radius:9999px;font-size:0.8rem;font-weight:700;background:${kpi.goal_verdict==='on_track'?'#dcfce7':kpi.goal_verdict==='at_risk'?'#fef3c7':'#fee2e2'};color:${kpi.goal_verdict==='on_track'?'#16a34a':kpi.goal_verdict==='at_risk'?'#d97706':'#dc2626'}">
              ${kpi.goal_verdict === 'on_track' ? '✅ ביעד' : kpi.goal_verdict === 'at_risk' ? '⚠️ בסיכון' : '❌ לא ביעד'} — ציון מטרה: ${kpi.goal_score || 0}/100
            </span>
          </div>
        </div>` : ''}

        <!-- Anomalies -->
        ${anomalies.has_anomalies ? `
        <div style="background:#fff5f5;border:1.5px solid #fca5a5;border-radius:0.75rem;padding:1rem">
          <div style="font-weight:700;color:#dc2626;margin-bottom:0.75rem">⚠️ אנומליות שזוהו (${anomalies.count})</div>
          ${(anomalies.signals || []).slice(0,4).map(a => `
            <div style="padding:0.6rem;background:#fff;border-radius:0.5rem;margin-bottom:0.5rem;border-left:3px solid ${a.priority==='critical'?'#ef4444':'#f59e0b'}">
              <div style="font-size:0.82rem;font-weight:600;color:#1e293b">${a.message}</div>
              <div style="font-size:0.75rem;color:#64748b;margin-top:0.2rem">פעולה: ${a.action}</div>
            </div>`).join('')}
        </div>` : `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:0.75rem;padding:0.75rem;text-align:center;font-size:0.85rem;color:#16a34a">✅ לא זוהו אנומליות</div>`}

        <!-- Causality -->
        ${(causality.chains || []).length ? `
        <div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:0.75rem;padding:1rem">
          <div style="font-weight:700;color:#1e293b;margin-bottom:0.75rem">🔗 ניתוח סיבתי</div>
          ${(causality.chains || []).map(c => `
            <div style="padding:0.6rem;background:#f8fafc;border-radius:0.5rem;margin-bottom:0.5rem">
              <div style="font-size:0.82rem;font-weight:600;color:#0ea5e9">${c.change}</div>
              <div style="font-size:0.78rem;color:#374151;margin-top:0.2rem">${c.reason}</div>
              <div style="font-size:0.75rem;color:#64748b;margin-top:0.2rem">השפעה: ${c.impact}</div>
            </div>`).join('')}
        </div>` : ''}

        <!-- Top Insights -->
        ${(insights.priorities || []).length ? `
        <div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:0.75rem;padding:1rem">
          <div style="font-weight:700;color:#1e293b;margin-bottom:0.75rem">💡 תובנות מרכזיות</div>
          ${(insights.priorities || []).slice(0,5).map(ins => `
            <div style="padding:0.6rem;background:${ins.priority==='critical'?'#fff5f5':ins.priority==='high'?'#fffbeb':'#f8fafc'};border-radius:0.5rem;margin-bottom:0.5rem;border-left:3px solid ${ins.priority==='critical'?'#ef4444':ins.priority==='high'?'#f59e0b':'#6366f1'}">
              <div style="font-size:0.82rem;font-weight:600;color:#1e293b">${ins.what}</div>
              <div style="font-size:0.78rem;color:#374151;margin-top:0.2rem">${ins.why}</div>
              <div style="font-size:0.75rem;color:#64748b;font-style:italic;margin-top:0.2rem">${ins.impact}</div>
            </div>`).join('')}
        </div>` : ''}

        <!-- Social Growth -->
        ${social.has_social_data ? `
        <div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:0.75rem;padding:1rem">
          <div style="font-weight:700;color:#1e293b;margin-bottom:0.75rem">📱 גידול מדיה חברתית</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem">
            ${_analysisMetricCard('עוקבים', _fmtNum(social.combined?.total_followers))}
            ${_analysisMetricCard('פלטפורמות גדלות', social.combined?.platforms_growing + '/' + social.combined?.platforms_total)}
            ${_analysisMetricCard('מעורבות ממוצעת', _fmtPct(social.combined?.avg_engagement_rate))}
          </div>
        </div>` : ''}

        <!-- Query answer -->
        ${queryResult ? `
        <div style="background:#eff6ff;border:1.5px solid #93c5fd;border-radius:0.75rem;padding:1rem">
          <div style="font-weight:700;color:#1e40af;margin-bottom:0.5rem">🔍 תשובה לשאלתך</div>
          <div style="font-size:0.88rem;color:#1e293b">${queryResult.answer}</div>
          <div style="font-size:0.72rem;color:#64748b;margin-top:0.4rem">רמת ביטחון: ${Math.round((queryResult.confidence || 0) * 100)}%</div>
        </div>` : ''}

        <!-- Recommendations -->
        ${recommendations.length ? `
        <div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:0.75rem;padding:1rem">
          <div style="font-weight:700;color:#1e293b;margin-bottom:0.75rem">🎯 המלצות לפעולה</div>
          ${recommendations.slice(0,5).map((rec,i) => `
            <div style="display:flex;gap:0.75rem;padding:0.6rem;background:#f8fafc;border-radius:0.5rem;margin-bottom:0.5rem">
              <div style="min-width:1.5rem;height:1.5rem;background:#6366f1;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700">${i+1}</div>
              <div style="flex:1">
                <div style="font-size:0.82rem;font-weight:600;color:#1e293b">${rec.issue}</div>
                <div style="font-size:0.75rem;color:#374151;margin-top:0.15rem">${rec.rootCause || ''}</div>
                <div style="font-size:0.75rem;color:#6366f1;font-weight:600;margin-top:0.15rem">${rec.action || ''}</div>
              </div>
              <div style="font-size:0.72rem;color:#64748b;white-space:nowrap">דחיפות: ${rec.urgency || 0}%</div>
            </div>`).join('')}
        </div>` : ''}

        <!-- Re-run -->
        <div style="text-align:center;margin-top:0.5rem">
          <button class="btn btn-sm btn-secondary" onclick="startAnalysis()">🔄 הרץ ניתוח מחדש</button>
        </div>
      </div>`;

    // Replace log box with full report
    area.innerHTML = html;
  } catch (e) {
    _analysisLog('שגיאה בטעינת דוח: ' + e.message, 'error');
  }
}

function _analysisMetricCard(label, value) {
  return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:0.5rem;padding:0.6rem;text-align:center">
    <div style="font-size:0.72rem;color:#64748b">${label}</div>
    <div style="font-size:1rem;font-weight:700;color:#1e293b;margin-top:0.15rem">${value || 'N/A'}</div>
  </div>`;
}

function _fmtNum(v) { if (!v) return '0'; if (v >= 1000000) return (v/1000000).toFixed(1)+'M'; if (v >= 1000) return (v/1000).toFixed(1)+'K'; return Math.round(v).toString(); }
function _fmtPct(v) { return v ? `${(v*100).toFixed(2)}%` : '0%'; }

async function restoreAnalysisJob() {
  try {
    if (!bfsAnalysisJob?.jobId) return;
    if (bfsAnalysisJob.status === 'completed' && bfsAnalysisJob.reportId) {
      await _renderAnalysisReport(bfsAnalysisJob.reportId);
      return;
    }
    if (['pending', 'running'].includes(bfsAnalysisJob.status)) {
      const area = document.getElementById('analysis-panel-area');
      if (area) { area.style.display = 'block'; area.innerHTML = `<div class="analysis-log-box" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:0.75rem;padding:1rem;font-family:monospace;font-size:0.78rem"></div>`; }
      _analysisLog('🔄 מחבר מחדש לניתוח פעיל...', 'info');
      _analysisStartPolling(bfsAnalysisJob.jobId);
    }
  } catch {}
}

// ── Orchestration Panel ───────────────────────────────────────────────────────
function renderOrchestrationPanel() {
  const campaigns = state.campaigns || [];
  const campaignOptions = campaigns.length
    ? campaigns.map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join('')
    : '<option value="">אין קמפיינים — הוסף קמפיין תחילה</option>';

  return `
    <div class="card" style="margin-top:1.5rem">
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
        <span style="font-size:2rem">🎭</span>
        <div>
          <div style="font-weight:800;font-size:1.15rem;color:#1e293b">שכבת אורקסטרציה</div>
          <div style="font-size:0.82rem;color:#64748b">ניהול סשן מרובה-סוכנים: מחקר → אסטרטגיה → ביצוע → QA → ניתוח בתיאום מלא</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
        <div>
          <label style="font-size:0.8rem;font-weight:600;color:#374151;display:block;margin-bottom:0.4rem">קמפיין</label>
          <select id="orch-campaign-select" style="width:100%;padding:0.5rem 0.75rem;border:1.5px solid #e2e8f0;border-radius:0.5rem;font-size:0.85rem">
            ${campaignOptions}
          </select>
        </div>
        <div>
          <label style="font-size:0.8rem;font-weight:600;color:#374151;display:block;margin-bottom:0.4rem">פעולה</label>
          <select id="orch-action-select" style="width:100%;padding:0.5rem 0.75rem;border:1.5px solid #e2e8f0;border-radius:0.5rem;font-size:0.85rem">
            <option value="analysis">ניתוח ביצועים</option>
            <option value="research">מחקר שוק</option>
            <option value="strategy">בניית אסטרטגיה</option>
            <option value="execution">ביצוע נכסים</option>
            <option value="qa">בדיקת QA</option>
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
        <div>
          <label style="font-size:0.8rem;font-weight:600;color:#374151;display:block;margin-bottom:0.4rem">מטרת קמפיין</label>
          <select id="orch-goal-select" style="width:100%;padding:0.5rem 0.75rem;border:1.5px solid #e2e8f0;border-radius:0.5rem;font-size:0.85rem">
            <option value="leads">לידים</option>
            <option value="sales">מכירות</option>
            <option value="followers">עוקבים</option>
            <option value="conversion_improvement">שיפור המרה</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.8rem;font-weight:600;color:#374151;display:block;margin-bottom:0.4rem">רמת אוטומציה</label>
          <select id="orch-auto-select" style="width:100%;padding:0.5rem 0.75rem;border:1.5px solid #e2e8f0;border-radius:0.5rem;font-size:0.85rem">
            <option value="semi" selected>חצי-אוטומטי (מומלץ)</option>
            <option value="auto">אוטומטי מלא</option>
            <option value="manual">ידני</option>
          </select>
        </div>
      </div>

      <button class="btn btn-gradient w-full" onclick="startOrchestration()"
              style="background:linear-gradient(135deg,#7c3aed,#4f46e5)">
        🎭 הפעל אורקסטרציה
      </button>

      <div id="orch-panel-area" style="display:none;margin-top:1.5rem"></div>
    </div>`;
}

async function startOrchestration() {
  const campaignId      = document.getElementById('orch-campaign-select')?.value;
  const action          = document.getElementById('orch-action-select')?.value || 'analysis';
  const goalType        = document.getElementById('orch-goal-select')?.value || 'leads';
  const automationLevel = document.getElementById('orch-auto-select')?.value || 'semi';

  if (!campaignId) { toast('בחר קמפיין', 'error'); return; }

  const area = document.getElementById('orch-panel-area');
  if (!area) return;
  area.style.display = 'block';
  area.innerHTML = `<div style="text-align:center;padding:1.5rem;color:#7c3aed;font-size:0.9rem;animation:pulse 1.5s infinite">🎭 מפעיל אורקסטרציה...</div>`;

  try {
    const token = state.accessToken;
    const res = await fetch(`${CONFIG.apiBase}/orchestrate-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        campaignId,
        action,
        automationLevel,
        goal: { type: goalType, target: 100, timeframe: '30d', metric: goalType },
        analysisData: action === 'analysis' ? {
          source: 'meta',
          campaign: { name: campaignId, objective: goalType, currency: 'ILS' }
        } : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'שגיאה בהפעלת אורקסטרציה', 'error'); return; }

    bfsOrchestrationJob = { jobId: data.jobId, status: 'pending', pollTimer: null, result: null };
    _orchLog('⚙️ אורקסטרציה התחילה — jobId: ' + data.jobId, 'info');
    _orchStartPolling(data.jobId);
  } catch (e) {
    toast('שגיאה: ' + e.message, 'error');
  }
}

function _orchLog(message, type = 'info') {
  const area = document.getElementById('orch-panel-area');
  if (!area) return;
  const colors = { info: '#7c3aed', success: '#10b981', error: '#ef4444', warn: '#f59e0b' };
  let box = area.querySelector('.orch-log-box');
  if (!box) {
    area.innerHTML = `<div class="orch-log-box" style="background:#faf5ff;border:1.5px solid #e9d5ff;border-radius:0.75rem;padding:1rem;max-height:320px;overflow-y:auto;font-family:monospace;font-size:0.78rem"></div>`;
    box = area.querySelector('.orch-log-box');
  }
  const ts = new Date().toLocaleTimeString('he-IL');
  box.innerHTML += `<div style="color:${colors[type]};padding:2px 0">[${ts}] ${message}</div>`;
  box.scrollTop = box.scrollHeight;
}

function _orchStartPolling(jobId) {
  if (bfsOrchestrationJob?.pollTimer) clearInterval(bfsOrchestrationJob.pollTimer);
  bfsOrchestrationJob.pollTimer = setInterval(() => _orchPoll(jobId), 3000);
}

async function _orchPoll(jobId) {
  try {
    const token = state.accessToken;
    const res = await fetch(`${CONFIG.apiBase}/orchestrate-status?jobId=${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) return;

    if (data.status === 'running' && bfsOrchestrationJob?.status !== 'running') {
      if (bfsOrchestrationJob) bfsOrchestrationJob.status = 'running';
      _orchLog('🔄 אורקסטרציה רצה...', 'info');
    }

    if (data.status === 'completed') {
      clearInterval(bfsOrchestrationJob?.pollTimer);
      if (bfsOrchestrationJob) { bfsOrchestrationJob.status = 'completed'; bfsOrchestrationJob.result = data.result; }
      _orchLog('✅ האורקסטרציה הושלמה', 'success');
      _orchRenderResult(data);
    } else if (data.status === 'failed') {
      clearInterval(bfsOrchestrationJob?.pollTimer);
      if (bfsOrchestrationJob) bfsOrchestrationJob.status = 'failed';
      _orchLog('❌ שגיאה: ' + (data.error || 'כשל לא ידוע'), 'error');
    }
  } catch {}
}

function _orchRenderResult(data) {
  const area = document.getElementById('orch-panel-area');
  if (!area) return;
  const result = data.result || {};
  const state_val = result.state || 'unknown';
  const summary   = result.summary || 'הושלם';
  const nextAction = result.nextAction || {};
  const pending = (result.pendingApprovals || []).length;

  const approvalSection = pending > 0 ? `
    <div style="margin-top:1rem;padding:1rem;background:#fef3c7;border:1.5px solid #f59e0b;border-radius:0.75rem">
      <div style="font-weight:700;color:#92400e;margin-bottom:0.5rem">⚠️ ${pending} בקשת אישור ממתינה</div>
      ${(result.pendingApprovals || []).map(card => `
        <div style="background:#fff;border-radius:0.5rem;padding:0.75rem;margin-top:0.5rem">
          <div style="font-weight:600;color:#1e293b">${card.solution || ''}</div>
          <div style="font-size:0.78rem;color:#64748b;margin-top:0.25rem">${card.why || ''}</div>
          <div style="font-size:0.75rem;color:#94a3b8;margin-top:0.25rem">סיכון: ${card.riskLevel || ''} | סוכן: ${card.agent || ''}</div>
        </div>
      `).join('')}
    </div>` : '';

  const box = area.querySelector('.orch-log-box');
  if (box) {
    box.insertAdjacentHTML('afterend', `
      <div style="margin-top:1rem;padding:1.25rem;background:linear-gradient(135deg,#f5f3ff,#ede9fe);border:1.5px solid #c4b5fd;border-radius:0.75rem">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
          <span style="font-size:1.5rem">🎭</span>
          <div style="font-weight:700;font-size:1rem;color:#4c1d95">תוצאת האורקסטרציה</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
          <div style="background:#fff;border-radius:0.5rem;padding:0.75rem;text-align:center">
            <div style="font-size:0.72rem;color:#64748b;margin-bottom:0.2rem">מצב</div>
            <div style="font-weight:700;color:#7c3aed;font-size:0.9rem">${state_val}</div>
          </div>
          <div style="background:#fff;border-radius:0.5rem;padding:0.75rem;text-align:center">
            <div style="font-size:0.72rem;color:#64748b;margin-bottom:0.2rem">הפעולה הבאה</div>
            <div style="font-weight:700;color:#4f46e5;font-size:0.85rem">${nextAction.type || '—'}</div>
          </div>
        </div>
        <div style="margin-top:0.75rem;font-size:0.82rem;color:#374151;background:#fff;border-radius:0.5rem;padding:0.75rem">${summary}</div>
        ${approvalSection}
      </div>
    `);
  }
}

// ── Barrel Effect + Campaign Score ───────────────────────────────────────────
async function loadBarrelAndScore() {
  if (!state.currentCampaignId && !state.campaigns?.[0]?.id) return;
  const campaignId = state.currentCampaignId || state.campaigns[0]?.id;
  try {
    const res = await api('GET', `campaign-score?campaignId=${campaignId}`);
    if (!res || res.empty) return;

    // Score card
    const scoreCard = document.getElementById('score-card');
    if (scoreCard) {
      const s = res.score;
      const color = s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444';
      scoreCard.style.display = '';
      scoreCard.innerHTML = `
        <div class="card-title flex items-center justify-between">
          <span>ציון קמפיין</span>
          <span style="font-size:1.4rem;font-weight:800;color:${color}">${s}/100</span>
        </div>
        <div style="background:#f1f5f9;border-radius:999px;height:8px;margin-bottom:0.75rem">
          <div style="width:${s}%;height:8px;border-radius:999px;background:${color};transition:width 0.6s"></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.5rem;text-align:center;font-size:0.75rem">
          ${[['CTR', res.ctr_score],['גלילה', res.scroll_score],['טופס', res.form_score],['המרה', res.conversion_score]].map(([l,v])=>`
            <div style="padding:0.4rem;background:${v>=70?'#dcfce7':v>=40?'#fef3c7':'#fee2e2'};border-radius:8px">
              <div style="font-weight:700;color:${v>=70?'#16a34a':v>=40?'#d97706':'#dc2626'}">${v}</div>
              <div style="color:#64748b">${l}</div>
            </div>`).join('')}
        </div>
        ${res.benchmark ? `<div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #e2e8f0">
          <div style="font-size:0.7rem;color:#94a3b8;margin-bottom:0.4rem">השוואה לממוצע בתעשייה:</div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            ${Object.entries(res.benchmark).map(([k,b])=>{
              const labels={ctr:'CTR',scroll:'גלילה',conversion:'המרה'};
              const better = b.yours >= b.good;
              const same   = b.yours >= b.avg;
              return `<span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:${better?'#dcfce7':same?'#fef3c7':'#fee2e2'};color:${better?'#16a34a':same?'#d97706':'#dc2626'}">
                ${labels[k]||k}: ${better?'↑ מעל ממוצע':same?'≈ ממוצע':'↓ מתחת ממוצע'}
              </span>`;
            }).join('')}
          </div>
        </div>` : ''}
        <button onclick="shareResult('score','${campaignId}','ציון הקמפיין שלי',{score:${res.score}})" style="margin-top:0.75rem;padding:0.4rem 0.875rem;background:none;border:1px solid #e2e8f0;border-radius:8px;font-size:0.75rem;cursor:pointer;color:#64748b">
          📤 שתף תוצאות
        </button>`;
    }

    // Barrel card
    const barrelCard = document.getElementById('barrel-card');
    if (barrelCard && res.barrel) {
      const b = res.barrel;
      barrelCard.style.display = '';
      barrelCard.innerHTML = `
        <div class="card-title" style="color:#dc2626">החוליה החלשה שלך</div>
        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
          <div style="flex:1;min-width:200px">
            <div style="font-weight:600;margin-bottom:0.25rem">${b.label}</div>
            <div style="font-size:0.8rem;color:#64748b">ציון: ${b.score}/100 — זה מה שמגביל את הקמפיין כולו</div>
          </div>
          <button class="btn btn-primary" style="width:auto;white-space:nowrap"
            onclick="fixBarrelWithAI('${campaignId}','${b.action}')">
            ${b.cta} →
          </button>
        </div>`;
    }
  } catch (e) { console.warn('[barrelScore]', e.message); }
}

async function fixBarrelWithAI(campaignId, action) {
  state.currentCampaignId = campaignId;
  if (action === 'rewrite_ad' || action === 'optimize_cta') {
    navigate('business-from-scratch');
    setTimeout(() => { bfsAgentTab = 'execution'; renderBusinessFromScratch(); }, 300);
  } else if (action === 'rewrite_landing') {
    navigate('ai-creation');
  } else if (action === 'optimize_form') {
    navigate('business-from-scratch');
    setTimeout(() => { bfsAgentTab = 'qa'; renderBusinessFromScratch(); }, 300);
  }
}

// ── Share (WhatsApp / link) ───────────────────────────────────────────────────
async function shareResult(shareType, resourceId, title, previewData) {
  // Show loading modal immediately
  const modalId = 'share-modal-' + Date.now();
  const overlay = document.createElement('div');
  overlay.id = modalId;
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9997;display:flex;align-items:center;justify-content:center;padding:1rem';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:1.25rem;padding:2rem;max-width:380px;width:100%;text-align:center;direction:rtl;position:relative">
      <button onclick="document.getElementById('${modalId}').remove()" style="position:absolute;top:1rem;left:1rem;background:none;border:none;font-size:1.25rem;cursor:pointer;color:#94a3b8">✕</button>
      <div style="font-weight:700;font-size:1.1rem;margin-bottom:1.5rem">📤 שיתוף תוצאות</div>
      <div id="${modalId}-body" style="display:flex;align-items:center;justify-content:center;gap:0.5rem;color:#64748b;min-height:80px">
        <div class="spinner" style="width:20px;height:20px;border-width:2px;border-color:#e2e8f0;border-top-color:#6366f1"></div>
        יוצר קישור...
      </div>
    </div>`;
  document.body.appendChild(overlay);

  try {
    const res = await api('POST', 'share-create', { shareType, resourceId, title, previewData });
    if (!res?.ok) {
      document.getElementById(modalId)?.remove();
      showToast('שגיאה ביצירת קישור שיתוף');
      return;
    }

    const bodyEl = document.getElementById(`${modalId}-body`);
    if (bodyEl) bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:0.75rem;width:100%">
        <a href="${res.whatsappUrl}" target="_blank" rel="noopener"
           style="display:flex;align-items:center;justify-content:center;gap:0.5rem;padding:0.875rem;background:#25d366;color:#fff;border-radius:12px;text-decoration:none;font-weight:600">
          💬 שלח בוואטסאפ
        </a>
        <button onclick="navigator.clipboard.writeText('${res.url}').then(()=>{showToast('הקישור הועתק!');document.getElementById('${modalId}').remove()})"
          style="padding:0.875rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;cursor:pointer;font-weight:600;color:#1e293b">
          📋 העתק קישור
        </button>
        <div style="font-size:0.72rem;color:#94a3b8;padding:0.5rem;background:#f8fafc;border-radius:8px;word-break:break-all">${res.url}</div>
      </div>`;
  } catch (e) {
    document.getElementById(modalId)?.remove();
    showToast('שגיאה: ' + e.message);
  }
}

function showToast(msg) {
  var t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e293b;color:#fff;padding:0.75rem 1.25rem;border-radius:12px;font-size:0.875rem;z-index:9999;animation:fadeIn 0.2s';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Team management ───────────────────────────────────────────────────────────
async function teamInvite() {
  const emailEl = document.getElementById('team-email-input');
  const roleEl  = document.getElementById('team-role-select');
  if (!emailEl || !emailEl.value.trim()) { showToast('הכנס כתובת אימייל'); return; }

  const email = emailEl.value.trim();
  const role  = roleEl?.value || 'viewer';

  try {
    const res = await api('POST', 'team-invite', { email, role });
    if (res?.ok) {
      emailEl.value = '';
      showToast(`הזמנה נשלחה ל-${email} ✓`);
      teamLoadMembers();
    } else {
      showToast(res?.error || 'שגיאה בשליחת הזמנה');
    }
  } catch (e) { showToast('שגיאה: ' + e.message); }
}

async function teamLoadMembers() {
  const listEl = document.getElementById('team-members-list');
  if (!listEl) return;

  try {
    const res = await api('GET', 'team-invite');
    if (!res?.members?.length) {
      listEl.innerHTML = '<div style="color:#94a3b8;font-size:0.875rem;text-align:center;padding:1rem">אין חברי צוות עדיין</div>';
      return;
    }
    const roleLabel = { admin: 'מנהל', viewer: 'צופה', owner: 'בעלים' };
    const statusColor = { pending: '#f59e0b', active: '#22c55e', removed: '#94a3b8' };
    const statusLabel = { pending: 'ממתין', active: 'פעיל', removed: 'הוסר' };
    listEl.innerHTML = res.members.map(m => `
      <div style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem 0;border-bottom:1px solid #f1f5f9">
        <div style="width:36px;height:36px;background:#6366f120;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#6366f1;font-size:0.875rem">
          ${m.invited_email[0].toUpperCase()}
        </div>
        <div style="flex:1">
          <div style="font-size:0.875rem;font-weight:600">${m.invited_email}</div>
          <div style="font-size:0.75rem;color:#64748b">${roleLabel[m.role] || m.role}</div>
        </div>
        <span style="font-size:0.7rem;padding:2px 8px;border-radius:99px;background:${statusColor[m.status] || '#94a3b8'}20;color:${statusColor[m.status] || '#94a3b8'}">
          ${statusLabel[m.status] || m.status}
        </span>
        <button onclick="teamRemoveMember('${m.id}')"
          style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem;padding:0.25rem" title="הסר">✕</button>
      </div>`).join('');
  } catch { listEl.innerHTML = '<div style="color:#ef4444;font-size:0.875rem;text-align:center;padding:1rem">שגיאה בטעינת הרשימה</div>'; }
}

async function teamRemoveMember(memberId) {
  if (!confirm('להסיר חבר צוות זה?')) return;
  try {
    await api('DELETE', `team-invite?memberId=${memberId}`);
    showToast('חבר הצוות הוסר');
    teamLoadMembers();
  } catch (e) { showToast('שגיאה: ' + e.message); }
}

// ── Achievements popup ────────────────────────────────────────────────────────
const ACHIEVEMENT_META = {
  campaign_pro:   { icon: '🏆', title: 'קמפיין מקצועי', desc: 'הגעת לציון 80+ בקמפיין שלך!' },
  first_lead:     { icon: '🎯', title: 'ליד ראשון', desc: 'ההמרה הראשונה שלך עלתה!' },
  scroll_master:  { icon: '📜', title: 'Scroll Master', desc: '70% מהגולשים גוללים לעומק הדף!' },
  onboarding_done:{ icon: '🚀', title: 'התחלה!', desc: 'השלמת את ההגדרה הראשונית של החשבון' },
};

var _shownAchievements = new Set(JSON.parse(localStorage.getItem('_shown_ach') || '[]'));

function showAchievementPopup(achievementId) {
  if (_shownAchievements.has(achievementId)) return;
  _shownAchievements.add(achievementId);
  localStorage.setItem('_shown_ach', JSON.stringify([..._shownAchievements]));

  const meta = ACHIEVEMENT_META[achievementId] || { icon: '⭐', title: 'הישג חדש!', desc: achievementId };
  const popup = document.createElement('div');
  popup.style.cssText = 'position:fixed;bottom:80px;right:24px;background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #6366f1;color:#fff;padding:1rem 1.25rem;border-radius:16px;z-index:9998;max-width:280px;box-shadow:0 8px 32px rgba(99,102,241,0.3);animation:slideIn 0.4s cubic-bezier(0.34,1.56,0.64,1)';
  popup.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.75rem">
      <div style="font-size:2rem">${meta.icon}</div>
      <div>
        <div style="font-size:0.7rem;color:#6366f1;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">הישג חדש!</div>
        <div style="font-weight:700;font-size:0.95rem">${meta.title}</div>
        <div style="font-size:0.8rem;color:#94a3b8;margin-top:2px">${meta.desc}</div>
      </div>
    </div>`;
  document.body.appendChild(popup);
  setTimeout(() => { popup.style.animation = 'fadeIn 0.3s reverse'; setTimeout(() => popup.remove(), 300); }, 4000);
}

async function checkNewAchievements() {
  if (!state.user?.id) return;
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last hour
    const { data } = await sb.from('user_achievements')
      .select('achievement_id')
      .eq('user_id', state.user.id)
      .gte('created_at', since);
    (data || []).forEach(a => showAchievementPopup(a.achievement_id));
  } catch { /* non-critical */ }
}

// ── Onboarding Wizard (forced — cannot skip) ──────────────────────────────────
var _obState = { step: 1, url: '', score: null, topFix: null, issues: [], businessName: '' };

function showOnboardingWizard() {
  _obState = { step: 1, url: '', score: null, topFix: null, issues: [], businessName: '' };
  _renderOB();
}

function _renderOB() {
  let existing = document.getElementById('ob-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ob-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(4px)';
  overlay.innerHTML = _obStepHtml(_obState.step);
  document.body.appendChild(overlay);
}

function _obStepHtml(step) {
  const steps = [
    { n: 1, label: 'שם העסק' },
    { n: 2, label: 'ניתוח דף' },
    { n: 3, label: 'תוצאות' },
    { n: 4, label: 'תיקון ראשון' },
  ];
  const bar = steps.map(s => `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
      <div style="width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;
        ${s.n < step ? 'background:#22c55e;color:#fff' : s.n === step ? 'background:#6366f1;color:#fff' : 'background:#1e293b;color:#64748b'}">
        ${s.n < step ? '✓' : s.n}
      </div>
      <span style="font-size:0.65rem;color:${s.n === step ? '#e2e8f0' : '#475569'}">${s.label}</span>
    </div>
    ${s.n < 4 ? `<div style="flex:1;height:2px;margin-top:14px;background:${s.n < step ? '#22c55e' : '#1e293b'};max-width:40px;align-self:flex-start;margin-top:16px"></div>` : ''}
  `).join('');

  const card = `<div style="background:#0f172a;border-radius:1.5rem;padding:2.5rem;max-width:520px;width:100%;border:1px solid #1e293b;box-shadow:0 25px 60px rgba(0,0,0,0.5);direction:rtl">
    <div style="text-align:center;margin-bottom:2rem">
      <div style="font-size:1.5rem;font-weight:800;color:#e2e8f0;margin-bottom:0.25rem">🚀 ברוך הבא ל-CampaignAI</div>
      <div style="color:#64748b;font-size:0.875rem">60 שניות לקבל את הניתוח הראשון שלך</div>
    </div>
    <div style="display:flex;align-items:center;gap:0;margin-bottom:2rem">${bar}</div>
    ${_obStepContent(step)}
  </div>`;
  return card;
}

function _obStepContent(step) {
  if (step === 1) return `
    <div>
      <label style="display:block;color:#94a3b8;font-size:0.875rem;margin-bottom:0.5rem">מה שם העסק שלך?</label>
      <input id="ob-name" type="text" placeholder="למשל: שיפוצי כהן" value="${_obState.businessName}"
        style="width:100%;padding:0.875rem 1rem;background:#1e293b;border:1px solid #334155;border-radius:0.75rem;color:#e2e8f0;font-size:1rem;box-sizing:border-box;outline:none"
        oninput="_obState.businessName=this.value" onkeydown="if(event.key==='Enter')obStep1Next()">
      <div style="margin-top:0.75rem">
        <label style="display:block;color:#94a3b8;font-size:0.875rem;margin-bottom:0.5rem">יש לך דף נחיתה? הכנס קישור:</label>
        <input id="ob-url" type="url" placeholder="https://yoursite.com" value="${_obState.url}"
          style="width:100%;padding:0.875rem 1rem;background:#1e293b;border:1px solid #334155;border-radius:0.75rem;color:#e2e8f0;font-size:1rem;box-sizing:border-box;outline:none"
          oninput="_obState.url=this.value" onkeydown="if(event.key==='Enter')obStep1Next()">
        <p style="color:#475569;font-size:0.75rem;margin-top:0.5rem">אין עדיין דף? השאר ריק — נבנה אחד עכשיו ✨</p>
      </div>
      <button onclick="obStep1Next()" style="width:100%;margin-top:1.5rem;padding:1rem;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:0.75rem;color:#fff;font-size:1rem;font-weight:700;cursor:pointer">
        המשך ←
      </button>
    </div>`;

  if (step === 2) return `
    <div style="text-align:center">
      <div style="width:64px;height:64px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;margin:0 auto 1.5rem;display:flex;align-items:center;justify-content:center">
        <div class="spinner" style="width:28px;height:28px;border-width:3px;border-color:rgba(255,255,255,0.2);border-top-color:#fff"></div>
      </div>
      <div style="color:#e2e8f0;font-size:1.1rem;font-weight:600;margin-bottom:0.5rem">מנתח את הדף שלך...</div>
      <div id="ob-analyze-msg" style="color:#64748b;font-size:0.875rem">בודק מהירות טעינה, CTA, מובייל ועוד</div>
    </div>`;

  if (step === 3) {
    const s = _obState.score || 0;
    const color = s >= 70 ? '#22c55e' : s >= 45 ? '#f59e0b' : '#ef4444';
    const label = s >= 70 ? 'מצוין! הדף שלך טוב' : s >= 45 ? 'יש מה לשפר' : 'יש כמה בעיות קריטיות';
    const issuesHtml = (_obState.issues || []).slice(0, 3).map(i =>
      `<div style="display:flex;align-items:center;gap:0.75rem;padding:0.625rem 0.75rem;background:#1e293b;border-radius:0.5rem">
        <span style="color:#ef4444;font-size:0.875rem">✗</span>
        <span style="color:#cbd5e1;font-size:0.85rem">${i.label}</span>
        <span style="margin-right:auto;background:#ef444420;color:#ef4444;padding:2px 8px;border-radius:99px;font-size:0.7rem">−${i.points} נק׳</span>
      </div>`
    ).join('');
    const passedHtml = (_obState.passed || []).slice(0, 2).map(p =>
      `<div style="display:flex;align-items:center;gap:0.75rem;padding:0.625rem 0.75rem;background:#1e293b;border-radius:0.5rem">
        <span style="color:#22c55e;font-size:0.875rem">✓</span>
        <span style="color:#cbd5e1;font-size:0.85rem">${p}</span>
      </div>`
    ).join('');
    return `
      <div>
        <div style="text-align:center;margin-bottom:1.5rem">
          <div style="font-size:3rem;font-weight:800;color:${color}">${s}</div>
          <div style="font-size:0.75rem;color:#64748b">מתוך 100</div>
          <div style="color:${color};font-weight:600;margin-top:0.25rem">${label}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1.5rem">
          ${issuesHtml}${passedHtml}
        </div>
        ${_obState.topFix ? `
          <button onclick="obStep4Fix()" style="width:100%;padding:1rem;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:0.75rem;color:#fff;font-size:1rem;font-weight:700;cursor:pointer">
            ✨ תקן עכשיו עם AI — ${_obState.topFix.label}
          </button>` : `
          <button onclick="obComplete()" style="width:100%;padding:1rem;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:0.75rem;color:#fff;font-size:1rem;font-weight:700;cursor:pointer">
            🚀 כנס לדאשבורד
          </button>`}
        <button onclick="obComplete()" style="width:100%;margin-top:0.75rem;padding:0.75rem;background:transparent;border:1px solid #334155;border-radius:0.75rem;color:#64748b;font-size:0.875rem;cursor:pointer">
          דלג — כנס לדאשבורד
        </button>
      </div>`;
  }

  if (step === 4) {
    const fix = _obState.topFix;
    return `
      <div style="text-align:center">
        <div style="font-size:2.5rem;margin-bottom:1rem">🎯</div>
        <div style="color:#e2e8f0;font-size:1.1rem;font-weight:700;margin-bottom:0.5rem">ה-AI מתקן: ${fix?.label || 'הדף שלך'}</div>
        <div style="color:#64748b;font-size:0.875rem;margin-bottom:1.5rem">${fix?.tip || 'יוצר המלצה מותאמת אישית'}</div>
        <div style="background:#1e293b;border-radius:0.75rem;padding:1rem;margin-bottom:1.5rem;text-align:right">
          <div style="color:#94a3b8;font-size:0.8rem;margin-bottom:0.5rem">המלצת ה-AI:</div>
          <div id="ob-fix-content" style="color:#e2e8f0;font-size:0.875rem;line-height:1.6">
            <div style="display:flex;align-items:center;gap:0.5rem;color:#64748b"><div class="spinner" style="width:16px;height:16px;border-width:2px"></div> מייצר המלצה...</div>
          </div>
        </div>
        <button id="ob-done-btn" onclick="obComplete()" disabled style="width:100%;padding:1rem;background:#1e293b;border:none;border-radius:0.75rem;color:#64748b;font-size:1rem;font-weight:700;cursor:not-allowed">
          🚀 כנס לדאשבורד
        </button>
      </div>`;
  }
  return '';
}

async function obStep1Next() {
  const nameEl = document.getElementById('ob-name');
  const urlEl  = document.getElementById('ob-url');
  if (nameEl) _obState.businessName = nameEl.value.trim();
  if (urlEl)  _obState.url = urlEl.value.trim();

  if (!_obState.businessName) {
    const inp = document.getElementById('ob-name');
    if (inp) { inp.style.borderColor = '#ef4444'; inp.focus(); }
    return;
  }

  // Save business name early
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await sb.from('business_profiles').upsert(
        { user_id: session.user.id, business_name: _obState.businessName },
        { onConflict: 'user_id', ignoreDuplicates: false }
      );
    }
  } catch { /* non-critical */ }

  if (!_obState.url) {
    // No URL — skip analysis, go straight to dashboard with AI creation
    await obComplete(true);
    return;
  }

  _obState.step = 2;
  _renderOB();
  await _runQuickAnalysis();
}

async function _runQuickAnalysis() {
  const msgs = [
    'בודק מהירות טעינה...',
    'מנתח כפתורי CTA...',
    'בודק התאמה למובייל...',
    'סורק טפסי לידים...',
    'מסכם תוצאות...',
  ];
  let mi = 0;
  const msgEl = document.getElementById('ob-analyze-msg');
  const interval = setInterval(() => {
    if (msgEl && mi < msgs.length) msgEl.textContent = msgs[mi++];
  }, 900);

  try {
    const res = await fetch(`${CONFIG.apiBase}/quick-analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: _obState.url }),
    });
    const data = await res.json();
    clearInterval(interval);
    _obState.score  = data.score || 0;
    _obState.issues = data.issues || [];
    _obState.passed = data.passed || [];
    _obState.topFix = data.topFix || null;
    _obState.step   = 3;
    _renderOB();
  } catch {
    clearInterval(interval);
    _obState.score  = 0;
    _obState.issues = [];
    _obState.step   = 3;
    _renderOB();
  }
}

async function obStep4Fix() {
  _obState.step = 4;
  _renderOB();

  // Ask AI for specific fix
  try {
    const fix = _obState.topFix;
    const prompt = `אני עם עסק "${_obState.businessName}". יש לדף הנחיתה שלי בעיה: "${fix?.label}". טיפ מהמערכת: "${fix?.tip}". תן לי המלצה קצרה וספציפית (2-3 משפטים) איך לתקן את זה.`;
    const res = await fetch(`${CONFIG.apiBase}/campaigner-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${state.accessToken}` },
      body: JSON.stringify({ message: prompt }),
    });
    const data = await res.json();
    const el = document.getElementById('ob-fix-content');
    if (el) el.innerHTML = `<p style="margin:0">${(data.reply || 'נסה לשפר את האלמנטים שצוינו').replace(/\n/g, '<br>')}</p>`;
    const btn = document.getElementById('ob-done-btn');
    if (btn) { btn.disabled = false; btn.style.cssText = 'width:100%;padding:1rem;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:0.75rem;color:#fff;font-size:1rem;font-weight:700;cursor:pointer'; }
  } catch {
    const el = document.getElementById('ob-fix-content');
    if (el) el.innerHTML = `<p style="margin:0">${_obState.topFix?.tip || 'שפר את הדף לפי ההמלצות'}</p>`;
    const btn = document.getElementById('ob-done-btn');
    if (btn) { btn.disabled = false; btn.style.cssText = 'width:100%;padding:1rem;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:0.75rem;color:#fff;font-size:1rem;font-weight:700;cursor:pointer'; }
  }
}

async function obComplete(buildNew = false) {
  // Mark onboarding as started
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      const steps = {
        ...(state.onboardingSteps || {}),
        profile_started: true,
        onboarding_wizard_done: true,
      };
      await sb.from('onboarding_progress').upsert(
        { user_id: session.user.id, steps, current_step: 'first_asset' },
        { onConflict: 'user_id', ignoreDuplicates: false }
      );
      state.onboardingSteps = steps;
      state.unlockedScreens = computeUnlockedScreens(steps);
    }
  } catch { /* non-critical */ }

  // Remove overlay
  const overlay = document.getElementById('ob-overlay');
  if (overlay) overlay.remove();

  // Route: if no URL provided → build landing page
  if (buildNew) {
    navigate('ai-creation');
    showToast('בוא נבנה לך דף נחיתה עם AI ✨');
  } else {
    navigate('dashboard');
  }
}

// ── Expose to HTML event handlers ─────────────────────────────────────────────
window.navigate              = navigate;
window.handleLogout          = handleLogout;
window.startResearch         = startResearch;
window.startStrategy         = startStrategy;
window.startExecution        = startExecution;
window.startQa               = startQa;
window.startAnalysis         = startAnalysis;
window.renderBusinessFromScratch = renderBusinessFromScratch;
window.saveBusinessProfile   = saveBusinessProfile;
window.switchAITab           = switchAITab;
window.generateAdScript      = generateAdScript;
window.generateLandingPage   = generateLandingPage;
window.generateAdCreative    = generateAdCreative;
window.clearAdCreative       = clearAdCreative;
window.downloadAdCreative    = downloadAdCreative;
window.copyAIResult          = copyAIResult;
window.expandSavedWork       = expandSavedWork;
window.filterAdminUsers        = filterAdminUsers;
window.switchAdminTab          = switchAdminTab;
window.adminRetryJob           = adminRetryJob;
window.adminCancelJob          = adminCancelJob;
window.adminLoadUserDetail     = adminLoadUserDetail;
window.adminChangePlanModal    = adminChangePlanModal;
window.adminToggleAdminStatus  = adminToggleAdminStatus;
window.adminExportUsersCSV     = adminExportUsersCSV;
window.adminChangePlanInlineById = adminChangePlanInlineById;
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
window.switchAcctSubTab      = switchAcctSubTab;
window._acctMarkDirty        = _acctMarkDirty;
window._acctCancelChanges    = _acctCancelChanges;
window.saveAcctChanges       = saveAcctChanges;
window.uploadAvatar          = uploadAvatar;
window.savePassword          = savePassword;
window.signOutAllDevices     = signOutAllDevices;
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
window.startOrchestration      = startOrchestration;
window.renderOrchestrationPanel = renderOrchestrationPanel;
window.loadBarrelAndScore      = loadBarrelAndScore;
window.fixBarrelWithAI         = fixBarrelWithAI;
window.shareResult             = shareResult;
window.showToast               = showToast;
window.showOnboardingWizard    = showOnboardingWizard;
window.obStep1Next             = obStep1Next;
window.obStep4Fix              = obStep4Fix;
window.obComplete              = obComplete;
window.adminLoadAIModels       = adminLoadAIModels;
window.adminUpdateModel        = adminUpdateModel;
window.adminTestModel          = adminTestModel;
window.teamInvite              = teamInvite;
window.teamLoadMembers         = teamLoadMembers;
window.teamRemoveMember        = teamRemoveMember;
window.showAchievementPopup    = showAchievementPopup;
window.checkNewAchievements    = checkNewAchievements;

boot();
