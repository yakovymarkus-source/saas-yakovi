/* ════════════════════════════════════════════════════════════════
   CampaignAI — Admin Dashboard SPA
   ════════════════════════════════════════════════════════════════ */

const CONFIG = {
  supabaseUrl: window.__SUPABASE_URL__  || '',
  supabaseKey: window.__SUPABASE_ANON_KEY__ || '',
  api: '/.netlify/functions',
};

const { createClient } = supabase;
const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

// ── State ─────────────────────────────────────────────────────────────────────
let state = { user: null, page: 'overview', userId: null };

// ── API ───────────────────────────────────────────────────────────────────────
async function api(method, path, body, params) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = '/'; return; }
  let url = `${CONFIG.api}/${path}`;
  if (params) {
    const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v != null));
    if ([...qs].length) url += '?' + qs.toString();
  }
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 403) { showError('Access denied — admin only'); throw new Error('forbidden'); }
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json.data ?? json;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const c = document.getElementById('tc') || (() => {
    const el = document.createElement('div'); el.id = 'tc'; el.className = 'toast-container';
    document.body.appendChild(el); return el;
  })();
  const t = document.createElement('div'); t.className = `toast ${type}`; t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

function showError(msg) {
  document.getElementById('app').innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem">
    <div style="font-size:2rem">🔒</div><h2>${msg}</h2>
    <button class="btn btn-secondary" onclick="handleLogout()">Sign out</button></div>`;
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function shell(content) {
  const nav = [
    { id: 'overview',      icon: '📊', label: 'Overview' },
    { id: 'users',         icon: '👥', label: 'Users' },
    { id: 'assets-mgmt',   icon: '🚀', label: 'Assets' },
    { id: 'onboarding-mgmt', icon: '🎯', label: 'Onboarding' },
    { id: 'metrics-mgmt',  icon: '📈', label: 'Metrics' },
    { id: 'billing',       icon: '💰', label: 'Billing' },
    { id: 'system',        icon: '🖥️',  label: 'System' },
    { id: 'audit',         icon: '📋', label: 'Audit Log' },
    { id: 'updates-mgmt',  icon: '📣', label: 'Updates' },
    { id: 'support-mgmt',  icon: '🎫', label: 'Support' },
  ];
  document.getElementById('app').innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">Campaign<span>AI</span> <span style="font-size:.7rem;opacity:.5">admin</span></div>
        <nav class="sidebar-nav">
          ${nav.map(n => `<div class="nav-item ${state.page===n.id?'active':''}" onclick="navigate('${n.id}')">
            <span class="icon">${n.icon}</span>${n.label}</div>`).join('')}
        </nav>
        <div class="sidebar-footer">${state.user?.email || ''}<br/>
          <span onclick="handleLogout()" style="cursor:pointer;color:#818cf8">Sign out</span></div>
      </aside>
      <main class="main">${content}</main>
    </div>`;
}

function navigate(page, extra = {}) {
  state.page = page; Object.assign(state, extra); render();
}

// ── Overview ───────────────────────────────────────────────────────────────────
async function renderOverview() {
  shell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let d;
  try { d = await api('GET', 'admin-overview'); } catch { return; }

  const pct = v => (v * 100).toFixed(1) + '%';
  const usd = v => '$' + v.toLocaleString();

  shell(`
    <div class="page-header"><h1 class="page-title">Overview</h1><p class="page-subtitle">Live business metrics</p></div>
    <div class="kpi-grid">
      <div class="kpi-card green"><div class="kpi-label">MRR</div><div class="kpi-value">${usd(d.mrr)}</div><div class="kpi-sub">ARR ${usd(d.mrr*12)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Active Subscriptions</div><div class="kpi-value">${d.activeSubscriptions}</div><div class="kpi-sub">${d.trialSubscriptions} trialing</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Users</div><div class="kpi-value">${d.totalUsers}</div><div class="kpi-sub">+${d.newSignups24h} last 24h</div></div>
      <div class="kpi-card"><div class="kpi-label">Conversion Rate</div><div class="kpi-value">${pct(d.conversionRate)}</div><div class="kpi-sub">trial → paid</div></div>
      <div class="kpi-card"><div class="kpi-label">Churn Rate (30d)</div><div class="kpi-value ${d.churnRate>0.05?'text-danger':''}">${pct(d.churnRate)}</div></div>
      <div class="kpi-card ${d.failedPayments24h>0?'red':''}"><div class="kpi-label">Failed Payments</div><div class="kpi-value">${d.failedPayments24h}</div><div class="kpi-sub">last 24h</div></div>
      <div class="kpi-card ${d.systemHealth.failedJobs24h>0?'red':''}"><div class="kpi-label">Failed Jobs (24h)</div><div class="kpi-value">${d.systemHealth.failedJobs24h}</div></div>
      <div class="kpi-card"><div class="kpi-label">Pending Jobs</div><div class="kpi-value">${d.systemHealth.pendingJobs}</div><div class="kpi-sub">${d.systemHealth.runningJobs} running</div></div>
    </div>
    <div class="chart-grid">
      <div class="chart-wrap"><div class="chart-title">MRR Trend (30 days)</div><canvas id="mrr-chart" height="120"></canvas></div>
      <div class="chart-wrap"><div class="chart-title">Signups (30 days)</div><canvas id="signup-chart" height="120"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title">Provider Health</div>
      <table><thead><tr><th>Provider</th><th>Status</th><th>Failures</th><th>Last checked</th></tr></thead>
      <tbody>${(d.systemHealth.providerHealth||[]).map(p=>`<tr>
        <td><strong>${p.provider}</strong></td>
        <td>${p.circuit_open_until && new Date(p.circuit_open_until)>new Date()
          ? '<span class="badge badge-red">circuit open</span>'
          : '<span class="badge badge-green">ok</span>'}</td>
        <td>${p.consecutive_failures}</td>
        <td class="text-muted">${p.last_checked_at ? new Date(p.last_checked_at).toLocaleString() : '—'}</td>
      </tr>`).join('')||'<tr><td colspan="4" class="text-center text-muted" style="padding:1rem">No data yet</td></tr>'}
      </tbody></table>
    </div>`);

  drawBarChart('mrr-chart', d.mrrTrend.map(r=>r.date), d.mrrTrend.map(r=>r.revenueCents/100), '#6366f1', '$');
  drawBarChart('signup-chart', d.signupTrend.map(r=>r.date), d.signupTrend.map(r=>r.count), '#22c55e');
}

