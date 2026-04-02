(() => {
  const state = {
    config: null,
    supabase: null,
    session: null,
    user: null,
    profile: null,
    route: 'overview',
    intendedRoute: 'overview',
    isRecoveryMode: false,
    pendingVerificationEmail: '',
    history: {
      items: [],
      nextCursor: null,
      loading: false
    }
  };

  const els = {};
  const ROUTES = ['overview', 'history', 'profile', 'settings'];
  const ROUTE_TITLES = {
    overview: ['סקירה כללית', 'מצב החשבון, האבטחה והצעד הבא. בלי מסכים מתים.'],
    history: ['היסטוריית משתמש', 'כל פעולה חשובה של החשבון נרשמת.'],
    profile: ['פרופיל', 'עדכון זהות החשבון והאוואטר.'],
    settings: ['הגדרות חשבון', 'אבטחה, יציאה ומחיקה.']
  };

  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    cacheElements();
    bindEvents();

    try {
      state.config = await fetchConfig();
      state.supabase = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseAnonKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          flowType: 'pkce'
        }
      });

      state.isRecoveryMode = isRecoveryHash(window.location.hash);
      if (state.isRecoveryMode) {
        switchAuthPanel('reset');
      }

      state.supabase.auth.onAuthStateChange(async (event, session) => {
        state.session = session || null;
        state.user = session?.user || null;

        if (event === 'PASSWORD_RECOVERY') {
          state.isRecoveryMode = true;
          switchAuthPanel('reset');
          setStatus(els.resetTokenState, 'info', 'זוהה קישור איפוס תקין. אפשר לבחור סיסמה חדשה.');
          routeToAuth();
          return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          await afterAuthenticated();
          return;
        }

        if (event === 'SIGNED_OUT') {
          resetAppState();
          routeToAuth();
        }
      });

      const { data, error } = await state.supabase.auth.getSession();
      if (error) throw error;
      state.session = data.session || null;
      state.user = data.session?.user || null;

      if (state.user) {
        await afterAuthenticated();
      } else {
        routeToAuth();
      }
    } catch (error) {
      console.error(error);
      hideBoot();
      routeToAuth();
      setStatus(els.authError, 'error', getErrorMessage(error));
    }
  }

  function cacheElements() {
    const ids = [
      'boot-screen','auth-screen','app-shell','toast-root','tab-login','tab-signup','auth-form','auth-submit',
      'toggle-mode','field-name','field-confirm-password','auth-title','auth-state-banner','auth-email',
      'auth-password','auth-confirm-password','signup-name','auth-error','auth-success','verification-actions','resend-verification-trigger',
      'forgot-password-trigger','forgot-password-form','forgot-email','forgot-error','forgot-success','forgot-submit','forgot-back',
      'reset-password-form','reset-password','reset-confirm-password','reset-error','reset-success','reset-submit','reset-back','reset-token-state',
      'page-title','page-subtitle','nav','topbar-avatar','topbar-name','topbar-email','route-overview','route-history','route-profile','route-settings',
      'overview-account-status','overview-account-copy','overview-session-copy','overview-next-action','overview-history-count',
      'check-session','check-profile','check-protection','check-history','check-settings',
      'history-list','history-empty','history-load-more','history-refresh',
      'profile-avatar-preview','avatar-fallback','profile-created-at','profile-avatar-input','profile-form','profile-name','profile-email','profile-save','profile-status',
      'password-form','current-password','new-password','confirm-new-password','password-status','password-save',
      'sidebar-logout','settings-logout','settings-resend-verification','onboarding-modal','onboarding-complete',
      'delete-account-trigger','delete-account-modal','delete-confirmation','delete-current-password','delete-account-confirm','delete-account-cancel','delete-status'
    ];

    ids.forEach((id) => {
      els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
    });

    els.fieldErrors = {
      email: document.querySelector('[data-for="email"]'),
      password: document.querySelector('[data-for="password"]'),
      confirmPassword: document.querySelector('[data-for="confirmPassword"]'),
      forgotEmail: document.querySelector('[data-for="forgotEmail"]'),
      resetPassword: document.querySelector('[data-for="resetPassword"]'),
      resetConfirmPassword: document.querySelector('[data-for="resetConfirmPassword"]'),
      profileName: document.querySelector('[data-for="profileName"]'),
      profilePageName: document.querySelector('[data-for="profilePageName"]'),
      currentPassword: document.querySelector('[data-for="currentPassword"]'),
      newPassword: document.querySelector('[data-for="newPassword"]'),
      confirmNewPassword: document.querySelector('[data-for="confirmNewPassword"]')
    };
  }

  function bindEvents() {
    els.tabLogin.addEventListener('click', () => setAuthMode('login'));
    els.tabSignup.addEventListener('click', () => setAuthMode('signup'));
    els.toggleMode.addEventListener('click', () => setAuthMode(state.authMode === 'signup' ? 'login' : 'signup'));

    els.authForm.addEventListener('submit', submitAuthForm);
    els.forgotPasswordForm.addEventListener('submit', submitForgotPassword);
    els.resetPasswordForm.addEventListener('submit', submitPasswordReset);
    els.profileForm.addEventListener('submit', submitProfileForm);
    els.passwordForm.addEventListener('submit', submitPasswordChange);
    els.profileAvatarInput.addEventListener('change', uploadAvatar);
    els.resendVerificationTrigger.addEventListener('click', resendVerification);
    els.settingsResendVerification.addEventListener('click', resendVerification);

    ['input', 'change'].forEach((eventName) => {
      els.authForm.addEventListener(eventName, validateAuthForm);
      els.forgotPasswordForm.addEventListener(eventName, validateForgotForm);
      els.resetPasswordForm.addEventListener(eventName, validateResetForm);
      els.profileForm.addEventListener(eventName, validateProfileForm);
      els.passwordForm.addEventListener(eventName, validatePasswordChangeForm);
      els.deleteConfirmation.addEventListener(eventName, updateDeleteButton);
      els.deleteCurrentPassword.addEventListener(eventName, updateDeleteButton);
    });

    els.forgotPasswordTrigger.addEventListener('click', () => switchAuthPanel('forgot'));
    els.forgotBack.addEventListener('click', () => switchAuthPanel('auth'));
    els.resetBack.addEventListener('click', () => switchAuthPanel('auth'));

    els.nav.addEventListener('click', (event) => {
      const button = event.target.closest('[data-route]');
      if (button) navigate(button.dataset.route);
    });

    els.historyRefresh.addEventListener('click', () => fetchHistory(true));
    els.historyLoadMore.addEventListener('click', () => fetchHistory(false));

    [els.sidebarLogout, els.settingsLogout].forEach((button) => button.addEventListener('click', logout));

    els.onboardingComplete.addEventListener('click', completeOnboarding);
    els.deleteAccountTrigger.addEventListener('click', () => toggleModal(els.deleteAccountModal, true));
    els.deleteAccountCancel.addEventListener('click', () => toggleModal(els.deleteAccountModal, false));
    els.deleteAccountConfirm.addEventListener('click', deleteAccount);

    window.addEventListener('hashchange', handleHashRoute);
  }

  async function fetchConfig() {
    const response = await fetch('/.netlify/functions/app-config', { headers: { Accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok || !payload?.success) throw new Error(payload?.message || 'אי אפשר לטעון תצורת אפליקציה.');
    return payload.config;
  }

  function isRecoveryHash(hash) {
    return /type=recovery/i.test(hash || '') || /access_token=/i.test(hash || '');
  }

  async function afterAuthenticated() {
    hideBoot();
    hideAuthMessages();
    await hydrateApp();
    routeToApp();
  }

  async function hydrateApp() {
    if (!state.user) return;
    await ensureProfileLoaded();
    updateTopbar();
    updateOverview();
    updateChecklist();
    renderProfile();
    maybeOpenOnboarding();
    validateRouteAfterAuth();
    navigate(getRouteFromHash(), false);
    if (!state.history.items.length) {
      await fetchHistory(true);
    }
  }

  async function ensureProfileLoaded() {
    const response = await authedFetch('/.netlify/functions/profile');
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.message || 'טעינת הפרופיל נכשלה.');
    state.profile = payload.profile;
  }

  async function authedFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (state.session?.access_token) headers.set('Authorization', `Bearer ${state.session.access_token}`);
    return fetch(url, { ...options, headers });
  }

  async function apiFetch(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload || {})
    });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.message || 'הבקשה נכשלה.');
    return json;
  }

  function routeToAuth() {
    show(els.authScreen);
    hide(els.appShell);
    switchAuthPanel(state.isRecoveryMode ? 'reset' : 'auth');
    setAuthMode('login');
    hideBoot();
  }

  function routeToApp() {
    hide(els.authScreen);
    show(els.appShell);
    navigate(getRouteFromHash(), false);
  }

  function handleHashRoute() {
    const route = getRouteFromHash();
    if (!state.user) {
      state.intendedRoute = route;
      return;
    }
    navigate(route, false);
  }

  function getRouteFromHash() {
    const raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
    return ROUTES.includes(raw) ? raw : 'overview';
  }

  function validateRouteAfterAuth() {
    const target = state.intendedRoute || getRouteFromHash();
    state.intendedRoute = ROUTES.includes(target) ? target : 'overview';
  }

  function navigate(route, pushHash = true) {
    if (!state.user && route !== 'overview') {
      state.intendedRoute = route;
      routeToAuth();
      setStatus(els.authStateBanner, 'info', 'התחבר קודם. תוכן מוגן לא יוצא לטיול בלי שומר.');
      return;
    }

    state.route = ROUTES.includes(route) ? route : 'overview';
    document.querySelectorAll('.route-screen').forEach((screen) => hide(screen));
    const current = document.getElementById(`route-${state.route}`);
    if (current) show(current);

    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.route === state.route);
    });

    const [title, subtitle] = ROUTE_TITLES[state.route];
    els.pageTitle.textContent = title;
    els.pageSubtitle.textContent = subtitle;

    if (pushHash) window.location.hash = `#/${state.route}`;
    if (state.route === 'history' && !state.history.items.length) fetchHistory(true);
  }

  function setAuthMode(mode) {
    state.authMode = mode === 'signup' ? 'signup' : 'login';
    els.tabLogin.classList.toggle('active', state.authMode === 'login');
    els.tabSignup.classList.toggle('active', state.authMode === 'signup');
    els.tabLogin.setAttribute('aria-selected', String(state.authMode === 'login'));
    els.tabSignup.setAttribute('aria-selected', String(state.authMode === 'signup'));
    els.fieldName.classList.toggle('hidden', state.authMode !== 'signup');
    els.fieldConfirmPassword.classList.toggle('hidden', state.authMode !== 'signup');
    els.authTitle.textContent = state.authMode === 'signup' ? 'פתיחת חשבון' : 'כניסה למערכת';
    els.authSubmit.textContent = state.authMode === 'signup' ? 'צור חשבון' : 'התחבר';
    els.toggleMode.textContent = state.authMode === 'signup' ? 'כבר יש לך חשבון? התחבר' : 'אין לך חשבון? הירשם';
    hideVerificationActions();
    clearFieldErrors();
    hideAuthMessages();
    validateAuthForm();
  }

  function switchAuthPanel(panel) {
    hide(els.authForm);
    hide(els.forgotPasswordForm);
    hide(els.resetPasswordForm);
    if (panel === 'forgot') show(els.forgotPasswordForm);
    else if (panel === 'reset') show(els.resetPasswordForm);
    else show(els.authForm);
  }

  function validateAuthForm() {
    if (els.authForm.classList.contains('hidden')) return false;
    clearFieldErrors();
    const email = els.authEmail.value.trim();
    const password = els.authPassword.value;
    const confirm = els.authConfirmPassword.value;
    const name = els.signupName.value.trim();
    let valid = true;

    if (!isValidEmail(email)) {
      setFieldError('email', 'אימייל לא תקין.');
      valid = false;
    }

    const passwordResult = validatePassword(password);
    if (!passwordResult.valid) {
      setFieldError('password', passwordResult.message);
      valid = false;
    }

    if (state.authMode === 'signup') {
      if (!name || name.length < 2) {
        setFieldError('profileName', 'שם מלא חייב להכיל לפחות 2 תווים.');
        valid = false;
      }
      if (confirm !== password) {
        setFieldError('confirmPassword', 'הסיסמאות לא תואמות.');
        valid = false;
      }
    }

    els.authSubmit.disabled = !valid;
    return valid;
  }

  function validateForgotForm() {
    if (els.forgotPasswordForm.classList.contains('hidden')) return false;
    setFieldError('forgotEmail', '');
    const valid = isValidEmail(els.forgotEmail.value.trim());
    if (!valid) setFieldError('forgotEmail', 'אימייל לא תקין.');
    els.forgotSubmit.disabled = !valid;
    return valid;
  }

  function validateResetForm() {
    if (els.resetPasswordForm.classList.contains('hidden')) return false;
    setFieldError('resetPassword', '');
    setFieldError('resetConfirmPassword', '');
    const password = els.resetPassword.value;
    const confirm = els.resetConfirmPassword.value;
    let valid = true;
    const result = validatePassword(password);
    if (!result.valid) {
      setFieldError('resetPassword', result.message);
      valid = false;
    }
    if (confirm !== password) {
      setFieldError('resetConfirmPassword', 'הסיסמאות לא תואמות.');
      valid = false;
    }
    els.resetSubmit.disabled = !valid;
    return valid;
  }

  function validateProfileForm() {
    if (els.profileForm.classList.contains('hidden')) return false;
    setFieldError('profilePageName', '');
    const name = els.profileName.value.trim();
    const valid = name.length >= 2;
    if (!valid) setFieldError('profilePageName', 'שם מלא חייב להכיל לפחות 2 תווים.');
    els.profileSave.disabled = !valid;
    return valid;
  }

  function validatePasswordChangeForm() {
    if (els.passwordForm.classList.contains('hidden')) return false;
    setFieldError('currentPassword', '');
    setFieldError('newPassword', '');
    setFieldError('confirmNewPassword', '');

    const currentPassword = els.currentPassword.value;
    const password = els.newPassword.value;
    const confirm = els.confirmNewPassword.value;
    let valid = true;

    if (!currentPassword) {
      setFieldError('currentPassword', 'חייבים להזין את הסיסמה הנוכחית.');
      valid = false;
    }

    const result = validatePassword(password);
    if (!result.valid) {
      setFieldError('newPassword', result.message);
      valid = false;
    }

    if (confirm !== password) {
      setFieldError('confirmNewPassword', 'הסיסמאות לא תואמות.');
      valid = false;
    }

    els.passwordSave.disabled = !valid;
    return valid;
  }

  function updateDeleteButton() {
    els.deleteAccountConfirm.disabled = !(els.deleteConfirmation.value.trim() === 'מחק חשבון' && els.deleteCurrentPassword.value.trim());
  }

  async function submitAuthForm(event) {
    event.preventDefault();
    hideAuthMessages();
    hideVerificationActions();
    if (!validateAuthForm()) return;

    setLoading(els.authSubmit, true);
    try {
      const email = els.authEmail.value.trim();
      const password = els.authPassword.value;
      const fullName = els.signupName.value.trim();

      if (state.authMode === 'signup') {
        const payload = await apiFetch('/.netlify/functions/auth-signup', { email, password, full_name: fullName });
        state.pendingVerificationEmail = email;

        if (payload.session?.access_token && payload.session?.refresh_token) {
          await state.supabase.auth.setSession({
            access_token: payload.session.access_token,
            refresh_token: payload.session.refresh_token
          });
          setStatus(els.authSuccess, 'success', 'החשבון נוצר ואתה כבר בפנים.');
        } else {
          setStatus(els.authSuccess, 'success', 'החשבון נוצר. צריך לאמת אימייל לפני כניסה.');
          showVerificationActions();
        }
      } else {
        const payload = await apiFetch('/.netlify/functions/auth-login', { email, password });
        await state.supabase.auth.setSession({
          access_token: payload.session.access_token,
          refresh_token: payload.session.refresh_token
        });
      }
    } catch (error) {
      const message = getErrorMessage(error);
      setStatus(els.authError, 'error', message);
      if (message.includes('האימייל עדיין לא אומת')) {
        state.pendingVerificationEmail = els.authEmail.value.trim();
        showVerificationActions();
      }
    } finally {
      setLoading(els.authSubmit, false);
    }
  }

  async function submitForgotPassword(event) {
    event.preventDefault();
    hideStatuses([els.forgotError, els.forgotSuccess]);
    if (!validateForgotForm()) return;
    setLoading(els.forgotSubmit, true);
    try {
      await apiFetch('/.netlify/functions/auth-password-reset-request', { email: els.forgotEmail.value.trim() });
      setStatus(els.forgotSuccess, 'success', 'אם האימייל קיים במערכת, שלחנו קישור איפוס.');
    } catch (error) {
      setStatus(els.forgotError, 'error', getErrorMessage(error));
    } finally {
      setLoading(els.forgotSubmit, false);
    }
  }

  async function submitPasswordReset(event) {
    event.preventDefault();
    hideStatuses([els.resetError, els.resetSuccess]);
    if (!validateResetForm()) return;
    setLoading(els.resetSubmit, true);

    try {
      const { data } = await state.supabase.auth.getSession();
      if (!data.session) throw new Error('לינק האיפוס פג תוקף או לא תקין.');
      state.session = data.session;
      state.user = data.session.user;

      const response = await authedFetch('/.netlify/functions/auth-password-reset-complete', {
        method: 'POST',
        body: JSON.stringify({ new_password: els.resetPassword.value })
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.message || 'האיפוס נכשל.');

      setStatus(els.resetSuccess, 'success', 'הסיסמה נשמרה. מעביר אותך למערכת.');
      setTimeout(async () => {
        state.isRecoveryMode = false;
        await afterAuthenticated();
        navigate('settings');
      }, 800);
    } catch (error) {
      setStatus(els.resetError, 'error', getErrorMessage(error));
      setStatus(els.resetTokenState, 'error', 'לינק האיפוס לא תקין או שפג תוקפו.');
    } finally {
      setLoading(els.resetSubmit, false);
    }
  }

  async function resendVerification() {
    const email = state.pendingVerificationEmail || state.user?.email || els.authEmail.value.trim() || els.forgotEmail.value.trim();
    if (!isValidEmail(email)) {
      showToast('אין אימייל תקין לשליחת אימות.', 'error');
      return;
    }
    try {
      await apiFetch('/.netlify/functions/auth-resend-verification', { email });
      showToast('שלחנו שוב מייל אימות.', 'success');
      setStatus(els.authStateBanner, 'info', 'נשלח מייל אימות נוסף. בדוק תיבה ראשית וספאם.');
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
    }
  }

  async function submitProfileForm(event) {
    event.preventDefault();
    hideStatuses([els.profileStatus]);
    if (!validateProfileForm()) return;
    setLoading(els.profileSave, true);

    try {
      const response = await authedFetch('/.netlify/functions/profile', {
        method: 'POST',
        body: JSON.stringify({
          full_name: els.profileName.value.trim(),
          avatar_url: state.profile?.avatar_url || null
        })
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.message || 'שמירת הפרופיל נכשלה.');

      state.profile = json.profile;
      renderProfile();
      updateTopbar();
      updateOverview();
      updateChecklist();
      setStatus(els.profileStatus, 'success', 'הפרופיל נשמר.');
      showToast('הפרופיל עודכן', 'success');
      await fetchHistory(true);
    } catch (error) {
      setStatus(els.profileStatus, 'error', getErrorMessage(error));
    } finally {
      setLoading(els.profileSave, false);
    }
  }

  async function uploadAvatar() {
    if (!state.user || !els.profileAvatarInput.files?.length) return;
    hideStatuses([els.profileStatus]);
    setLoading(els.profileSave, true);

    try {
      const file = els.profileAvatarInput.files[0];
      if (file.size > 2 * 1024 * 1024) throw new Error('הקובץ גדול מדי. עד 2MB.');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('רק PNG, JPG או WEBP.');

      const extension = file.name.split('.').pop().toLowerCase();
      const path = `${state.user.id}/${Date.now()}.${extension}`;
      const { error: uploadError } = await state.supabase.storage.from('avatars').upload(path, file, { upsert: false, contentType: file.type });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = state.supabase.storage.from('avatars').getPublicUrl(path);
      const response = await authedFetch('/.netlify/functions/profile', {
        method: 'POST',
        body: JSON.stringify({
          full_name: state.profile?.full_name || state.user?.user_metadata?.full_name || 'משתמש',
          avatar_url: publicUrlData.publicUrl
        })
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.message || 'עדכון האוואטר נכשל.');

      state.profile = json.profile;
      renderProfile();
      updateTopbar();
      setStatus(els.profileStatus, 'success', 'תמונת הפרופיל עודכנה.');
      await fetchHistory(true);
    } catch (error) {
      setStatus(els.profileStatus, 'error', getErrorMessage(error));
    } finally {
      setLoading(els.profileSave, false);
      els.profileAvatarInput.value = '';
    }
  }

  async function submitPasswordChange(event) {
    event.preventDefault();
    hideStatuses([els.passwordStatus]);
    if (!validatePasswordChangeForm()) return;
    setLoading(els.passwordSave, true);

    try {
      const response = await authedFetch('/.netlify/functions/auth-change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: els.currentPassword.value,
          new_password: els.newPassword.value
        })
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.message || 'עדכון הסיסמה נכשל.');

      setStatus(els.passwordStatus, 'success', 'הסיסמה עודכנה.');
      els.passwordForm.reset();
      validatePasswordChangeForm();
      await fetchHistory(true);
    } catch (error) {
      setStatus(els.passwordStatus, 'error', getErrorMessage(error));
    } finally {
      setLoading(els.passwordSave, false);
    }
  }

  async function fetchHistory(reset = false) {
    if (state.history.loading || !state.user) return;
    state.history.loading = true;
    els.historyRefresh.disabled = true;
    els.historyLoadMore.disabled = true;

    try {
      const params = new URLSearchParams();
      if (!reset && state.history.nextCursor) params.set('cursor', state.history.nextCursor);
      const response = await authedFetch(`/.netlify/functions/account-history?${params.toString()}`);
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.message || 'טעינת היסטוריה נכשלה.');

      state.history.items = reset ? json.items : state.history.items.concat(json.items);
      state.history.nextCursor = json.nextCursor || null;
      renderHistory();
      updateOverview();
      updateChecklist();
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
    } finally {
      state.history.loading = false;
      els.historyRefresh.disabled = false;
      els.historyLoadMore.disabled = false;
    }
  }

  async function completeOnboarding() {
    setLoading(els.onboardingComplete, true);
    try {
      const response = await authedFetch('/.netlify/functions/onboarding-complete', {
        method: 'POST',
        body: JSON.stringify({ onboarding_completed: true })
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.message || 'השלמת האונבורדינג נכשלה.');
      state.profile = json.profile;
      toggleModal(els.onboardingModal, false);
      updateOverview();
      await fetchHistory(true);
      showToast('האונבורדינג הושלם', 'success');
    } catch (error) {
      showToast(getErrorMessage(error), 'error');
    } finally {
      setLoading(els.onboardingComplete, false);
    }
  }

  async function deleteAccount() {
    setLoading(els.deleteAccountConfirm, true);
    hideStatuses([els.deleteStatus]);

    try {
      const response = await authedFetch('/.netlify/functions/account-delete', {
        method: 'POST',
        body: JSON.stringify({
          confirmation: els.deleteConfirmation.value.trim(),
          current_password: els.deleteCurrentPassword.value
        })
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.message || 'מחיקת החשבון נכשלה.');

      setStatus(els.deleteStatus, 'success', 'החשבון הושבת. מתנתקים עכשיו.');
      await state.supabase.auth.signOut({ scope: 'local' });
      resetAppState();
      routeToAuth();
      showToast('החשבון הושבת', 'success');
    } catch (error) {
      setStatus(els.deleteStatus, 'error', getErrorMessage(error));
    } finally {
      setLoading(els.deleteAccountConfirm, false);
    }
  }

  async function logout() {
    await state.supabase.auth.signOut({ scope: 'local' });
  }

  function renderProfile() {
    if (!state.profile) return;
    const fullName = state.profile.full_name || state.user?.user_metadata?.full_name || 'ללא שם';
    els.profileName.value = fullName;
    els.profileEmail.value = state.profile.email || state.user?.email || '';
    els.profileCreatedAt.textContent = `נוצר בתאריך: ${formatDate(state.profile.created_at)}`;
    renderAvatar(state.profile.avatar_url);
  }

  function renderAvatar(url) {
    const fallbackName = (state.profile?.full_name || state.user?.email || '?').trim();
    els.avatarFallback.textContent = fallbackName.charAt(0).toUpperCase() || '?';
    if (url) {
      els.profileAvatarPreview.src = url;
      els.topbarAvatar.src = url;
      show(els.profileAvatarPreview);
      show(els.topbarAvatar);
      hide(els.avatarFallback);
    } else {
      hide(els.profileAvatarPreview);
      hide(els.topbarAvatar);
      show(els.avatarFallback);
    }
  }

  function renderHistory() {
    els.historyList.innerHTML = '';
    const items = state.history.items || [];
    if (!items.length) {
      show(els.historyEmpty);
    } else {
      hide(els.historyEmpty);
      const fragment = document.createDocumentFragment();
      items.forEach((item) => {
        const node = document.createElement('article');
        node.className = 'history-item';
        node.innerHTML = `
          <div class="history-item-header">
            <div class="history-item-title">${escapeHtml(item.action)}</div>
            <div class="history-item-time">${formatDateTime(item.created_at)}</div>
          </div>
          <div class="history-item-meta">${escapeHtml(formatHistoryMetadata(item.metadata))}</div>
        `;
        fragment.appendChild(node);
      });
      els.historyList.appendChild(fragment);
    }
    els.historyLoadMore.classList.toggle('hidden', !state.history.nextCursor);
  }

  function maybeOpenOnboarding() {
    const needsOnboarding = !state.profile?.onboarding_completed;
    toggleModal(els.onboardingModal, needsOnboarding);
    if (!state.user?.email_confirmed_at) {
      els.overviewNextAction.textContent = 'אמת את האימייל, השלם אונבורדינג, ואז המערכת סגורה כמו שצריך.';
      return;
    }
    els.overviewNextAction.textContent = needsOnboarding
      ? 'סיים את תהליך ההיכרות והמשך לפרופיל.'
      : 'הכול מוכן. מכאן ממשיכים לעבוד.';
  }

  function updateTopbar() {
    els.topbarName.textContent = state.profile?.full_name || state.user?.user_metadata?.full_name || 'משתמש';
    els.topbarEmail.textContent = state.profile?.email || state.user?.email || '';
  }

  function updateOverview() {
    const emailVerified = Boolean(state.user?.email_confirmed_at);
    const active = !!state.user && !state.profile?.deleted_at;
    els.overviewAccountStatus.textContent = active ? (emailVerified ? 'פעיל' : 'ממתין לאימות') : 'לא פעיל';
    if (state.profile?.deleted_at) {
      els.overviewAccountCopy.textContent = 'החשבון הושבת.';
    } else if (!emailVerified) {
      els.overviewAccountCopy.textContent = 'האימייל עוד לא אומת. אפשר לשלוח אימות מחדש מההגדרות.';
    } else if (!state.profile?.onboarding_completed) {
      els.overviewAccountCopy.textContent = 'החשבון פעיל אבל האונבורדינג עוד לא הושלם.';
    } else {
      els.overviewAccountCopy.textContent = 'האונבורדינג הושלם והפרופיל טעון.';
    }
    els.overviewSessionCopy.textContent = state.session?.expires_at ? 'משוחזר' : 'לא זוהה';
    els.overviewHistoryCount.textContent = String(state.history.items.length);
  }

  function updateChecklist() {
    setChecklistItem(els.checkSession, !!state.session);
    setChecklistItem(els.checkProfile, !!state.profile);
    setChecklistItem(els.checkProtection, !els.appShell.classList.contains('hidden') && els.authScreen.classList.contains('hidden'));
    setChecklistItem(els.checkHistory, state.history.items.length > 0 || state.history.nextCursor === null);
    setChecklistItem(els.checkSettings, true);
  }

  function setChecklistItem(node, done) {
    node.textContent = `${done ? '✅' : '⏳'} ${node.textContent.replace(/^[✅⏳]\s*/, '')}`;
  }

  function toggleModal(element, visible) {
    element.classList.toggle('hidden', !visible);
    element.setAttribute('aria-hidden', String(!visible));
  }

  function setLoading(button, active) {
    if (!button) return;
    button.dataset.originalText = button.dataset.originalText || button.textContent;
    if (active) {
      button.dataset.wasDisabled = button.disabled ? '1' : '0';
      button.disabled = true;
      button.textContent = 'טוען…';
      return;
    }
    button.textContent = button.dataset.originalText;
    button.disabled = button.dataset.wasDisabled === '1';
    delete button.dataset.wasDisabled;
  }

  function setFieldError(key, message) {
    if (!els.fieldErrors[key]) return;
    els.fieldErrors[key].textContent = message || '';
  }

  function clearFieldErrors() {
    Object.keys(els.fieldErrors).forEach((key) => setFieldError(key, ''));
  }

  function hideAuthMessages() {
    hideStatuses([els.authError, els.authSuccess, els.authStateBanner]);
  }

  function hideStatuses(list) {
    list.forEach((item) => {
      if (!item) return;
      item.textContent = '';
      item.className = item.className.replace(/\b(error|success|info)\b/g, '').trim();
      item.classList.add('hidden');
    });
  }

  function setStatus(element, type, message) {
    element.textContent = message;
    element.classList.remove('hidden', 'error', 'success', 'info');
    element.classList.add(type);
  }

  function showVerificationActions() {
    show(els.verificationActions);
  }

  function hideVerificationActions() {
    hide(els.verificationActions);
  }

  function showToast(message, type = 'info') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    els.toastRoot.appendChild(node);
    setTimeout(() => node.remove(), 4000);
  }

  function show(element) {
    element.classList.remove('hidden');
  }

  function hide(element) {
    element.classList.add('hidden');
  }

  function hideBoot() {
    hide(els.bootScreen);
  }

  function resetAppState() {
    state.session = null;
    state.user = null;
    state.profile = null;
    state.route = 'overview';
    state.intendedRoute = 'overview';
    state.pendingVerificationEmail = '';
    state.history = { items: [], nextCursor: null, loading: false };
    els.historyList.innerHTML = '';
    els.authForm.reset();
    els.forgotPasswordForm.reset();
    els.resetPasswordForm.reset();
    els.profileForm.reset();
    els.passwordForm.reset();
    els.deleteConfirmation.value = '';
    els.deleteCurrentPassword.value = '';
    updateDeleteButton();
    renderAvatar('');
    hide(els.appShell);
    hideVerificationActions();
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function validatePassword(password) {
    if (!password || password.length < 8) return { valid: false, message: 'הסיסמה חייבת להכיל לפחות 8 תווים.' };
    if (!/[A-Z]/.test(password)) return { valid: false, message: 'חסרה אות גדולה באנגלית.' };
    if (!/[a-z]/.test(password)) return { valid: false, message: 'חסרה אות קטנה באנגלית.' };
    if (!/[0-9]/.test(password)) return { valid: false, message: 'חסר מספר.' };
    return { valid: true, message: '' };
  }

  function getErrorMessage(error) {
    const raw = error?.message || 'אירעה שגיאה לא צפויה.';
    const normalized = String(raw).toLowerCase();
    if (normalized.includes('invalid login credentials')) return 'אימייל או סיסמה שגויים.';
    if (normalized.includes('email not confirmed')) return 'האימייל עדיין לא אומת.';
    if (normalized.includes('current password is incorrect')) return 'הסיסמה הנוכחית שגויה.';
    if (normalized.includes('jwt') || normalized.includes('expired session')) return 'פג תוקף ההתחברות. התחבר מחדש.';
    if (normalized.includes('rate limit') || normalized.includes('too many requests')) return 'נחסמת זמנית בגלל יותר מדי ניסיונות. תן למערכת לנשום דקה.';
    if (normalized.includes('account is disabled')) return 'החשבון הזה מושבת.';
    return raw;
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('he-IL', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value));
  }

  function formatDateTime(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('he-IL', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(value));
  }

  function formatHistoryMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'ללא פרטים נוספים.';
    const entries = Object.entries(metadata);
    if (!entries.length) return 'ללא פרטים נוספים.';
    return entries.map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' | ');
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
