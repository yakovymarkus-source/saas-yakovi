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
};

// ── Router ────────────────────────────────────────────────────────────────────
const routes = {
  dashboard:        renderDashboard,
  'business-profile': renderBusinessProfile,
  'landing-pages':  renderLandingPages,
  recommendations:  renderRecommendations,
  performance:      renderPerformance,
  economics:        renderEconomics,
  copy:             renderCopyGenerator,
  'ab-tests':       renderAbTests,
  campaigns:        renderCampaigns,
  leads:            renderLeads,
  integrations:     renderIntegrations,
  billing:          renderBilling,
  settings:         renderSettings,
  admin:            renderAdmin,
  updates:          renderUpdates,
  support:          renderSupport,
};

// ── Progressive unlock helper ─────────────────────────────────────────────────
function computeUnlockedScreens(steps) {
  const screens = new Set(['dashboard', 'business-profile']);
  if (!steps) return screens;
  if (steps.profile_started)  screens.add('landing-pages');
  if (steps.first_asset)      screens.add('recommendations');
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
  const u = state.unlockedScreens;
  // Progressive nav — only show what's unlocked for this user right now
  const coreNav = [
    { id: 'dashboard',        icon: '📊', label: 'דשבורד',             always: true },
    { id: 'business-profile', icon: '🏢', label: 'פרופיל עסקי',        always: true },
    { id: 'landing-pages',    icon: '🚀', label: 'דפי נחיתה',          unlock: 'landing-pages' },
    { id: 'recommendations',  icon: '💡', label: 'המלצות',             unlock: 'recommendations' },
    { id: 'copy',             icon: '✍️', label: 'קופי',               unlock: 'copy' },
    { id: 'performance',      icon: '📈', label: 'ביצועים',            unlock: 'performance' },
    { id: 'ab-tests',         icon: '🧪', label: 'A/B Tests',          unlock: 'ab-tests' },
    { id: 'economics',        icon: '💰', label: 'כלכלת יחידה',        unlock: 'economics' },
  ].filter(n => n.always || u.has(n.unlock));

  const legacyNav = [
    { id: 'campaigns',    icon: '🎯', label: 'נכסים שיווקיים' },
    { id: 'leads',        icon: '📥', label: 'לידים' },
    { id: 'integrations', icon: '🔌', label: 'אינטגרציות' },
    { id: 'billing',      icon: '💳', label: 'חיוב' },
    { id: 'settings',     icon: '⚙️', label: 'הגדרות' },
    { id: 'updates',      icon: '🆕', label: 'עדכונים' },
    { id: 'support',      icon: '💬', label: 'תמיכה' },
    ...(state.profile?.is_admin ? [{ id: 'admin', icon: '🛡️', label: 'ניהול' }] : []),
  ];

  const navItems = [...coreNav, ...legacyNav];
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

  // Load all data in parallel
  const [assetsRes, metricsRes, intRes] = await Promise.allSettled([
    sb.from('generated_assets').select('id,asset_type,status,created_at')
      .eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(100),
    sb.from('asset_metrics').select('clicks,conversions,revenue')
      .eq('user_id', state.user.id),
    state.integrations.length ? Promise.resolve({ value: state.integrations })
      : api('GET', 'integration-connect').then(r => Array.isArray(r) ? r : []).catch(() => []),
  ]);

  const allAssets    = assetsRes.status === 'fulfilled' ? (assetsRes.value.data || []) : [];
  const allMetrics   = metricsRes.status === 'fulfilled' ? (metricsRes.value.data || []) : [];
  if (!state.integrations.length && intRes.status === 'fulfilled') {
    state.integrations = intRes.value?.value || intRes.value || [];
  }

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
          onclick="navigate('billing')">שדרגו עכשיו →</button>
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
      <div class="stat-card" onclick="navigate('landing-pages')" style="cursor:pointer">
        <div class="stat-label">דפים שנוצרו</div>
        <div class="stat-value">${allAssets.length}</div>
        <div class="text-xs text-muted">${recent.length} ב-30 יום האחרונים</div>
      </div>
      <div class="stat-card" style="cursor:default">
        <div class="stat-label">דפים פעילים / מכסה</div>
        <div style="display:flex;align-items:center;gap:0.75rem;margin-top:0.5rem">
          ${renderDonutSVG(allAssets.length, assetsMax)}
          <div>
            <div class="stat-value" style="font-size:1.25rem">${published.length}${assetsMax !== Infinity ? ' / ' + assetsMax : ''}</div>
            <div class="text-xs text-muted" style="margin-top:0.1rem">פורסמו</div>
            ${assetsMax !== Infinity ? `<div class="usage-bar-track" style="width:72px;margin-top:0.35rem">
              <div class="usage-bar-fill ${assetsPct >= 90 ? 'danger' : assetsPct >= 70 ? 'warning' : 'normal'}" style="width:${assetsPct}%"></div>
            </div>` : ''}
          </div>
        </div>
      </div>
      <div class="stat-card" onclick="${steps.has_metrics ? "navigate('performance')" : ''}" style="cursor:${steps.has_metrics ? 'pointer' : 'default'}">
        <div class="stat-label">סה"כ קליקים</div>
        <div class="stat-value">${totalClicks > 0 ? totalClicks.toLocaleString() : '—'}</div>
        <div class="text-xs text-muted">${totalConv > 0 ? totalConv + ' המרות' : 'הוסף מדדים במסך ביצועים'}</div>
      </div>
      <div class="stat-card" onclick="${steps.has_metrics ? "navigate('performance')" : ''}" style="cursor:${steps.has_metrics ? 'pointer' : 'default'}">
        <div class="stat-label">הכנסה מדווחת</div>
        <div class="stat-value">${totalRev > 0 ? '₪' + totalRev.toLocaleString() : '—'}</div>
        <div class="text-xs text-muted">${connectedCount > 0 ? connectedCount + ' אינטגרציות פעילות' : 'אין אינטגרציות'}</div>
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
    { key: 'profile_started',  label: 'פרופיל עסקי',    page: 'business-profile', done: steps.profile_started },
    { key: 'first_asset',      label: 'דף נחיתה ראשון', page: 'landing-pages',    done: steps.first_asset,    blocked: !steps.profile_started },
    { key: 'multiple_assets',  label: '3 דפים / וריאציות', page: 'landing-pages', done: steps.multiple_assets, blocked: !steps.first_asset },
    { key: 'has_metrics',      label: 'הוספת מדדי ביצועים', page: 'performance',  done: steps.has_metrics,    blocked: !steps.multiple_assets },
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
      <div onclick="${!s.done && !s.blocked ? "navigate('" + s.page + "')" : ''}"
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

  sb.auth.onAuthStateChange(async (event, session) => {
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
      initCampaignerChat();
    }

    // ── Step 2: fetch fresh data in background ────────────────────────────────
    try {
      const [profile, sub, onboardingRes, bpRes, campsRes] = await Promise.all([
        sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('subscriptions').select('plan,status,payment_status').eq('user_id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('onboarding_progress').select('steps,current_step').eq('user_id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('business_profiles').select('*').eq('user_id', session.user.id).maybeSingle().then(r => r.data),
        sb.from('campaigns').select('id,name').eq('owner_user_id', session.user.id).then(r => r.data),
      ]);

      state.profile         = profile  || {};
      state.subscription    = sub      || { plan: 'free' };
      state.businessProfile = bpRes    || null;
      state.campaigns       = campsRes || [];

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

      // Re-render only if we didn't show cached version (first-ever load)
      if (!cached || cached.userId !== session.user.id) {
        if (state.currentPage === 'dashboard' && initialPage !== 'dashboard') {
          state.currentPage = initialPage;
        }
        render();
        initCampaignerChat();
      } else {
        // Silently update nav in case subscription/onboarding changed
        const navEl = document.querySelector('.sidebar-nav');
        if (navEl) {
          const u = state.unlockedScreens;
          document.querySelectorAll('.nav-item[data-page]').forEach(el => {
            const page = el.dataset.page;
            const corePages = ['landing-pages','recommendations','copy','performance','ab-tests','economics'];
            if (corePages.includes(page)) {
              el.style.display = u.has(page) ? '' : 'none';
            }
          });
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
        initCampaignerChat();
      }
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

// ── Updates page ──────────────────────────────────────────────────────────────
async function renderUpdates() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let updates;
  try {
    updates = await api('GET', 'get-updates');
  } catch (err) {
    renderShell(`
      <div class="page-header"><h1 class="page-title">🆕 עדכוני מערכת</h1></div>
      <div class="analysis-card" style="text-align:center;padding:2rem;color:var(--gray-500)">
        שגיאה בטעינת עדכונים. נסה שוב מאוחר יותר.
      </div>`);
    return;
  }

  const typeLabel = { new: 'חדש', improved: 'שיפור', fixed: 'תוקן' };
  const typeCls   = { new: 'update-tag-new', improved: 'update-tag-improved', fixed: 'update-tag-fixed' };

  renderShell(`
    <div class="page-header">
      <h1 class="page-title">🆕 עדכוני מערכת</h1>
      <p class="page-subtitle text-muted">מה חדש ב-CampaignAI</p>
    </div>
    ${updates.length === 0
      ? `<div class="updates-empty"><div class="updates-empty-icon">📭</div><p>אין עדכונים להצגה כרגע. בקרוב יגיעו חדשות!</p></div>`
      : `<div class="updates-list">
          ${updates.map(u => `
            <div class="update-card ${u.is_pinned ? 'update-card-pinned' : ''}">
              <div class="update-card-meta">
                <span class="update-tag ${typeCls[u.type] || ''}">${typeLabel[u.type] || u.type}</span>
                ${u.is_pinned ? '<span class="update-tag update-tag-pinned">📌 נעוץ</span>' : ''}
                <span class="update-date">${new Date(u.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
              </div>
              <h3 class="update-title">${escHtml(u.title)}</h3>
              <p class="update-body">${escHtml(u.content)}</p>
            </div>
          `).join('')}
        </div>`
    }`);
}

// ── Support page ───────────────────────────────────────────────────────────────
function renderSupport() {
  renderShell(`
    <div class="page-header">
      <h1 class="page-title">💬 תמיכה</h1>
      <p class="page-subtitle text-muted">שלח לנו פנייה ונחזור אליך בהקדם</p>
    </div>
    <div class="support-wrap">
      <div class="support-card">
        <div id="support-success" class="support-success" style="display:none">
          ✅ קיבלנו את הפנייה שלך. נחזור אליך בהקדם.
        </div>
        <form id="support-form" onsubmit="submitSupportTicket(event)">
          <div class="form-group">
            <label class="form-label">סוג פנייה *</label>
            <select id="ticket-type" class="form-input" required>
              <option value="">בחר סוג...</option>
              <option value="question">שאלה</option>
              <option value="bug">באג</option>
              <option value="feature_request">רעיון לשיפור</option>
              <option value="feedback">פידבק</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">כותרת *</label>
            <input id="ticket-title" type="text" class="form-input" placeholder="תאר בקצרה את הנושא" maxlength="200" required />
          </div>
          <div class="form-group">
            <label class="form-label">תיאור *</label>
            <textarea id="ticket-desc" class="form-input" placeholder="תאר את הנושא בפירוט — ככל שתפרט יותר, כך נוכל לעזור מהר יותר" rows="5" maxlength="2000" required style="resize:vertical"></textarea>
          </div>
          <div id="support-error" class="form-error" style="display:none;margin-bottom:.75rem"></div>
          <button type="submit" id="support-submit" class="btn btn-primary" style="width:auto;padding:.625rem 1.5rem">שלח פנייה</button>
        </form>
      </div>
    </div>`);
}

async function submitSupportTicket(e) {
  e.preventDefault();
  const type  = document.getElementById('ticket-type')?.value?.trim();
  const title = document.getElementById('ticket-title')?.value?.trim();
  const desc  = document.getElementById('ticket-desc')?.value?.trim();
  const errEl = document.getElementById('support-error');
  const btn   = document.getElementById('support-submit');

  const showErr = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; };
  errEl.style.display = 'none';

  if (!type)                         return showErr('בחר סוג פנייה');
  if (!title || title.length < 3)    return showErr('כותרת קצרה מדי — לפחות 3 תווים');
  if (!desc  || desc.length  < 10)   return showErr('תיאור קצר מדי — אנא פרט יותר (לפחות 10 תווים)');

  btn.disabled = true;
  btn.textContent = 'שולח...';

  try {
    await api('POST', 'submit-ticket', { type, title, description: desc });
    document.getElementById('support-form').style.display = 'none';
    document.getElementById('support-success').style.display = 'block';
  } catch (err) {
    showErr(err.message || 'שגיאה בשליחה. נסה שוב.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'שלח פנייה';
  }
}

// ── Business Profile ──────────────────────────────────────────────────────────
async function renderBusinessProfile() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  let profile = null;
  try {
    const res = await api('GET', 'business-profile');
    profile = res.profile || null;
    state.businessProfile = profile;
  } catch {}

  const { scoreCompletion: _score, nextQ } = (() => {
    if (!profile) return { nextQ: null };
    const required = ['offer','price_amount','target_audience','problem_solved','desired_outcome','primary_goal'];
    const missing  = required.filter(f => !profile[f]);
    const pct      = Math.round(((required.length - missing.length) / required.length) * 70);
    const questions = {
      offer:           'מה בדיוק אתה מוכר? (משפט אחד)',
      price_amount:    'מה המחיר של ההצעה שלך?',
      target_audience: 'למי אתה מוכר? תאר את הלקוח האידיאלי',
      problem_solved:  'מה הבעיה הספציפית שאתה פותר?',
      desired_outcome: 'מה הלקוח מקבל בסוף?',
      primary_goal:    'מה מטרת הקמפיין? (לידים / מכירות / פגישות)',
    };
    return { pct, nextQ: missing[0] ? questions[missing[0]] : null };
  })();

  // Empty state — first time user
  if (!profile) {
    renderShell(`
      <div class="page-header">
        <h1 class="page-title">פרופיל עסקי</h1>
        <p class="page-subtitle">ספר לנו על העסק שלך כדי שנוכל לייצר תוכן מדויק</p>
      </div>
      <div class="card" style="max-width:560px;margin:2rem auto">
        <h2 style="font-size:1.25rem;font-weight:700;margin-bottom:.5rem">שאלה אחת לפני שמתחילים 👋</h2>
        <p class="text-muted" style="margin-bottom:1.5rem">זה הכל שצריך כדי לייצר דף נחיתה ראשון. תוכל להוסיף פרטים נוספים בהמשך.</p>
        <form onsubmit="saveBizProfile(event)">
          <div class="form-group">
            <label class="form-label" style="font-size:1rem;font-weight:600">מה אתה מוכר?</label>
            <textarea id="bp-offer" class="form-input" rows="3" maxlength="500"
              placeholder="לדוגמה: קורס אונליין ל-6 שבועות לעצמאיים שרוצים להכפיל הכנסה דרך לינקדאין" required
              style="resize:vertical"></textarea>
          </div>
          <div id="bp-error" class="form-error" style="display:none;margin-bottom:.75rem"></div>
          <button type="submit" class="btn btn-gradient" style="width:auto">צור דף נחיתה ראשון →</button>
        </form>
      </div>`);
    return;
  }

  // Has profile — show summary + enrichment nudges
  const score = profile.profile_score || 0;
  const scoreColor = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444';

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">פרופיל עסקי</h1>
        <p class="page-subtitle">הבסיס לכל תוכן שהמערכת מייצרת עבורך</p>
      </div>
      <span class="badge" style="background:${scoreColor}20;color:${scoreColor};border:1px solid ${scoreColor}40">
        שלמות ${score}%
      </span>
    </div>

    ${nextQ ? `
    <div class="card mb-4" style="border-right:4px solid #6366f1;background:#f8f7ff">
      <div style="display:flex;align-items:center;gap:.75rem">
        <span style="font-size:1.5rem">💡</span>
        <div>
          <div style="font-weight:600;margin-bottom:.25rem">השלמת פרטים = תוצאות מדויקות יותר</div>
          <div class="text-muted">${nextQ}</div>
        </div>
        <button class="btn btn-sm btn-primary" style="margin-right:auto;flex-shrink:0"
          onclick="document.getElementById('bp-edit-section').scrollIntoView({behavior:'smooth'})">
          השלם עכשיו
        </button>
      </div>
    </div>` : ''}

    <div class="card mb-4">
      <div class="card-title">📋 פרטי העסק הנוכחיים</div>
      <div style="display:grid;gap:.75rem">
        ${[
          ['מה אתה מוכר',    profile.offer],
          ['שם העסק',        profile.business_name],
          ['קטגוריה',        profile.category],
          ['קהל יעד',        profile.target_audience],
          ['בעיה שפותרים',   profile.problem_solved],
          ['מחיר',           profile.price_amount ? `₪${profile.price_amount}` : null],
          ['מטרת קמפיין',    profile.primary_goal],
        ].filter(([,v]) => v).map(([label, val]) => `
          <div style="display:flex;gap:.5rem;padding:.5rem 0;border-bottom:1px solid var(--gray-100)">
            <span class="text-muted" style="min-width:120px;flex-shrink:0">${label}</span>
            <span style="font-weight:500">${val}</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="card" id="bp-edit-section">
      <div class="card-title">✏️ עדכון פרופיל</div>
      <form onsubmit="saveBizProfile(event)">
        <div style="display:grid;gap:1rem">
          <div class="form-group">
            <label class="form-label">מה אתה מוכר</label>
            <textarea id="bp-offer" class="form-input" rows="2" maxlength="500">${profile.offer || ''}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">שם העסק</label>
            <input id="bp-business-name" type="text" class="form-input" maxlength="200" value="${profile.business_name || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">קהל יעד</label>
            <input id="bp-audience" type="text" class="form-input" maxlength="500" value="${profile.target_audience || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">בעיה שפותרים</label>
            <input id="bp-problem" type="text" class="form-input" maxlength="500" value="${profile.problem_solved || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">תוצאה שהלקוח מקבל</label>
            <input id="bp-outcome" type="text" class="form-input" maxlength="500" value="${profile.desired_outcome || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">מחיר (מספר בלבד)</label>
            <input id="bp-price" type="number" class="form-input" min="0" value="${profile.price_amount || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">מטרת קמפיין</label>
            <select id="bp-goal" class="form-input">
              <option value="">בחר...</option>
              ${['leads','sales','appointments','awareness'].map(g =>
                `<option value="${g}" ${profile.primary_goal===g?'selected':''}>${
                  {leads:'לידים',sales:'מכירות',appointments:'פגישות',awareness:'מודעות'}[g]
                }</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="bp-error" class="form-error" style="display:none;margin-top:.75rem;margin-bottom:.5rem"></div>
        <button type="submit" class="btn btn-gradient mt-4" style="width:auto">שמור שינויים</button>
      </form>
    </div>`);
}

async function saveBizProfile(e) {
  e.preventDefault();
  const errEl = document.getElementById('bp-error');
  errEl.style.display = 'none';
  const btn = e.submitter;
  btn.disabled = true; btn.textContent = 'שומר...';

  const fields = {};
  const offer   = document.getElementById('bp-offer')?.value?.trim();
  const bname   = document.getElementById('bp-business-name')?.value?.trim();
  const aud     = document.getElementById('bp-audience')?.value?.trim();
  const prob    = document.getElementById('bp-problem')?.value?.trim();
  const outcome = document.getElementById('bp-outcome')?.value?.trim();
  const price   = document.getElementById('bp-price')?.value?.trim();
  const goal    = document.getElementById('bp-goal')?.value;

  if (offer)   fields.offer            = offer;
  if (bname)   fields.business_name    = bname;
  if (aud)     fields.target_audience  = aud;
  if (prob)    fields.problem_solved   = prob;
  if (outcome) fields.desired_outcome  = outcome;
  if (price)   fields.price_amount     = parseFloat(price);
  if (goal)    fields.primary_goal     = goal;

  if (!fields.offer && !state.businessProfile) {
    errEl.textContent = 'ספר לנו מה אתה מוכר כדי להתחיל';
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'שמור';
    return;
  }

  try {
    const res = await api('POST', 'business-profile', { fields });
    state.businessProfile = res.profile;

    // Advance unlock — profile started
    if (!state.onboardingSteps?.profile_started) {
      state.onboardingSteps = { ...(state.onboardingSteps || {}), profile_started: true };
      state.unlockedScreens = computeUnlockedScreens(state.onboardingSteps);
    }

    toast('הפרופיל נשמר בהצלחה', 'success');

    // If first save, take user to landing pages
    if (!state.unlockedScreens.has('landing-pages') === false) {
      navigate('landing-pages');
    } else {
      renderBusinessProfile();
    }
  } catch (err) {
    errEl.textContent = err.message || 'שגיאה בשמירה';
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'שמור';
  }
}

// ── Landing Pages ─────────────────────────────────────────────────────────────
async function renderLandingPages() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  let assets = [];
  try {
    const { data } = await sb.from('generated_assets')
      .select('id, asset_type, title, preview_url, status, created_at, parent_id')
      .eq('user_id', state.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    assets = data || [];

    // Advance onboarding if user has assets
    if (assets.length >= 1 && !state.onboardingSteps?.first_asset) {
      state.onboardingSteps = { ...(state.onboardingSteps || {}), first_asset: true };
      state.unlockedScreens = computeUnlockedScreens(state.onboardingSteps);
      await sb.from('onboarding_progress').upsert({
        user_id: state.user.id,
        steps: state.onboardingSteps,
        current_step: 'first_asset',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    }
    if (assets.length >= 3 && !state.onboardingSteps?.multiple_assets) {
      state.onboardingSteps = { ...(state.onboardingSteps || {}), multiple_assets: true };
      state.unlockedScreens = computeUnlockedScreens(state.onboardingSteps);
      await sb.from('onboarding_progress').upsert({
        user_id: state.user.id,
        steps: state.onboardingSteps,
        current_step: 'multiple_assets',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    }
  } catch {}

  const statusLabel = { draft: 'טיוטה', published: 'פורסם', archived: 'בארכיון', failed: 'נכשל' };
  const statusColor = { draft: '#f59e0b', published: '#22c55e', archived: '#94a3b8', failed: '#ef4444' };

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">דפי נחיתה</h1>
        <p class="page-subtitle">${assets.length} דפים נוצרו עד כה</p>
      </div>
      <button class="btn btn-gradient" style="width:auto" onclick="openLandingPageCreator()">+ צור דף חדש</button>
    </div>

    ${assets.length === 0 ? `
    <div class="card" style="text-align:center;padding:3rem 2rem">
      <div style="font-size:3rem;margin-bottom:1rem">🚀</div>
      <h3 style="font-size:1.25rem;font-weight:700;margin-bottom:.5rem">עדיין אין דפי נחיתה</h3>
      <p class="text-muted" style="margin-bottom:1.5rem">בא נייצר את הדף הראשון שלך — לוקח פחות מ-2 דקות</p>
      <button class="btn btn-gradient" style="width:auto" onclick="openLandingPageCreator()">
        צור דף נחיתה ראשון →
      </button>
    </div>` : `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem">
      ${assets.map(a => {
        const label = statusLabel[a.status] || a.status;
        const color = statusColor[a.status] || '#94a3b8';
        const date  = new Date(a.created_at).toLocaleDateString('he-IL');
        const title = a.title || a.asset_type || 'דף נחיתה';
        return `
        <div class="card" style="cursor:default;position:relative">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.75rem">
            <span style="font-weight:600;font-size:.95rem;flex:1;padding-left:.5rem">${title}</span>
            <span style="font-size:.75rem;padding:.2rem .6rem;border-radius:9999px;background:${color}20;color:${color};border:1px solid ${color}40;flex-shrink:0">${label}</span>
          </div>
          <div class="text-muted" style="font-size:.8rem;margin-bottom:1rem">${date}${a.parent_id ? ' · וריאציה' : ''}</div>
          <div style="display:flex;gap:.5rem">
            ${a.preview_url ? `<a href="${a.preview_url}" target="_blank" class="btn btn-sm btn-secondary" style="text-decoration:none">צפה בדף</a>` : ''}
            <button class="btn btn-sm btn-secondary" onclick="createVariation('${a.id}','${title.replace(/'/g,"\\'")}')">
              + וריאציה
            </button>
            ${a.status === 'published' ? `
            <button class="btn btn-sm" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a"
              onclick="archiveAsset('${a.id}')">ארכב</button>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`}
  `);
}

function openLandingPageCreator() {
  // Open the chat widget focused on landing page creation
  if (typeof toggleChat === 'function') {
    if (!chatState.open) toggleChat();
    // Pre-fill prompt if profile has offer
    if (state.businessProfile?.offer) {
      const inp = document.getElementById('chat-input');
      if (inp && !inp.value) {
        inp.value = `צור לי דף נחיתה עבור: ${state.businessProfile.offer}`;
        inp.focus();
      }
    }
  }
  toast('הקלד בצ\'אט מה תרצה שייצרו לך — הכל מתחיל משם', 'info');
}

function createVariation(assetId, assetTitle) {
  if (typeof toggleChat === 'function') {
    if (!chatState.open) toggleChat();
    const inp = document.getElementById('chat-input');
    if (inp) {
      inp.value = `צור 3 וריאציות לדף: ${assetTitle}`;
      inp.focus();
    }
  }
}

async function archiveAsset(assetId) {
  try {
    await sb.from('generated_assets').update({ status: 'archived' }).eq('id', assetId).eq('user_id', state.user.id);
    toast('הדף הועבר לארכיון', 'success');
    renderLandingPages();
  } catch (err) {
    toast(err.message || 'שגיאה בארכוב', 'error');
  }
}

// ── Recommendations ───────────────────────────────────────────────────────────
async function renderRecommendations() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  const steps   = state.onboardingSteps || {};
  const profile = state.businessProfile;
  const score   = profile?.profile_score || 0;

  // Build action cards based on current stage
  const cards = [];

  if (!steps.profile_started) {
    cards.push({
      icon: '🏢', priority: 'high',
      title: 'מלא פרופיל עסקי',
      desc:  'צעד ראשון ומחייב — ספר לנו מה אתה מוכר כדי שנוכל לייצר תוכן רלוונטי',
      cta:   'מלא עכשיו',
      action: () => navigate('business-profile'),
    });
  }

  if (steps.profile_started && !steps.first_asset) {
    cards.push({
      icon: '🚀', priority: 'high',
      title: 'צור דף נחיתה ראשון',
      desc:  `${profile?.offer ? `עבור "${profile.offer}" — ` : ''}תוכן מותאם אישית מוכן להיות מוצג ללקוחות שלך`,
      cta:   'צור דף →',
      action: () => { navigate('landing-pages'); setTimeout(openLandingPageCreator, 300); },
    });
  }

  if (steps.first_asset && !steps.multiple_assets) {
    cards.push({
      icon: '🔀', priority: 'high',
      title: 'צור וריאציה לדף הקיים',
      desc:  'גרסה שנייה עם גישה שונה — aggressive / minimal / emotional — כדי לדעת מה עובד יותר',
      cta:   'צור וריאציה',
      action: () => navigate('landing-pages'),
    });
    cards.push({
      icon: '📢', priority: 'medium',
      title: 'צור מודעה מהדף',
      desc:  'הפוך את הדף לתסריט מודעת פייסבוק/אינסטגרם בלחיצה אחת',
      cta:   'צור מודעה',
      action: () => {
        if (!chatState.open) toggleChat();
        const inp = document.getElementById('chat-input');
        if (inp) { inp.value = 'צור לי תסריט מודעה מהדף נחיתה האחרון שיצרנו'; inp.focus(); }
      },
    });
  }

  if (steps.multiple_assets && !steps.has_metrics) {
    cards.push({
      icon: '📊', priority: 'medium',
      title: 'הוסף נתוני ביצועים',
      desc:  'יש לך מספר דפים — הגיע הזמן לדעת איזה מהם עובד. הוסף CTR/המרות כדי לקבל המלצות מדויקות',
      cta:   'הוסף נתונים',
      action: () => toast('מסך ביצועים יפתח בקרוב — בינתיים שתף נתונים בצ\'אט', 'info'),
    });
  }

  // Profile enrichment nudge
  if (steps.profile_started && score < 60) {
    cards.push({
      icon: '💡', priority: 'low',
      title: 'השלם פרטי פרופיל לתוצאות מדויקות יותר',
      desc:  `הפרופיל שלך ${score}% שלם. ככל שתוסיף יותר פרטים, כך התוכן שנייצר יהיה ממוקד ומשכנע יותר`,
      cta:   'השלם פרופיל',
      action: () => navigate('business-profile'),
    });
  }

  if (!cards.length) {
    cards.push({
      icon: '✅', priority: 'low',
      title: 'הכל עדכני!',
      desc:  'אין פעולות ממתינות כרגע. כשיהיו נתונים חדשים — המלצות יופיעו כאן',
      cta:   null,
      action: null,
    });
  }

  const priorityBorder = { high: '#6366f1', medium: '#f59e0b', low: '#22c55e' };
  const priorityLabel  = { high: 'דחוף', medium: 'מומלץ', low: 'אופציונלי' };

  renderShell(`
    <div class="page-header">
      <h1 class="page-title">המלצות</h1>
      <p class="page-subtitle">הצעדים הבאים שיקדמו את העסק שלך</p>
    </div>

    <div style="display:grid;gap:1rem;max-width:720px">
      ${cards.map(c => `
      <div class="card" style="border-right:4px solid ${priorityBorder[c.priority]};cursor:${c.action ? 'pointer' : 'default'}"
        ${c.action ? `onclick="window._recAction_${c.title.replace(/\s+/g,'_')}()"` : ''}>
        <div style="display:flex;align-items:center;gap:1rem">
          <span style="font-size:2rem;flex-shrink:0">${c.icon}</span>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem">
              <span style="font-weight:700">${c.title}</span>
              <span style="font-size:.7rem;padding:.15rem .5rem;border-radius:9999px;
                background:${priorityBorder[c.priority]}20;color:${priorityBorder[c.priority]}">
                ${priorityLabel[c.priority]}
              </span>
            </div>
            <p class="text-muted" style="font-size:.875rem;margin:0">${c.desc}</p>
          </div>
          ${c.cta ? `<button class="btn btn-sm btn-primary" style="flex-shrink:0">${c.cta}</button>` : ''}
        </div>
      </div>`).join('')}
    </div>
  `);

  // Bind action handlers
  cards.forEach(c => {
    if (c.action) {
      window[`_recAction_${c.title.replace(/\s+/g,'_')}`] = c.action;
    }
  });
}

// ── Performance Screen ────────────────────────────────────────────────────────
async function renderPerformance() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let assets = [];
  try {
    const res = await api('GET', 'asset-metrics');
    assets = Array.isArray(res) ? res : [];
  } catch {}

  const hasAny = assets.some(a => a.metrics);

  renderShell(`
    <div class="page-header flex items-center justify-between" style="flex-wrap:wrap;gap:1rem">
      <div>
        <h1 class="page-title">ביצועים</h1>
        <p class="page-subtitle">מדדי CTR, המרות והכנסה לכל דף נחיתה</p>
      </div>
      <button class="btn btn-secondary" style="width:auto;display:flex;align-items:center;gap:.5rem" onclick="syncPerformance()" id="sync-perf-btn">
        <span>↻</span> סנכרן מ-Ads
      </button>
    </div>

    ${!hasAny ? `
    <div class="card" style="text-align:center;padding:3rem 2rem;margin-bottom:1.5rem">
      <div style="font-size:3rem;margin-bottom:1rem">📊</div>
      <h3 style="font-weight:700;margin-bottom:.5rem">אין נתוני ביצועים עדיין</h3>
      <p class="text-muted">הוסף נתוני CTR/המרות לכל דף כדי לראות מה עובד</p>
    </div>` : ''}

    <div style="display:grid;gap:1rem">
      ${assets.map(a => {
        const m = a.metrics;
        const title = a.title || a.asset_type || 'דף נחיתה';
        const date  = new Date(a.created_at).toLocaleDateString('he-IL');
        const ctrColor   = m?.ctr   > 3 ? '#22c55e' : m?.ctr   > 1 ? '#f59e0b' : '#ef4444';
        const convColor  = m?.convRate > 5 ? '#22c55e' : m?.convRate > 2 ? '#f59e0b' : '#ef4444';
        return `
        <div class="card perf-card">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem;margin-bottom:1rem">
            <div>
              <div style="font-weight:700">${title}</div>
              <div class="text-muted" style="font-size:.8rem">${date}</div>
            </div>
            <button class="btn btn-sm btn-primary" onclick="openAddMetrics('${a.id}','${title.replace(/'/g,"\\'")}')">
              + הוסף נתונים
            </button>
          </div>
          ${m ? `
          <div class="perf-metrics-row">
            <div class="perf-metric">
              <div class="perf-metric-val" style="color:${m.impressions>0?'#1e293b':'#94a3b8'}">${m.impressions > 0 ? m.impressions.toLocaleString() : '—'}</div>
              <div class="perf-metric-label">חשיפות</div>
            </div>
            <div class="perf-metric">
              <div class="perf-metric-val" style="color:${m.clicks>0?'#6366f1':'#94a3b8'}">${m.clicks > 0 ? m.clicks.toLocaleString() : '—'}</div>
              <div class="perf-metric-label">קליקים</div>
            </div>
            <div class="perf-metric">
              <div class="perf-metric-val" style="color:${m.ctr!=null?ctrColor:'#94a3b8'}">${m.ctr != null ? m.ctr + '%' : '—'}</div>
              <div class="perf-metric-label">CTR</div>
            </div>
            <div class="perf-metric">
              <div class="perf-metric-val" style="color:${m.conversions>0?'#22c55e':'#94a3b8'}">${m.conversions > 0 ? m.conversions : '—'}</div>
              <div class="perf-metric-label">המרות</div>
            </div>
            <div class="perf-metric">
              <div class="perf-metric-val" style="color:${m.convRate!=null?convColor:'#94a3b8'}">${m.convRate != null ? m.convRate + '%' : '—'}</div>
              <div class="perf-metric-label">Conv%</div>
            </div>
            <div class="perf-metric">
              <div class="perf-metric-val" style="color:${m.revenue>0?'#16a34a':'#94a3b8'}">${m.revenue > 0 ? '₪' + m.revenue.toLocaleString() : '—'}</div>
              <div class="perf-metric-label">הכנסה</div>
            </div>
          </div>` : `
          <div style="padding:.75rem;background:#f8fafc;border-radius:.5rem;color:#94a3b8;font-size:.875rem;text-align:center">
            אין נתונים עדיין — לחץ "הוסף נתונים"
          </div>`}
        </div>`;
      }).join('')}
    </div>

    <!-- Modal for adding metrics -->
    <div id="metrics-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center">
      <div class="card" style="width:min(480px,90vw);max-height:80vh;overflow-y:auto">
        <div class="card-title flex items-center justify-between">
          <span id="metrics-modal-title">הוסף נתונים</span>
          <button onclick="closeMetricsModal()" style="background:none;border:none;font-size:1.25rem;cursor:pointer">✕</button>
        </div>
        <form onsubmit="submitMetrics(event)">
          <input type="hidden" id="metrics-asset-id">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
            <div class="form-group">
              <label class="form-label">חשיפות</label>
              <input id="m-impressions" type="number" min="0" class="form-input" placeholder="0">
            </div>
            <div class="form-group">
              <label class="form-label">קליקים</label>
              <input id="m-clicks" type="number" min="0" class="form-input" placeholder="0">
            </div>
            <div class="form-group">
              <label class="form-label">המרות</label>
              <input id="m-conversions" type="number" min="0" class="form-input" placeholder="0">
            </div>
            <div class="form-group">
              <label class="form-label">הכנסה (₪)</label>
              <input id="m-revenue" type="number" min="0" step="0.01" class="form-input" placeholder="0">
            </div>
          </div>
          <div id="metrics-error" class="form-error" style="display:none;margin-bottom:.75rem"></div>
          <div style="display:flex;gap:.75rem;justify-content:flex-end">
            <button type="button" onclick="closeMetricsModal()" class="btn btn-secondary" style="width:auto">ביטול</button>
            <button type="submit" id="metrics-submit" class="btn btn-primary" style="width:auto">שמור</button>
          </div>
        </form>
      </div>
    </div>
  `);
}

function openAddMetrics(assetId, title) {
  const modal = document.getElementById('metrics-modal');
  if (!modal) return;
  document.getElementById('metrics-asset-id').value = assetId;
  document.getElementById('metrics-modal-title').textContent = 'הוסף נתונים — ' + title;
  ['m-impressions','m-clicks','m-conversions','m-revenue'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('metrics-error').style.display = 'none';
  modal.style.display = 'flex';
}

function closeMetricsModal() {
  const modal = document.getElementById('metrics-modal');
  if (modal) modal.style.display = 'none';
}

async function submitMetrics(e) {
  e.preventDefault();
  const btn    = document.getElementById('metrics-submit');
  const errEl  = document.getElementById('metrics-error');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'שומר...';

  try {
    await api('POST', 'asset-metrics', {
      asset_id:    document.getElementById('metrics-asset-id').value,
      impressions: parseInt(document.getElementById('m-impressions').value) || 0,
      clicks:      parseInt(document.getElementById('m-clicks').value)      || 0,
      conversions: parseInt(document.getElementById('m-conversions').value) || 0,
      revenue:     parseFloat(document.getElementById('m-revenue').value)   || 0,
    });

    // Advance onboarding for metrics
    if (!state.onboardingSteps?.has_metrics) {
      state.onboardingSteps = { ...(state.onboardingSteps || {}), has_metrics: true };
      state.unlockedScreens = computeUnlockedScreens(state.onboardingSteps);
      await sb.from('onboarding_progress').upsert({
        user_id: state.user.id,
        steps: state.onboardingSteps,
        current_step: 'has_metrics',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    }

    closeMetricsModal();
    toast('נתונים נשמרו', 'success');
    renderPerformance();
  } catch (err) {
    errEl.textContent = err.message || 'שגיאה בשמירה';
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'שמור';
  }
}

async function syncPerformance() {
  const btn = document.getElementById('sync-perf-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner" style="width:1rem;height:1rem;border-width:2px"></span> מסנכרן...'; }

  try {
    const res = await api('POST', 'sync-performance', { provider: 'all', datePreset: 'last_30d' });
    const succeeded = (res.synced || []).filter(s => !s.skipped);
    const skipped   = (res.synced || []).filter(s => s.skipped);

    if (succeeded.length > 0) {
      const providers = succeeded.map(s => s.provider === 'google_ads' ? 'Google Ads' : 'Meta').join(', ');
      toast(`סונכרן מ-${providers}`, 'success');
      // advance onboarding locally
      if (!state.onboardingSteps?.has_metrics) {
        state.onboardingSteps = { ...(state.onboardingSteps || {}), has_metrics: true };
        state.unlockedScreens = computeUnlockedScreens(state.onboardingSteps);
      }
      renderPerformance();
    } else if (skipped.length > 0) {
      const reasons = skipped.map(s => {
        if (s.reason === 'not_connected') return `${s.provider === 'google_ads' ? 'Google Ads' : 'Meta'} לא מחובר`;
        return s.error || 'שגיאה';
      }).join(', ');
      toast(reasons, 'warning');
      if (btn) { btn.disabled = false; btn.innerHTML = '<span>↻</span> סנכרן מ-Ads'; }
    }
  } catch (err) {
    toast(err.message || 'שגיאת סנכרון', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<span>↻</span> סנכרן מ-Ads'; }
  }
}

// ── Unit Economics Screen ─────────────────────────────────────────────────────
async function renderEconomics() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  let econ = null;
  let closeRate = 1.0;
  try {
    econ = await api('GET', `get-economics?close_rate=${closeRate}`);
  } catch {}

  if (!econ?.hasProfile) {
    renderShell(`
      <div class="page-header"><h1 class="page-title">כלכלת יחידה</h1></div>
      <div class="card" style="text-align:center;padding:3rem">
        <div style="font-size:3rem;margin-bottom:1rem">💰</div>
        <h3 style="font-weight:700;margin-bottom:.5rem">מלא פרופיל עסקי קודם</h3>
        <p class="text-muted" style="margin-bottom:1.5rem">כדי לחשב CAC, LTV, ROAS צריך מחיר ותקציב</p>
        <button class="btn btn-gradient" style="width:auto" onclick="navigate('business-profile')">מלא פרופיל →</button>
      </div>`);
    return;
  }

  const u  = econ.unitEconomics || {};
  const p  = econ.profile       || {};
  const ag = econ.aggregateMetrics || {};
  const sim = econ.simulation;

  const metricCard = (label, value, sub, color = '#1e293b') => `
    <div class="econ-card">
      <div class="econ-label">${label}</div>
      <div class="econ-value" style="color:${color}">${value ?? '—'}</div>
      ${sub ? `<div class="econ-sub">${sub}</div>` : ''}
    </div>`;

  const statusColor = { profitable: '#22c55e', marginal: '#f59e0b', losing: '#ef4444' }[u.cplStatus] || '#94a3b8';

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">כלכלת יחידה</h1>
        <p class="page-subtitle">${p.business_name || ''} · מחיר: ${p.price_amount ? '₪'+p.price_amount : 'לא הוגדר'}</p>
      </div>
      ${!econ.hasLiveData ? `<span class="badge badge-yellow">סימולציה — אין נתוני ביצועים</span>` : '<span class="badge badge-green">נתונים אמיתיים</span>'}
    </div>

    ${!econ.hasLiveData && sim ? `
    <div class="card mb-4" style="border-right:4px solid #f59e0b;background:#fffbeb">
      <div style="font-weight:600;margin-bottom:.5rem">🔮 סימולציה לפני השקה (7 ימים, ₪${sim.totalSpend} תקציב)</div>
      <div class="econ-grid">
        ${metricCard('קליקים צפויים', sim.clicks?.toLocaleString(), null, '#6366f1')}
        ${metricCard('לידים צפויים', sim.leads, null, '#8b5cf6')}
        ${metricCard('מכירות צפויות', sim.sales, null, '#22c55e')}
        ${metricCard('הכנסה צפויה', sim.estimatedRevenue ? '₪'+sim.estimatedRevenue : null, null, '#16a34a')}
        ${metricCard('ROAS צפוי', sim.estimatedROAS, null, sim.estimatedROAS >= 2 ? '#22c55e' : sim.estimatedROAS >= 1 ? '#f59e0b' : '#ef4444')}
        ${metricCard('רמת סיכון', sim.riskLevel === 'low' ? '🟢 נמוך' : sim.riskLevel === 'medium' ? '🟡 בינוני' : '🔴 גבוה', null)}
      </div>
    </div>` : ''}

    <div class="card mb-4">
      <div class="card-title">📊 מדדי ליבה</div>
      <div class="econ-grid">
        ${metricCard('CPL', u.cpl ? '₪'+u.cpl : null, 'עלות לליד', statusColor)}
        ${metricCard('CAC', u.cac ? '₪'+u.cac : null, 'עלות לרכישה', u.cac && p.price_amount && u.cac < p.price_amount ? '#22c55e' : '#ef4444')}
        ${metricCard('LTV', u.ltv ? '₪'+u.ltv : null, 'ערך לקוח', '#6366f1')}
        ${metricCard('ROAS', u.roas, u.roasLabel, u.roas >= 2 ? '#22c55e' : u.roas >= 1 ? '#f59e0b' : '#ef4444')}
        ${metricCard('Break-even CPL', u.breakEvenCPL ? '₪'+u.breakEvenCPL : null, 'מקסימום CPL רווחי', '#8b5cf6')}
        ${metricCard('CPL מומלץ', u.sustainableCPL ? '₪'+u.sustainableCPL : null, 'עם 40% מרג׳ין', '#22c55e')}
      </div>
      ${u.cplStatus ? `
      <div style="margin-top:1rem;padding:.75rem 1rem;border-radius:.5rem;background:${statusColor}15;border:1px solid ${statusColor}30">
        <span style="font-weight:600;color:${statusColor}">${u.cplStatusLabel}</span>
        ${u.paybackMonths ? ` · החזר השקעה תוך ${u.paybackMonths} חודשים` : ''}
        ${u.margin != null ? ` · מרג׳ין: ${Math.round(u.margin*100)}%` : ''}
      </div>` : ''}
    </div>

    ${ag.clicks > 0 ? `
    <div class="card mb-4">
      <div class="card-title">📈 נתוני ביצועים מצטברים</div>
      <div class="econ-grid">
        ${metricCard('חשיפות', ag.impressions?.toLocaleString(), null)}
        ${metricCard('קליקים', ag.clicks?.toLocaleString(), null, '#6366f1')}
        ${metricCard('CTR', ag.ctr ? (ag.ctr*100).toFixed(2)+'%' : null, null)}
        ${metricCard('המרות', ag.conversions, null, '#22c55e')}
        ${metricCard('הכנסה', ag.revenue ? '₪'+ag.revenue.toLocaleString() : null, null, '#16a34a')}
        ${metricCard('דפים', ag.assetCount, 'עם נתונים')}
      </div>
    </div>` : ''}

    <div class="card">
      <div class="card-title">⚙️ הגדרות חישוב</div>
      <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
        <div class="form-group" style="margin:0">
          <label class="form-label">Close Rate (% לידים שהפכו ללקוחות)</label>
          <input id="econ-close-rate" type="number" min="1" max="100" class="form-input" style="width:120px"
            value="${Math.round(closeRate*100)}" placeholder="100">
        </div>
        <button class="btn btn-secondary" style="width:auto;margin-top:1.5rem"
          onclick="recalcEconomics()">חשב מחדש</button>
      </div>
    </div>
  `);
}

async function recalcEconomics() {
  const closeInput = document.getElementById('econ-close-rate');
  const rate = Math.min(100, Math.max(1, parseInt(closeInput?.value) || 100)) / 100;
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  try {
    const econ = await api('GET', `get-economics?close_rate=${rate}`);
    // re-render with new data by storing and re-calling
    renderEconomics();
  } catch {
    renderEconomics();
  }
}

// ── Copy Generator Screen ─────────────────────────────────────────────────────
async function renderCopyGenerator() {
  renderShell('<div class="loading-screen" style="height:40vh"><div class="spinner"></div></div>');

  const profile = state.businessProfile;
  const copyTypes = [
    { id: 'facebook_ad',   icon: '📘', label: 'מודעת פייסבוק/אינסטגרם', prompt: 'כתוב לי תסריט מודעת פייסבוק/אינסטגרם' },
    { id: 'google_ad',     icon: '🟢', label: 'מודעת גוגל',              prompt: 'כתוב לי מודעת רשת חיפוש לגוגל' },
    { id: 'email',         icon: '📧', label: 'אימייל שיווקי',           prompt: 'כתוב לי אימייל שיווקי' },
    { id: 'sms',           icon: '📱', label: 'SMS/ווצאפ',               prompt: 'כתוב לי הודעת SMS שיווקית' },
    { id: 'headline',      icon: '🎯', label: 'כותרות A/B',              prompt: 'כתוב לי 5 וריאציות כותרת לדף נחיתה' },
    { id: 'landing_page',  icon: '🚀', label: 'דף נחיתה',               prompt: 'בנה לי דף נחיתה' },
  ];

  renderShell(`
    <div class="page-header">
      <h1 class="page-title">קופי</h1>
      <p class="page-subtitle">בחר סוג תוכן וה-AI יכתוב לך מיידית</p>
    </div>

    ${profile ? `
    <div class="card mb-4" style="background:#f8f7ff;border:1px solid #e0e7ff;padding:.75rem 1rem">
      <div style="display:flex;align-items:center;gap:.5rem;font-size:.875rem">
        <span>🏢</span>
        <span style="font-weight:600">${profile.business_name || 'העסק שלך'}</span>
        ${profile.offer ? `<span class="text-muted">· ${profile.offer.slice(0,60)}${profile.offer.length>60?'...':''}</span>` : ''}
        <button class="btn btn-sm btn-secondary" style="margin-right:auto" onclick="navigate('business-profile')">ערוך</button>
      </div>
    </div>` : `
    <div class="card mb-4" style="border-right:3px solid #f59e0b;background:#fffbeb;padding:.75rem 1rem">
      <span style="font-size:.875rem">💡 <strong>טיפ:</strong> מלא פרופיל עסקי לתוצאות מדויקות יותר</span>
      <button class="btn btn-sm btn-primary" style="margin-right:.75rem" onclick="navigate('business-profile')">מלא עכשיו</button>
    </div>`}

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-bottom:2rem">
      ${copyTypes.map(t => `
      <div class="copy-type-card" onclick="startCopyGeneration('${t.id}','${t.prompt}','${t.label}')">
        <div class="copy-type-icon">${t.icon}</div>
        <div class="copy-type-label">${t.label}</div>
        <div class="copy-type-cta">יצור עכשיו →</div>
      </div>`).join('')}
    </div>

    <div class="card" id="copy-recent">
      <div class="card-title">🗂️ תוצרים אחרונים</div>
      <div id="copy-recent-list">
        <div class="text-muted text-sm" style="padding:.5rem">טוען...</div>
      </div>
    </div>
  `);

  // Load recent copy assets in background
  sb.from('generated_assets')
    .select('id,asset_type,title,preview_url,created_at,status')
    .eq('user_id', state.user.id)
    .in('asset_type', ['facebook_ad','google_ad','email','sms','headline','ad_copy','script'])
    .order('created_at', { ascending: false })
    .limit(10)
    .then(({ data }) => {
      const el = document.getElementById('copy-recent-list');
      if (!el) return;
      if (!data?.length) { el.innerHTML = '<div class="text-muted text-sm" style="padding:.5rem">אין תוצרים עדיין — צור את הראשון!</div>'; return; }
      el.innerHTML = data.map(a => `
        <div class="campaign-item">
          <div>
            <div class="campaign-name">${a.title || a.asset_type}</div>
            <div class="campaign-meta">${new Date(a.created_at).toLocaleDateString('he-IL')}</div>
          </div>
          ${a.preview_url ? `<a href="${a.preview_url}" target="_blank" class="btn btn-sm btn-secondary" style="text-decoration:none">צפה</a>` : ''}
        </div>`).join('');
    }).catch(() => {});
}

function startCopyGeneration(typeId, prompt, label) {
  if (!chatState.open) toggleChat();
  const profileContext = state.businessProfile?.offer
    ? ` עבור: ${state.businessProfile.offer}` : '';
  const inp = document.getElementById('chat-input');
  if (inp) {
    inp.value = prompt + profileContext;
    inp.focus();
    inp.dispatchEvent(new Event('input'));
  }
  toast(`יוצר ${label}...`, 'info');
}

// ── A/B Tests Screen ──────────────────────────────────────────────────────────
async function renderAbTests() {
  renderShell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');

  let tests = [];
  let assets = [];
  try {
    const [testsRes, assetsRes] = await Promise.all([
      sb.from('ab_tests').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false }),
      sb.from('generated_assets').select('id,title,asset_type,created_at').eq('user_id', state.user.id)
        .eq('status', 'published').order('created_at', { ascending: false }).limit(20),
    ]);
    tests  = testsRes.data  || [];
    assets = assetsRes.data || [];
  } catch {}

  const statusLabel = { running: '🟡 פעיל', completed: '✅ הסתיים', paused: '⏸️ מושהה' };
  const urgLabel    = (v) => v >= 8 ? '🔴 גבוהה' : v >= 5 ? '🟡 בינונית' : '🟢 נמוכה';

  renderShell(`
    <div class="page-header flex items-center justify-between">
      <div>
        <h1 class="page-title">A/B Tests</h1>
        <p class="page-subtitle">${tests.length} טסטים סה"כ</p>
      </div>
      ${assets.length > 0 ? `<button class="btn btn-gradient" style="width:auto" onclick="openNewAbTest()">+ טסט חדש</button>` : ''}
    </div>

    ${tests.length === 0 ? `
    <div class="card" style="text-align:center;padding:3rem 2rem">
      <div style="font-size:3rem;margin-bottom:1rem">🧪</div>
      <h3 style="font-weight:700;margin-bottom:.5rem">אין טסטים עדיין</h3>
      <p class="text-muted" style="margin-bottom:1.5rem">הגדר A/B test כדי לדעת איזה כותרת / עיצוב / CTA עובד יותר</p>
      ${assets.length > 0
        ? `<button class="btn btn-gradient" style="width:auto" onclick="openNewAbTest()">צור טסט ראשון →</button>`
        : `<p class="text-muted">פרסם דפי נחיתה קודם כדי להתחיל טסטים</p>`}
    </div>` : `
    <div style="display:grid;gap:1rem">
      ${tests.map(t => `
      <div class="card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem">
              <span style="font-weight:700">${t.hypothesis || 'ללא כותרת'}</span>
              <span style="font-size:.75rem">${statusLabel[t.status] || t.status}</span>
            </div>
            <div class="text-muted" style="font-size:.8rem;margin-bottom:.5rem">
              משתנה: <strong>${t.variable_tested || '—'}</strong> ·
              ${new Date(t.created_at).toLocaleDateString('he-IL')}
              ${t.end_date ? ' → ' + new Date(t.end_date).toLocaleDateString('he-IL') : ''}
            </div>
            ${t.result ? `<div style="padding:.5rem .75rem;background:#f0fdf4;border-radius:.375rem;font-size:.875rem;color:#15803d">🏆 ${t.result}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.5rem">
            <span style="font-size:.75rem;color:#6366f1">דחיפות: ${urgLabel(t.urgency || 0)}</span>
            ${t.status === 'running' ? `
            <button class="btn btn-sm" style="background:#fef9c3;color:#92400e;border:1px solid #fde68a"
              onclick="concludeAbTest('${t.id}')">סיים טסט</button>` : ''}
          </div>
        </div>
      </div>`).join('')}
    </div>`}

    <!-- New AB Test Modal -->
    <div id="ab-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center">
      <div class="card" style="width:min(540px,92vw);max-height:85vh;overflow-y:auto">
        <div class="card-title flex items-center justify-between">
          <span>🧪 טסט חדש</span>
          <button onclick="closeAbModal()" style="background:none;border:none;font-size:1.25rem;cursor:pointer">✕</button>
        </div>
        <form onsubmit="submitAbTest(event)">
          <div style="display:grid;gap:1rem">
            <div class="form-group">
              <label class="form-label">היפותזה — מה אתה בודק?</label>
              <input id="ab-hypothesis" class="form-input" required maxlength="500"
                placeholder='לדוגמה: "כותרת שמדגישה תוצאה תמיר יותר מכותרת שמדגישה מחיר"'>
            </div>
            <div class="form-group">
              <label class="form-label">משתנה נבדק</label>
              <select id="ab-variable" class="form-input" required>
                <option value="">בחר...</option>
                ${['headline','cta','image','color','price_display','layout','copy_length'].map(v =>
                  `<option value="${v}">${{headline:'כותרת',cta:'CTA',image:'תמונה',color:'צבע',price_display:'תצוגת מחיר',layout:'מבנה',copy_length:'אורך טקסט'}[v]||v}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Asset לבדיקה</label>
              <select id="ab-campaign" class="form-input">
                <option value="">ללא קישור לasset ספציפי</option>
                ${assets.map(a => `<option value="${a.id}">${a.title || a.asset_type} (${new Date(a.created_at).toLocaleDateString('he-IL')})</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">מה קבוע (לא משתנה)</label>
              <input id="ab-constant" class="form-input" maxlength="300"
                placeholder="מה לא תשנה במהלך הטסט">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
              <div class="form-group">
                <label class="form-label">תאריך סיום</label>
                <input id="ab-end-date" type="date" class="form-input">
              </div>
              <div class="form-group">
                <label class="form-label">דחיפות (1–10)</label>
                <input id="ab-urgency" type="number" min="1" max="10" class="form-input" value="5">
              </div>
            </div>
          </div>
          <div id="ab-error" class="form-error" style="display:none;margin-top:.75rem;margin-bottom:.5rem"></div>
          <div style="display:flex;gap:.75rem;justify-content:flex-end;margin-top:1rem">
            <button type="button" onclick="closeAbModal()" class="btn btn-secondary" style="width:auto">ביטול</button>
            <button type="submit" id="ab-submit" class="btn btn-gradient" style="width:auto">צור טסט</button>
          </div>
        </form>
      </div>
    </div>
  `);
}

function openNewAbTest() {
  const modal = document.getElementById('ab-modal');
  if (modal) modal.style.display = 'flex';
}
function closeAbModal() {
  const modal = document.getElementById('ab-modal');
  if (modal) modal.style.display = 'none';
}

async function submitAbTest(e) {
  e.preventDefault();
  const btn   = document.getElementById('ab-submit');
  const errEl = document.getElementById('ab-error');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'יוצר...';

  try {
    const hypothesis   = document.getElementById('ab-hypothesis').value.trim();
    const variable     = document.getElementById('ab-variable').value;
    const campaignId   = document.getElementById('ab-campaign').value || null;
    const constantPart = document.getElementById('ab-constant').value.trim();
    const endDate      = document.getElementById('ab-end-date').value || null;
    const urgency      = parseInt(document.getElementById('ab-urgency').value) || 5;

    await sb.from('ab_tests').insert({
      user_id:          state.user.id,
      hypothesis,
      variable_tested:  variable,
      campaign_id:      campaignId,
      constant_element: constantPart || null,
      end_date:         endDate || null,
      urgency,
      effort:           5,
      confidence:       0.5,
      status:           'running',
    });

    // Advance onboarding
    if (!state.onboardingSteps?.has_ab_data) {
      state.onboardingSteps = { ...(state.onboardingSteps || {}), has_ab_data: true };
      state.unlockedScreens = computeUnlockedScreens(state.onboardingSteps);
      await sb.from('onboarding_progress').upsert({
        user_id: state.user.id,
        steps: state.onboardingSteps,
        current_step: 'has_ab_data',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    }

    closeAbModal();
    toast('טסט נוצר בהצלחה', 'success');
    renderAbTests();
  } catch (err) {
    errEl.textContent = err.message || 'שגיאה ביצירת טסט';
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'צור טסט';
  }
}

async function concludeAbTest(testId) {
  const result = prompt('מה הייתה התוצאה? (כתוב את ה-winner וסיכום קצר)');
  if (!result) return;
  try {
    await sb.from('ab_tests').update({ status: 'completed', result, updated_at: new Date().toISOString() })
      .eq('id', testId).eq('user_id', state.user.id);
    toast('טסט הסתיים ✅', 'success');
    renderAbTests();
  } catch (err) {
    toast(err.message || 'שגיאה', 'error');
  }
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
window.toggleChat            = toggleChat;
window.submitChatMessage     = submitChatMessage;
window.clearChatHistory      = clearChatHistory;
window.handleQuickAction     = handleQuickAction;
window.submitSupportTicket   = submitSupportTicket;
window.saveBizProfile        = saveBizProfile;
window.openLandingPageCreator = openLandingPageCreator;
window.createVariation       = createVariation;
window.archiveAsset          = archiveAsset;
window.openAddMetrics        = openAddMetrics;
window.closeMetricsModal     = closeMetricsModal;
window.submitMetrics         = submitMetrics;
window.syncPerformance       = syncPerformance;
window.recalcEconomics       = recalcEconomics;
window.startCopyGeneration   = startCopyGeneration;
window.openNewAbTest         = openNewAbTest;
window.closeAbModal          = closeAbModal;
window.submitAbTest          = submitAbTest;
window.concludeAbTest        = concludeAbTest;

boot();