// ── Bar chart (native Canvas) ─────────────────────────────────────────────────
function drawBarChart(id, labels, values, color, prefix = '') {
  const canvas = document.getElementById(id);
  if (!canvas || !values.length) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 400;
  canvas.width = W; canvas.height = 120;
  const PAD = { top: 10, right: 10, bottom: 28, left: 44 };
  const w = W - PAD.left - PAD.right;
  const h = canvas.height - PAD.top - PAD.bottom;
  const max = Math.max(...values, 1);
  const barW = Math.max(2, w / values.length - 2);

  ctx.clearRect(0, 0, W, canvas.height);
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, W, canvas.height);

  // Grid lines
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
  [0, 0.5, 1].forEach(f => {
    const y = PAD.top + h * (1 - f);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + w, y); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px Inter,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(prefix + Math.round(max * f).toLocaleString(), PAD.left - 4, y + 3);
  });

  values.forEach((v, i) => {
    const barH = Math.max(2, (v / max) * h);
    const x = PAD.left + i * (w / values.length) + 1;
    const y = PAD.top + h - barH;
    ctx.fillStyle = color + 'cc';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]) : ctx.rect(x, y, barW, barH);
    ctx.fill();

    // X label (every N bars)
    const step = Math.max(1, Math.floor(values.length / 6));
    if (i % step === 0 && labels[i]) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(labels[i].slice(5), x + barW / 2, PAD.top + h + 14);
    }
  });
}

// ── Users ─────────────────────────────────────────────────────────────────────
let usersState = { page: 1, search: '', plan: '', status: '' };

async function renderUsers() {
  shell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let d;
  try { d = await api('GET', 'admin-users', null, { page: usersState.page, search: usersState.search || undefined, plan: usersState.plan || undefined, status: usersState.status || undefined }); }
  catch { return; }

  const planBadge = { free: 'badge-gray', starter: 'badge-blue', pro: 'badge-green', agency: 'badge-purple' };
  const statusBadge = { active: 'badge-green', trialing: 'badge-blue', canceled: 'badge-gray', past_due: 'badge-red', incomplete: 'badge-yellow' };

  shell(`
    <div class="page-header flex items-center justify-between">
      <div><h1 class="page-title">Users</h1><p class="page-subtitle">${d.total} total</p></div>
    </div>
    <div class="filter-bar">
      <input class="filter-input" id="search-input" placeholder="Search email…" value="${usersState.search}" oninput="usersState.search=this.value" onkeydown="if(event.key==='Enter'){usersState.page=1;renderUsers()}"/>
      <select class="filter-select" onchange="usersState.plan=this.value;usersState.page=1;renderUsers()">
        <option value="">All plans</option>
        <option value="free" ${usersState.plan==='free'?'selected':''}>Free</option>
        <option value="starter" ${usersState.plan==='starter'?'selected':''}>Starter</option>
        <option value="pro" ${usersState.plan==='pro'?'selected':''}>Pro</option>
        <option value="agency" ${usersState.plan==='agency'?'selected':''}>Agency</option>
      </select>
      <select class="filter-select" onchange="usersState.status=this.value;usersState.page=1;renderUsers()">
        <option value="">All statuses</option>
        <option value="active" ${usersState.status==='active'?'selected':''}>Active</option>
        <option value="trialing" ${usersState.status==='trialing'?'selected':''}>Trialing</option>
        <option value="canceled" ${usersState.status==='canceled'?'selected':''}>Canceled</option>
        <option value="past_due" ${usersState.status==='past_due'?'selected':''}>Past Due</option>
      </select>
      <button class="btn btn-primary" onclick="usersState.page=1;renderUsers()">Filter</button>
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Email</th><th>Name</th><th>Plan</th><th>Status</th><th>Campaigns</th><th>Last Active</th><th>Signed Up</th></tr></thead>
          <tbody>
            ${d.users.map(u => `<tr onclick="navigate('user-detail',{userId:'${u.id}'})" class="clickable">
              <td><span class="truncate" style="max-width:200px;display:block">${u.email}</span>${u.isAdmin?'<span class="badge badge-purple" style="margin-top:2px">admin</span>':''}</td>
              <td>${u.name||'—'}</td>
              <td><span class="badge ${planBadge[u.plan]||'badge-gray'}">${u.plan}</span></td>
              <td><span class="badge ${statusBadge[u.status]||'badge-gray'}">${u.status||'—'}</span></td>
              <td>${u.campaignCount}</td>
              <td class="text-muted">${u.lastActiveAt?new Date(u.lastActiveAt).toLocaleDateString():'—'}</td>
              <td class="text-muted">${new Date(u.createdAt).toLocaleDateString()}</td>
            </tr>`).join('')||'<tr><td colspan="7" class="text-center text-muted" style="padding:2rem">No users found</td></tr>'}
          </tbody>
        </table>
      </div>
      ${renderPagination(d.page, d.limit, d.total, p => { usersState.page=p; renderUsers(); })}
    </div>`);
}

function renderPagination(page, limit, total, onPage) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return '';
  const items = [];
  for (let p = Math.max(1, page-2); p <= Math.min(pages, page+2); p++) {
    items.push(`<button class="page-btn ${p===page?'active':''}" onclick="(${onPage.toString()})(${p})">${p}</button>`);
  }
  return `<div class="pagination">
    <button class="page-btn" ${page<=1?'disabled':''} onclick="(${onPage.toString()})(${page-1})">‹</button>
    ${items.join('')}
    <button class="page-btn" ${page>=pages?'disabled':''} onclick="(${onPage.toString()})(${page+1})">›</button>
    <span>${(page-1)*limit+1}–${Math.min(page*limit,total)} of ${total}</span>
  </div>`;
}

// ── User Detail ───────────────────────────────────────────────────────────────
async function renderUserDetail() {
  shell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  const userId = state.userId;
  let d;
  try { d = await api('GET', 'admin-user', null, { userId }); } catch { return; }

  const p   = d.profile;
  const sub = d.subscription;
  const planBadge = { free: 'badge-gray', starter: 'badge-blue', pro: 'badge-green', agency: 'badge-purple' };
  const statusBadge = { active: 'badge-green', trialing: 'badge-blue', canceled: 'badge-gray', past_due: 'badge-red' };

  shell(`
    <div class="page-header">
      <button class="btn btn-secondary btn-sm" onclick="navigate('users')" style="margin-bottom:.75rem">← Back to Users</button>
      <div class="flex items-center justify-between">
        <div><h1 class="page-title">${p.name||p.email}</h1><p class="page-subtitle">${p.email}</p></div>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" onclick="adminToggle('${p.id}','${!p.is_admin}')">
            ${p.is_admin?'Revoke Admin':'Grant Admin'}</button>
          ${sub?.stripe_sub_id?`<button class="btn btn-danger btn-sm" onclick="adminCancelSub('${p.id}')">Cancel Subscription</button>`:''}
        </div>
      </div>
    </div>
    <div class="detail-grid">
      <div class="card">
        <div class="card-title">Profile</div>
        <div class="detail-row"><span class="detail-label">User ID</span><span class="detail-value text-xs" style="font-family:monospace">${p.id}</span></div>
        <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${p.email}</span></div>
        <div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${p.name||'—'}</span></div>
        <div class="detail-row"><span class="detail-label">Admin</span><span class="detail-value">${p.is_admin?'<span class="badge badge-purple">yes</span>':'No'}</span></div>
        <div class="detail-row"><span class="detail-label">Onboarding</span><span class="detail-value">${p.onboarding_completed?'✅ Done':'⏳ Pending'}</span></div>
        <div class="detail-row"><span class="detail-label">Signed up</span><span class="detail-value">${new Date(p.created_at).toLocaleString()}</span></div>
        ${p.deleted_at?`<div class="detail-row"><span class="detail-label">Deleted</span><span class="detail-value text-danger">${new Date(p.deleted_at).toLocaleString()}</span></div>`:''}
      </div>
      <div class="card">
        <div class="card-title">Subscription</div>
        ${sub?`
          <div class="detail-row"><span class="detail-label">Plan</span><span class="detail-value"><span class="badge ${planBadge[sub.plan]||'badge-gray'}">${sub.plan}</span></span></div>
          <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="badge ${statusBadge[sub.status]||'badge-gray'}">${sub.status}</span></span></div>
          <div class="detail-row"><span class="detail-label">Period end</span><span class="detail-value">${sub.current_period_end?new Date(sub.current_period_end).toLocaleDateString():'—'}</span></div>
          <div class="detail-row"><span class="detail-label">Stripe sub</span><span class="detail-value text-xs" style="font-family:monospace">${sub.stripe_sub_id||'—'}</span></div>`
        :'<div class="text-muted" style="padding:.5rem 0">No subscription</div>'}
      </div>
    </div>
    <div class="detail-grid">
      <div class="card">
        <div class="card-title">Usage (30 days)</div>
        <div class="detail-row"><span class="detail-label">Analysis runs</span><span class="detail-value">${d.usageStats.analysisRuns30d}</span></div>
        <div class="detail-row"><span class="detail-label">Usage events</span><span class="detail-value">${d.usageStats.eventsLast30d}</span></div>
        <div class="detail-row"><span class="detail-label">Campaigns</span><span class="detail-value">${d.campaigns.length}</span></div>
      </div>
      <div class="card">
        <div class="card-title">Recent Payments</div>
        ${d.paymentEvents.length?d.paymentEvents.slice(0,5).map(e=>`
          <div class="detail-row">
            <span class="detail-label">${new Date(e.created_at).toLocaleDateString()}</span>
            <span class="detail-value">
              <span class="badge ${e.event_type==='payment_succeeded'?'badge-green':'badge-red'}">${e.event_type==='payment_succeeded'?'+$'+(e.amount_cents/100).toFixed(2):'failed'}</span>
            </span>
          </div>`).join(''):'<div class="text-muted" style="padding:.5rem 0">No payments</div>'}
      </div>
    </div>
    <div class="card">
      <div class="card-title">Recent Audit Log</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
          <tbody>
            ${d.recentAuditLog.map(e=>`<tr>
              <td class="text-muted">${new Date(e.created_at).toLocaleString()}</td>
              <td><code style="font-size:.75rem">${e.action}</code></td>
              <td class="text-muted">${e.target_id||'—'}</td>
              <td class="text-muted">${e.ip||'—'}</td>
            </tr>`).join('')||'<tr><td colspan="4" class="text-center text-muted" style="padding:1rem">No logs</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`);
}

async function adminToggle(targetId) {
  if (!confirm('Toggle admin status for this user?')) return;
  try {
    const r = await api('POST', 'admin-user', { action: 'toggle_admin', targetUserId: targetId });
    toast(`Admin ${r.isAdmin ? 'granted' : 'revoked'}`, 'success');
    renderUserDetail();
  } catch (e) { toast(e.message, 'error'); }
}

async function adminCancelSub(targetId) {
  if (!confirm('Cancel this subscription in Stripe?')) return;
  try {
    await api('POST', 'admin-user', { action: 'cancel_subscription', targetUserId: targetId });
    toast('Subscription canceled', 'success');
    renderUserDetail();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Billing ───────────────────────────────────────────────────────────────────
async function renderBilling() {
  shell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let d;
  try { d = await api('GET', 'admin-billing', null, { days: 30 }); } catch { return; }

  const usd = v => '$' + (v||0).toLocaleString();
  const typeBadge = { payment_succeeded: 'badge-green', payment_failed: 'badge-red', refund: 'badge-yellow', subscription_canceled: 'badge-gray' };

  shell(`
    <div class="page-header"><h1 class="page-title">Billing</h1></div>
    <div class="kpi-grid">
      <div class="kpi-card green"><div class="kpi-label">MRR</div><div class="kpi-value">${usd(d.mrr)}</div><div class="kpi-sub">ARR ${usd(d.arr)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Active Subs</div><div class="kpi-value">${d.activeSubscriptions}</div></div>
      <div class="kpi-card"><div class="kpi-label">Trialing</div><div class="kpi-value">${d.trialSubscriptions}</div></div>
      <div class="kpi-card ${d.failedPayments?.length?'red':''}"><div class="kpi-label">Failed Payments (30d)</div><div class="kpi-value">${d.failedPayments?.length||0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Churned (30d)</div><div class="kpi-value">${d.churnedSubscriptions?.length||0}</div></div>
      <div class="kpi-card"><div class="kpi-label">Revenue Today</div><div class="kpi-value">${usd((d.todayRevenueCents||0)/100)}</div></div>
    </div>
    <div class="chart-grid">
      <div class="chart-wrap" style="grid-column:1/-1"><div class="chart-title">Revenue (30 days)</div><canvas id="rev-chart" height="100"></canvas></div>
    </div>
    ${d.failedPayments?.length?`
    <div class="card mb-4">
      <div class="card-title" style="color:#b91c1c">⚠️ Failed Payments</div>
      <div class="table-wrap"><table>
        <thead><tr><th>User</th><th>Plan</th><th>Amount</th><th>Time</th></tr></thead>
        <tbody>${d.failedPayments.map(e=>`<tr>
          <td>${e.profiles?.email||e.stripe_customer_id||'—'}</td>
          <td>${e.plan||'—'}</td>
          <td>$${(e.amount_cents/100).toFixed(2)}</td>
          <td class="text-muted">${new Date(e.created_at).toLocaleString()}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`:''}
    <div class="card">
      <div class="card-title">Recent Payment Events</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>User</th><th>Plan</th><th>Amount</th><th>Time</th></tr></thead>
        <tbody>${(d.recentPaymentEvents||[]).map(e=>`<tr>
          <td><span class="badge ${typeBadge[e.event_type]||'badge-gray'}">${e.event_type}</span></td>
          <td class="text-muted">${e.profiles?.email||e.stripe_customer_id?.slice(0,16)||'—'}</td>
          <td>${e.plan||'—'}</td>
          <td>$${(e.amount_cents/100).toFixed(2)}</td>
          <td class="text-muted">${new Date(e.created_at).toLocaleDateString()}</td>
        </tr>`).join('')||'<tr><td colspan="5" class="text-center text-muted" style="padding:2rem">No payment events yet</td></tr>'}
        </tbody>
      </table></div>
    </div>`);

  drawBarChart('rev-chart', d.mrrTrend.map(r=>r.date), d.mrrTrend.map(r=>r.revenueCents/100), '#22c55e', '$');
}

// ── System ────────────────────────────────────────────────────────────────────
async function renderSystem() {
  shell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let d;
  try { d = await api('GET', 'admin-system'); } catch { return; }

  const dot = v => `<span class="dot ${v==='ok'?'dot-green':v==='error'?'dot-red':'dot-yellow'}"></span>`;

  shell(`
    <div class="page-header"><h1 class="page-title">System Health</h1></div>
    <div class="kpi-grid">
      <div class="kpi-card ${d.syncJobs.pending>10?'red':''}"><div class="kpi-label">Jobs Pending</div><div class="kpi-value">${d.syncJobs.pending}</div></div>
      <div class="kpi-card"><div class="kpi-label">Jobs Running</div><div class="kpi-value">${d.syncJobs.running}</div></div>
      <div class="kpi-card ${d.syncJobs.recentFailed?.length?'red':''}"><div class="kpi-label">Failed Jobs (24h)</div><div class="kpi-value">${d.syncJobs.recentFailed?.length||0}</div></div>
      <div class="kpi-card ${d.requestMetrics.errorRate1h>0.05?'red':''}"><div class="kpi-label">Error Rate (1h)</div><div class="kpi-value">${(d.requestMetrics.errorRate1h*100).toFixed(1)}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Avg Response (1h)</div><div class="kpi-value">${d.requestMetrics.avgDurationMs}<span style="font-size:1rem">ms</span></div></div>
    </div>
    <div class="detail-grid">
      <div class="card">
        <div class="card-title">Provider Health</div>
        ${d.providerHealth.map(p=>`
          <div class="detail-row">
            <span class="detail-label flex items-center gap-1">${dot(p.consecutive_failures===0?'ok':'error')} ${p.provider}</span>
            <span class="detail-value">${p.consecutive_failures} failures${p.circuit_open_until&&new Date(p.circuit_open_until)>new Date()?' <span class="badge badge-red">circuit open</span>':''}</span>
          </div>`).join('')||'<div class="text-muted">No data</div>'}
      </div>
      <div class="card">
        <div class="card-title">Recent Errors (24h)</div>
        ${(d.requestMetrics.recentErrors||[]).slice(0,8).map(e=>`
          <div class="detail-row">
            <span class="detail-label text-xs">${e.function_name}</span>
            <span class="detail-value text-xs text-danger" style="max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${e.message}</span>
          </div>`).join('')||'<div class="text-muted" style="padding:.5rem 0">No errors 🎉</div>'}
      </div>
    </div>
    ${d.syncJobs.recentFailed?.length?`
    <div class="card">
      <div class="card-title" style="color:#b91c1c">Failed Jobs</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Campaign</th><th>Error</th><th>Time</th></tr></thead>
        <tbody>${d.syncJobs.recentFailed.map(j=>`<tr>
          <td>${j.campaign_id}</td>
          <td class="text-danger text-xs">${j.error_message||'—'}</td>
          <td class="text-muted">${new Date(j.created_at).toLocaleString()}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`:''}`);
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
let auditState = { page: 1, userId: '', action: '' };

async function renderAudit() {
  shell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let d;
  try { d = await api('GET', 'admin-audit', null, { page: auditState.page, userId: auditState.userId||undefined, action: auditState.action||undefined }); }
  catch { return; }

  shell(`
    <div class="page-header"><h1 class="page-title">Audit Log</h1><p class="page-subtitle">${d.total} entries</p></div>
    <div class="filter-bar">
      <input class="filter-input" placeholder="Filter by User ID…" value="${auditState.userId}" oninput="auditState.userId=this.value" onkeydown="if(event.key==='Enter'){auditState.page=1;renderAudit()}"/>
      <input class="filter-input" placeholder="Filter by action…" value="${auditState.action}" oninput="auditState.action=this.value" onkeydown="if(event.key==='Enter'){auditState.page=1;renderAudit()}"/>
      <button class="btn btn-primary" onclick="auditState.page=1;renderAudit()">Filter</button>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
        <tbody>
          ${d.entries.map(e=>`<tr>
            <td class="text-muted" style="white-space:nowrap">${new Date(e.created_at).toLocaleString()}</td>
            <td class="text-xs">${e.userEmail||e.user_id?.slice(0,8)||'—'}</td>
            <td><code style="font-size:.75rem;background:#f1f5f9;padding:.1rem .3rem;border-radius:.25rem">${e.action}</code></td>
            <td class="text-muted text-xs">${e.target_type?`${e.target_type}:${e.target_id||''}`:e.target_id||'—'}</td>
            <td class="text-muted text-xs">${e.ip||'—'}</td>
          </tr>`).join('')||'<tr><td colspan="5" class="text-center text-muted" style="padding:2rem">No entries</td></tr>'}
        </tbody>
      </table></div>
      ${renderPagination(d.page, d.limit, d.total, p => { auditState.page=p; renderAudit(); })}
    </div>`);
}

// ── Updates Management ────────────────────────────────────────────────────────
let updatesAdminState = { editing: null, items: [] };

async function renderAdminUpdates() {
  shell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let items;
  try { items = await api('GET', 'admin-updates'); } catch { return; }
  updatesAdminState.items = items || [];
  _drawUpdatesPage();
}

function _drawUpdatesPage() {
  const { items, editing: ed } = updatesAdminState;
  const typeBadge = { new: 'badge-green', improved: 'badge-blue', fixed: 'badge-yellow' };

  shell(`
    <div class="page-header flex items-center justify-between">
      <div><h1 class="page-title">📣 Updates</h1><p class="page-subtitle">${items.length} total</p></div>
    </div>

    <div class="card mb-4">
      <div class="card-title">${ed ? 'Edit Update' : 'New Update'}</div>
      <form onsubmit="saveUpdate(event)" style="display:grid;gap:.75rem">
        ${ed ? `<input type="hidden" id="upd-id" value="${ed.id}"/>` : ''}
        <input class="filter-input" id="upd-title" placeholder="Title *" value="${ed ? ed.title.replace(/"/g,'&quot;') : ''}" required style="width:100%;box-sizing:border-box"/>
        <textarea class="filter-input" id="upd-content" placeholder="Content *" rows="4" style="width:100%;box-sizing:border-box;resize:vertical">${ed ? ed.content : ''}</textarea>
        <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
          <select class="filter-select" id="upd-type">
            <option value="new"      ${!ed || ed.type==='new'      ? 'selected':''}>New</option>
            <option value="improved" ${ed?.type==='improved'       ? 'selected':''}>Improved</option>
            <option value="fixed"    ${ed?.type==='fixed'          ? 'selected':''}>Fixed</option>
          </select>
          <label style="display:flex;align-items:center;gap:.4rem;font-size:.875rem;cursor:pointer">
            <input type="checkbox" id="upd-published" ${ed?.is_published ? 'checked':''}> Publish
          </label>
          <label style="display:flex;align-items:center;gap:.4rem;font-size:.875rem;cursor:pointer">
            <input type="checkbox" id="upd-pinned" ${ed?.is_pinned ? 'checked':''}> Pin
          </label>
          <button type="submit" class="btn btn-primary" style="width:auto">${ed ? 'Save' : 'Create'}</button>
          ${ed ? '<button type="button" class="btn btn-secondary" onclick="cancelEditUpdate()">Cancel</button>' : ''}
        </div>
      </form>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Pin</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>
            ${items.length === 0
              ? '<tr><td colspan="6" class="text-center text-muted" style="padding:2rem">No updates yet — create one above</td></tr>'
              : items.map(u => `<tr>
                  <td>
                    <div style="font-weight:600;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.title}</div>
                    <div class="text-muted text-xs" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${u.content.slice(0, 70)}${u.content.length > 70 ? '…' : ''}</div>
                  </td>
                  <td><span class="badge ${typeBadge[u.type] || 'badge-gray'}">${u.type}</span></td>
                  <td><span class="badge ${u.is_published ? 'badge-green' : 'badge-gray'}">${u.is_published ? 'Published' : 'Draft'}</span></td>
                  <td>${u.is_pinned ? '📌' : '—'}</td>
                  <td class="text-muted">${new Date(u.created_at).toLocaleDateString()}</td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-sm btn-secondary" onclick="editUpdate('${u.id}')">Edit</button>
                    <button class="btn btn-sm ${u.is_published ? 'btn-secondary' : 'btn-primary'}" style="margin-right:.25rem" onclick="togglePublishUpdate('${u.id}',${!u.is_published})">${u.is_published ? 'Unpublish' : 'Publish'}</button>
                    <button class="btn btn-sm btn-danger" style="margin-right:.25rem" onclick="deleteUpdate('${u.id}')">Delete</button>
                  </td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`);
}

function editUpdate(id) {
  updatesAdminState.editing = updatesAdminState.items.find(x => x.id === id) || null;
  _drawUpdatesPage();
}
function cancelEditUpdate() {
  updatesAdminState.editing = null;
  _drawUpdatesPage();
}
async function saveUpdate(e) {
  e.preventDefault();
  const id   = document.getElementById('upd-id')?.value || null;
  const body = {
    title:        document.getElementById('upd-title').value.trim(),
    content:      document.getElementById('upd-content').value.trim(),
    type:         document.getElementById('upd-type').value,
    is_published: document.getElementById('upd-published').checked,
    is_pinned:    document.getElementById('upd-pinned').checked,
  };
  if (id) body.id = id;
  try {
    await api(id ? 'PATCH' : 'POST', 'admin-updates', body);
    updatesAdminState.editing = null;
    toast(id ? 'Updated ✓' : 'Created ✓', 'success');
    await renderAdminUpdates();
  } catch (err) { toast(err.message, 'error'); }
}
async function togglePublishUpdate(id, publish) {
  try {
    const updated = await api('PATCH', 'admin-updates', { id, is_published: publish });
    const idx = updatesAdminState.items.findIndex(x => x.id === id);
    if (idx >= 0) updatesAdminState.items[idx] = { ...updatesAdminState.items[idx], is_published: publish };
    toast(publish ? 'Published ✓' : 'Unpublished', 'success');
    _drawUpdatesPage();
  } catch (err) { toast(err.message, 'error'); }
}
async function deleteUpdate(id) {
  if (!confirm('Delete this update permanently?')) return;
  try {
    await api('DELETE', 'admin-updates', { id });
    updatesAdminState.items = updatesAdminState.items.filter(x => x.id !== id);
    if (updatesAdminState.editing?.id === id) updatesAdminState.editing = null;
    toast('Deleted', 'success');
    _drawUpdatesPage();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Support Tickets Management ─────────────────────────────────────────────────
let supportAdminState = { page: 1, status: '', selected: null, tickets: [], total: 0, limit: 25 };

async function renderAdminSupport() {
  shell('<div class="loading-screen" style="height:60vh"><div class="spinner"></div></div>');
  let d;
  try {
    d = await api('GET', 'admin-support', null, {
      page:   supportAdminState.page,
      status: supportAdminState.status || undefined,
    });
  } catch { return; }
  supportAdminState.tickets = d.tickets || [];
  supportAdminState.total   = d.total   || 0;
  supportAdminState.limit   = d.limit   || 25;
  _drawSupportPage();
}

function _drawSupportPage() {
  const { tickets, total, limit, page, status, selected } = supportAdminState;
  const sel = selected ? tickets.find(t => t.id === selected) : null;

  const statusBadge = { open: 'badge-blue', in_progress: 'badge-yellow', closed: 'badge-gray' };
  const statusLabel = { open: 'Open', in_progress: 'In Progress', closed: 'Closed' };
  const typeLabel   = { question: 'Question', bug: 'Bug', feature_request: 'Feature', feedback: 'Feedback' };

  shell(`
    <div class="page-header flex items-center justify-between">
      <div><h1 class="page-title">🎫 Support Tickets</h1><p class="page-subtitle">${total} total</p></div>
    </div>

    <div class="filter-bar">
      <select class="filter-select" onchange="supportAdminState.status=this.value;supportAdminState.page=1;renderAdminSupport()">
        <option value="">All statuses</option>
        <option value="open"        ${status==='open'        ? 'selected':''}>Open</option>
        <option value="in_progress" ${status==='in_progress' ? 'selected':''}>In Progress</option>
        <option value="closed"      ${status==='closed'      ? 'selected':''}>Closed</option>
      </select>
    </div>

    <div style="display:grid;grid-template-columns:${sel ? '1fr 380px' : '1fr'};gap:1rem;align-items:start">
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>User</th><th>Type</th><th>Title</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              ${tickets.length === 0
                ? '<tr><td colspan="5" class="text-center text-muted" style="padding:2rem">No tickets</td></tr>'
                : tickets.map(t => `<tr onclick="selectTicket('${t.id}')" class="clickable${selected===t.id ? ' support-row-active':''}">
                    <td>
                      <div class="truncate" style="max-width:140px">${t.userEmail || '—'}</div>
                      <div class="text-xs text-muted">${t.userPlan || 'free'}</div>
                    </td>
                    <td><span class="badge badge-gray" style="font-size:.65rem">${typeLabel[t.type] || t.type}</span></td>
                    <td class="truncate" style="max-width:180px">${t.title}</td>
                    <td><span class="badge ${statusBadge[t.status] || 'badge-gray'}">${statusLabel[t.status] || t.status}</span></td>
                    <td class="text-muted">${new Date(t.created_at).toLocaleDateString()}</td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${renderPagination(page, limit, total, p => { supportAdminState.page = p; renderAdminSupport(); })}
      </div>

      ${sel ? `
      <div class="card support-detail">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:.5rem;margin-bottom:.75rem">
          <h3 style="font-size:.9375rem;font-weight:700;color:var(--gray-900);margin:0;flex:1">${sel.title}</h3>
          <button class="btn btn-sm btn-secondary" onclick="selectTicket(null)" style="flex-shrink:0">✕</button>
        </div>
        <div style="display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.75rem">
          <span class="badge ${statusBadge[sel.status] || 'badge-gray'}">${statusLabel[sel.status] || sel.status}</span>
          <span class="badge badge-gray">${typeLabel[sel.type] || sel.type}</span>
        </div>
        <div style="font-size:.8rem;color:var(--gray-500);margin-bottom:.75rem;line-height:1.6">
          <strong>User:</strong> ${sel.userEmail || '—'}<br>
          <strong>Name:</strong> ${sel.userName  || '—'}<br>
          <strong>Plan:</strong> ${sel.userPlan  || 'free'}<br>
          <strong>Date:</strong> ${new Date(sel.created_at).toLocaleString()}
        </div>
        <div class="support-desc">${sel.description}</div>
        <div style="display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap">
          ${sel.status !== 'in_progress' ? `<button class="btn btn-sm btn-secondary" onclick="updateTicketStatus('${sel.id}','in_progress')">בטיפול</button>` : ''}
          ${sel.status !== 'closed'      ? `<button class="btn btn-sm btn-danger"    onclick="updateTicketStatus('${sel.id}','closed')">סגור פנייה</button>` : ''}
          ${sel.status === 'closed'      ? `<button class="btn btn-sm btn-primary"   onclick="updateTicketStatus('${sel.id}','open')">פתח מחדש</button>` : ''}
        </div>
      </div>` : ''}
    </div>`);
}

function selectTicket(id) {
  supportAdminState.selected = id === supportAdminState.selected ? null : id;
  _drawSupportPage();
}
async function updateTicketStatus(id, status) {
  try {
    await api('PATCH', 'admin-support', { id, status });
    const t = supportAdminState.tickets.find(x => x.id === id);
    if (t) t.status = status;
    toast('Updated ✓', 'success');
    _drawSupportPage();
  } catch (err) { toast(err.message, 'error'); }
}

// ── Router ────────────────────────────────────────────────────────────────────
async function render() {
  const routes = {
    overview:          renderOverview,
    users:             renderUsers,
    'user-detail':     renderUserDetail,
    'assets-mgmt':     renderAdminAssets,
    'onboarding-mgmt': renderAdminOnboarding,
    'metrics-mgmt':    renderAdminMetrics,
    billing:           renderBilling,
    system:            renderSystem,
    audit:             renderAudit,
    'updates-mgmt':    renderAdminUpdates,
    'support-mgmt':    renderAdminSupport,
  };
  const fn = routes[state.page] || renderOverview;
  await fn().catch(e => { if (e.message !== 'forbidden') console.error(e); });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function handleLogout() {
  await sb.auth.signOut();
  window.location.href = '/';
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = '/'; return; }
  state.user = session.user;

  // Verify admin access with a real API call
  try {
    await api('GET', 'admin-overview');
  } catch (e) {
    if (e.message === 'forbidden') return;
    // Network/other error — still try to render
  }
  render();
}

// ── Globals ───────────────────────────────────────────────────────────────────
window.navigate             = navigate;
window.handleLogout         = handleLogout;
window.renderUsers          = renderUsers;
window.renderAudit          = renderAudit;
window.adminToggle          = adminToggle;
window.adminCancelSub       = adminCancelSub;
window.usersState           = usersState;
window.auditState           = auditState;
window.renderAdminUpdates   = renderAdminUpdates;
window.editUpdate           = editUpdate;
window.cancelEditUpdate     = cancelEditUpdate;
window.saveUpdate           = saveUpdate;
window.togglePublishUpdate  = togglePublishUpdate;
window.deleteUpdate         = deleteUpdate;
window.renderAdminSupport   = renderAdminSupport;
window.selectTicket         = selectTicket;
window.updateTicketStatus   = updateTicketStatus;
window.supportAdminState    = supportAdminState;

// ── Admin Assets ──────────────────────────────────────────────────────────────
let assetsAdminState = { page: 1, status: '', items: [], total: 0, limit: 25 };

async function renderAdminAssets() {
  shell('<div style="padding:2rem;color:#94a3b8">טוען assets...</div>');
  const s = assetsAdminState;
  try {
    const params = { view: 'assets', page: s.page, limit: s.limit };
    if (s.status) params.status = s.status;
    const res = await api('GET', 'admin-assets', null, params);
    s.items = res.assets || [];
    s.total = res.total  || 0;
  } catch (e) { toast(e.message, 'error'); }
  _drawAssetsPage();
}

function _drawAssetsPage() {
  const s = assetsAdminState;
  const statusOpts = ['', 'published', 'draft', 'archived', 'failed'];
  const statusLabel = { published: '🟢 פורסם', draft: '🟡 טיוטה', archived: '⚫ ארכיון', failed: '🔴 נכשל', '': 'הכל' };

  shell(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:.75rem">
      <h1 style="font-size:1.5rem;font-weight:800">🚀 Assets</h1>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        ${statusOpts.map(st => `
          <button onclick="assetsFilterStatus('${st}')"
            style="padding:.35rem .75rem;border-radius:9999px;border:1px solid ${s.status===st?'#6366f1':'#e2e8f0'};
              background:${s.status===st?'#6366f1':'white'};color:${s.status===st?'white':'#374151'};
              cursor:pointer;font-size:.8rem">
            ${statusLabel[st]}
          </button>`).join('')}
      </div>
    </div>

    <div style="background:white;border:1px solid #e2e8f0;border-radius:.75rem;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
            ${['משתמש','סוג','כותרת','סטטוס','תאריך',''].map(h =>
              `<th style="padding:.6rem 1rem;text-align:right;font-size:.78rem;font-weight:600;color:#6b7280">${h}</th>`
            ).join('')}
          </tr>
        </thead>
        <tbody>
          ${s.items.length === 0 ? `<tr><td colspan="6" style="padding:2rem;text-align:center;color:#9ca3af">אין תוצאות</td></tr>` :
          s.items.map(a => {
            const sc = { published:'#22c55e', draft:'#f59e0b', archived:'#94a3b8', failed:'#ef4444' }[a.status] || '#94a3b8';
            return `<tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:.6rem 1rem;font-size:.82rem">${a.userEmail || a.user_id.slice(0,8)+'…'}</td>
              <td style="padding:.6rem 1rem;font-size:.82rem">${a.asset_type || '—'}</td>
              <td style="padding:.6rem 1rem;font-size:.82rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${a.title || '—'}</td>
              <td style="padding:.6rem 1rem">
                <span style="font-size:.72rem;padding:.2rem .6rem;border-radius:9999px;background:${sc}20;color:${sc}">${a.status}</span>
              </td>
              <td style="padding:.6rem 1rem;font-size:.78rem;color:#6b7280">${new Date(a.created_at).toLocaleDateString('he-IL')}</td>
              <td style="padding:.6rem 1rem">
                ${a.preview_url ? `<a href="${a.preview_url}" target="_blank" style="font-size:.78rem;color:#6366f1">צפה</a>` : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:1rem;font-size:.85rem;color:#6b7280">
      <span>סה"כ ${s.total} assets · עמוד ${s.page} מתוך ${Math.ceil(s.total / s.limit) || 1}</span>
      <div style="display:flex;gap:.5rem">
        <button onclick="assetsPage(${s.page - 1})" ${s.page <= 1 ? 'disabled' : ''} style="padding:.35rem .75rem;border:1px solid #e2e8f0;border-radius:.375rem;cursor:pointer;background:white">← הקודם</button>
        <button onclick="assetsPage(${s.page + 1})" ${s.page >= Math.ceil(s.total/s.limit) ? 'disabled' : ''} style="padding:.35rem .75rem;border:1px solid #e2e8f0;border-radius:.375rem;cursor:pointer;background:white">הבא →</button>
      </div>
    </div>
  `);
}
function assetsFilterStatus(st) { assetsAdminState.status = st; assetsAdminState.page = 1; renderAdminAssets(); }
function assetsPage(p) { if (p < 1) return; assetsAdminState.page = p; renderAdminAssets(); }

// ── Admin Onboarding ──────────────────────────────────────────────────────────
async function renderAdminOnboarding() {
  shell('<div style="padding:2rem;color:#94a3b8">טוען onboarding...</div>');
  let rows = [];
  try {
    rows = await api('GET', 'admin-assets', null, { view: 'onboarding', limit: 100 });
  } catch (e) { toast(e.message, 'error'); }

  const stepKeys = ['profile_started','profile_complete','first_asset','multiple_assets','has_metrics','has_ab_data'];
  const stepIcon = (val) => val ? '✅' : '⬜';

  shell(`
    <h1 style="font-size:1.5rem;font-weight:800;margin-bottom:1.5rem">🎯 Onboarding Progress</h1>
    <div style="background:white;border:1px solid #e2e8f0;border-radius:.75rem;overflow:auto">
      <table style="width:100%;border-collapse:collapse;min-width:700px">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
            <th style="padding:.6rem 1rem;text-align:right;font-size:.78rem;font-weight:600;color:#6b7280">משתמש</th>
            ${stepKeys.map(k => `<th style="padding:.6rem .5rem;text-align:center;font-size:.7rem;font-weight:600;color:#6b7280">${k.replace('_','<br>')}</th>`).join('')}
            <th style="padding:.6rem 1rem;text-align:center;font-size:.78rem;font-weight:600;color:#6b7280">שלב</th>
            <th style="padding:.6rem 1rem;text-align:center;font-size:.78rem;font-weight:600;color:#6b7280">עדכון</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0 ? `<tr><td colspan="${stepKeys.length+3}" style="padding:2rem;text-align:center;color:#9ca3af">אין נתונים</td></tr>` :
          rows.map(r => `
            <tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:.6rem 1rem;font-size:.82rem">${r.userEmail || r.user_id.slice(0,8)+'…'}</td>
              ${stepKeys.map(k => `<td style="padding:.5rem;text-align:center;font-size:1rem">${stepIcon(r.steps?.[k])}</td>`).join('')}
              <td style="padding:.6rem 1rem;text-align:center;font-size:.78rem;color:#6366f1;font-weight:600">${r.current_step || '—'}</td>
              <td style="padding:.6rem 1rem;text-align:center;font-size:.75rem;color:#9ca3af">${new Date(r.updated_at).toLocaleDateString('he-IL')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:.75rem;font-size:.82rem;color:#9ca3af">סה"כ ${rows.length} משתמשים עם onboarding data</div>
  `);
}

// ── Admin Metrics Summary ─────────────────────────────────────────────────────
async function renderAdminMetrics() {
  shell('<div style="padding:2rem;color:#94a3b8">טוען metrics...</div>');
  let rows = [];
  try {
    rows = await api('GET', 'admin-assets', null, { view: 'metrics' });
  } catch (e) { toast(e.message, 'error'); }

  const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
  const totalConv   = rows.reduce((s, r) => s + r.conversions, 0);
  const totalRev    = rows.reduce((s, r) => s + Number(r.revenue), 0);

  shell(`
    <h1 style="font-size:1.5rem;font-weight:800;margin-bottom:1rem">📈 Metrics Summary</h1>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem">
      ${[
        ['סה"כ קליקים', totalClicks.toLocaleString(), '#6366f1'],
        ['סה"כ המרות',  totalConv.toLocaleString(),   '#22c55e'],
        ['סה"כ הכנסה',  '₪'+totalRev.toLocaleString(), '#16a34a'],
      ].map(([label, val, color]) => `
        <div style="background:white;border:1px solid #e2e8f0;border-radius:.75rem;padding:1rem;text-align:center">
          <div style="font-size:1.5rem;font-weight:800;color:${color}">${val}</div>
          <div style="font-size:.8rem;color:#6b7280;margin-top:.25rem">${label}</div>
        </div>`).join('')}
    </div>

    <div style="background:white;border:1px solid #e2e8f0;border-radius:.75rem;overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0">
            ${['משתמש','קליקים','המרות','הכנסה','Conv%','רשומות'].map(h =>
              `<th style="padding:.6rem 1rem;text-align:right;font-size:.78rem;font-weight:600;color:#6b7280">${h}</th>`
            ).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0 ? `<tr><td colspan="6" style="padding:2rem;text-align:center;color:#9ca3af">אין נתונים</td></tr>` :
          rows.map(r => {
            const conv = r.clicks > 0 ? (r.conversions/r.clicks*100).toFixed(1)+'%' : '—';
            return `<tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:.6rem 1rem;font-size:.82rem">${r.userEmail || r.user_id.slice(0,8)+'…'}</td>
              <td style="padding:.6rem 1rem;font-size:.82rem;color:#6366f1;font-weight:600">${r.clicks.toLocaleString()}</td>
              <td style="padding:.6rem 1rem;font-size:.82rem;color:#22c55e;font-weight:600">${r.conversions}</td>
              <td style="padding:.6rem 1rem;font-size:.82rem;color:#16a34a;font-weight:600">₪${Number(r.revenue).toLocaleString()}</td>
              <td style="padding:.6rem 1rem;font-size:.82rem">${conv}</td>
              <td style="padding:.6rem 1rem;font-size:.78rem;color:#9ca3af">${r.entries}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `);
}

window.renderAdminAssets    = renderAdminAssets;
window.assetsFilterStatus   = assetsFilterStatus;
window.assetsPage           = assetsPage;
window.renderAdminOnboarding = renderAdminOnboarding;
window.renderAdminMetrics   = renderAdminMetrics;

boot();
