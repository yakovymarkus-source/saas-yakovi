import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Settings as SettingsIcon, Building2, CreditCard,
  Bell, Shield, Lock, Users, Loader2, CheckCircle2, Zap,
} from 'lucide-react'
import { useAppState, setState } from '../state/store'
import { useToast } from '../hooks/useToast'
import { api, sb } from '../api/client'
import { getPlanLabel } from '../state/types'

const TABS = [
  { id: 'business',      icon: Building2,  label: 'פרופיל עסקי' },
  { id: 'billing',       icon: CreditCard, label: 'חיוב ומנוי' },
  { id: 'notifications', icon: Bell,       label: 'התראות' },
  { id: 'meta',          icon: Zap,        label: 'Meta Pixel' },
  { id: 'privacy',       icon: Shield,     label: 'פרטיות' },
  { id: 'security',      icon: Lock,       label: 'אבטחה' },
  { id: 'team',          icon: Users,      label: 'צוות' },
] as const
type TabId = typeof TABS[number]['id']

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-purple-500' : 'bg-slate-600'}`}
    >
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${checked ? 'right-0.5' : 'left-0.5'}`} />
    </button>
  )
}

export function Settings() {
  const { state, dispatch } = useAppState()
  const toast = useToast()
  const [tab, setTab] = useState<TabId>('business')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const bp = state.businessProfile
  const [form, setForm] = useState({
    business_name: bp?.business_name || '',
    offer: bp?.offer || '',
    target_audience: bp?.target_audience || '',
    problem_solved: bp?.problem_solved || '',
    monthly_budget: bp?.monthly_budget?.toString() || '',
    primary_goal: bp?.primary_goal || '',
  })

  const [notifs, setNotifs] = useState({
    email_reports: true,
    campaign_alerts: true,
    weekly_digest: false,
    marketing_emails: state.profile?.marketing_consent || false,
  })

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [metaForm, setMetaForm] = useState({ pixelId: '', accessToken: '' })
  const [metaStatus, setMetaStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [metaTesting, setMetaTesting] = useState(false)

  const field = (k: keyof typeof form) => (
    <input
      value={form[k]}
      onChange={e => setForm(prev => ({ ...prev, [k]: e.target.value }))}
      className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
    />
  )

  const saveBusiness = async () => {
    if (!state.user) return
    setSaving(true)
    try {
      const bpFields = {
        business_name: form.business_name,
        offer: form.offer,
        target_audience: form.target_audience,
        problem_solved: form.problem_solved,
        monthly_budget: form.monthly_budget ? parseInt(form.monthly_budget) : null,
        primary_goal: form.primary_goal,
        price_amount: bp?.price_amount ?? null,
        pricing_model: bp?.pricing_model ?? null,
      }
      const { error } = await sb.from('business_profiles').upsert(
        { user_id: state.user.id, ...bpFields },
        { onConflict: 'user_id' }
      )
      if (error) throw error
      setState(dispatch, { businessProfile: bpFields })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      toast('פרופיל עסקי נשמר', 'success')
    } catch (err: unknown) {
      toast('שגיאה בשמירה', 'error')
    } finally {
      setSaving(false)
    }
  }

  const changePassword = async () => {
    if (pwForm.next !== pwForm.confirm) { toast('הסיסמאות אינן תואמות', 'warning'); return }
    if (pwForm.next.length < 6) { toast('סיסמה חייבת להכיל לפחות 6 תווים', 'warning'); return }
    setSaving(true)
    try {
      const { error } = await sb.auth.updateUser({ password: pwForm.next })
      if (error) throw error
      setPwForm({ current: '', next: '', confirm: '' })
      toast('הסיסמה שונתה בהצלחה', 'success')
    } catch (err: unknown) {
      toast('שגיאה בשינוי סיסמה', 'error')
    } finally {
      setSaving(false)
    }
  }

  const plan = state.subscription?.plan || 'free'

  return (
    <div className="p-6 max-w-4xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center shadow-lg">
          <SettingsIcon className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">הגדרות</h1>
          <p className="text-slate-400 text-sm">נהל את החשבון והעדפות שלך</p>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <div className="w-48 flex-shrink-0 space-y-1">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all ${
                  tab === t.id
                    ? 'bg-white/15 text-white font-semibold'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
              className="bg-slate-900/60 border border-white/10 rounded-2xl p-5"
            >
              {/* Business Profile */}
              {tab === 'business' && (
                <div className="space-y-4">
                  <h2 className="text-white font-bold mb-4">פרופיל עסקי</h2>
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">שם העסק</label>
                      {field('business_name')}
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">ההצעה / המוצר</label>
                      {field('offer')}
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">קהל יעד</label>
                      {field('target_audience')}
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">בעיה שאתה פותר</label>
                      {field('problem_solved')}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-slate-400 text-xs mb-1">תקציב חודשי (₪)</label>
                        <input
                          type="number"
                          value={form.monthly_budget}
                          onChange={e => setForm(p => ({ ...p, monthly_budget: e.target.value }))}
                          className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 text-xs mb-1">מטרה עיקרית</label>
                        <select
                          value={form.primary_goal}
                          onChange={e => setForm(p => ({ ...p, primary_goal: e.target.value }))}
                          className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="">בחר...</option>
                          <option value="leads">יצירת לידים</option>
                          <option value="sales">מכירות</option>
                          <option value="awareness">מודעות</option>
                          <option value="retention">שימור לקוחות</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={saveBusiness}
                    disabled={saving}
                    className="flex items-center gap-2 bg-gradient-to-l from-purple-600 to-indigo-600 text-white font-bold px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : null}
                    {saved ? 'נשמר!' : 'שמור שינויים'}
                  </button>
                </div>
              )}

              {/* Billing */}
              {tab === 'billing' && (
                <div>
                  <h2 className="text-white font-bold mb-4">חיוב ומנוי</h2>
                  <div className="bg-gradient-to-l from-purple-900/40 to-indigo-900/40 border border-purple-500/30 rounded-2xl p-4 mb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white font-bold">{getPlanLabel(plan)}</p>
                        <p className="text-slate-400 text-xs mt-0.5">
                          {plan === 'free' ? 'חינמי' : plan === 'early_bird' ? '₪10 חד-פעמי' : plan === 'pro' ? '₪249/חודש' : ''}
                        </p>
                      </div>
                      <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                        plan === 'free' ? 'bg-slate-700 text-slate-300' : 'bg-green-500/20 text-green-400'
                      }`}>
                        {plan === 'free' ? 'חינמי' : 'פעיל'}
                      </span>
                    </div>
                  </div>
                  {plan === 'free' && (
                    <div className="space-y-3">
                      <a
                        href="https://buy.stripe.com/early-bird"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full text-center bg-gradient-to-l from-purple-600 to-indigo-600 text-white font-bold py-3 rounded-2xl hover:opacity-90 transition-opacity"
                      >
                        שדרג ל-Early Bird — ₪10 לכל החיים
                      </a>
                      <a
                        href="https://buy.stripe.com/pro"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full text-center bg-gradient-to-l from-indigo-600 to-purple-700 text-white font-bold py-3 rounded-2xl hover:opacity-90 transition-opacity"
                      >
                        שדרג ל-Pro — ₪249/חודש
                      </a>
                    </div>
                  )}
                  {plan !== 'free' && (
                    <p className="text-slate-500 text-sm">לביטול מנוי או שינוי תוכנית, פנה לתמיכה.</p>
                  )}
                </div>
              )}

              {/* Notifications */}
              {tab === 'notifications' && (
                <div>
                  <h2 className="text-white font-bold mb-4">העדפות התראות</h2>
                  <div className="space-y-4">
                    {[
                      { key: 'email_reports' as const, label: 'דוחות שבועיים במייל', desc: 'סיכום שבועי של ביצועי הקמפיינים' },
                      { key: 'campaign_alerts' as const, label: 'התראות קמפיין', desc: 'עדכונים בזמן אמת על שינויים משמעותיים' },
                      { key: 'weekly_digest' as const, label: 'עיכול שבועי', desc: 'טיפים ועדכוני מערכת אחת לשבוע' },
                      { key: 'marketing_emails' as const, label: 'מיילים שיווקיים', desc: 'הצעות, טיפים ומידע שיווקי' },
                    ].map(item => (
                      <div key={item.key} className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
                        <div>
                          <p className="text-white text-sm font-medium">{item.label}</p>
                          <p className="text-slate-500 text-xs mt-0.5">{item.desc}</p>
                        </div>
                        <Toggle
                          checked={notifs[item.key]}
                          onChange={v => setNotifs(prev => ({ ...prev, [item.key]: v }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Privacy */}
              {tab === 'privacy' && (
                <div>
                  <h2 className="text-white font-bold mb-4">פרטיות ונתונים</h2>
                  <div className="space-y-3 text-sm text-slate-400 leading-relaxed">
                    <p>אנחנו מכבדים את הפרטיות שלך. הנתונים שלך לעולם לא יימכרו לצד שלישי.</p>
                    <div className="bg-slate-800/60 border border-white/10 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span>אנליטיקס שימוש</span>
                        <Toggle checked={true} onChange={() => {}} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span>שיפור מוצר</span>
                        <Toggle checked={true} onChange={() => {}} />
                      </div>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <a href="/privacy" target="_blank" className="text-purple-400 underline text-xs">מדיניות פרטיות</a>
                      <a href="/terms" target="_blank" className="text-purple-400 underline text-xs">תנאי שימוש</a>
                    </div>
                    <button className="text-red-400 text-xs hover:text-red-300 underline mt-4 block">
                      בקש מחיקת נתונים
                    </button>
                  </div>
                </div>
              )}

              {/* Security */}
              {tab === 'security' && (
                <div>
                  <h2 className="text-white font-bold mb-4">אבטחה</h2>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">סיסמה חדשה</label>
                      <input
                        type="password"
                        value={pwForm.next}
                        onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))}
                        placeholder="לפחות 6 תווים"
                        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">אימות סיסמה</label>
                      <input
                        type="password"
                        value={pwForm.confirm}
                        onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
                        placeholder="הזן סיסמה שוב"
                        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                    <button
                      onClick={changePassword}
                      disabled={saving || !pwForm.next}
                      className="flex items-center gap-2 bg-gradient-to-l from-purple-600 to-indigo-600 text-white font-bold px-5 py-2.5 rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                      שנה סיסמה
                    </button>
                  </div>
                </div>
              )}

              {/* Meta Pixel */}
              {tab === 'meta' && (
                <div>
                  <h2 className="text-white font-bold mb-1">Meta Pixel & CAPI</h2>
                  <p className="text-slate-500 text-xs mb-4">חבר את הפיקסל של פייסבוק לאינסטגרם/מטא לדיווח המרות מדויק</p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Pixel ID</label>
                      <input value={metaForm.pixelId} onChange={e => setMetaForm(p => ({ ...p, pixelId: e.target.value }))}
                        placeholder="123456789012345"
                        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Access Token (CAPI)</label>
                      <input value={metaForm.accessToken} onChange={e => setMetaForm(p => ({ ...p, accessToken: e.target.value }))}
                        placeholder="EAAxxxxxxxxxxxxxxx"
                        type="password"
                        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          if (!metaForm.pixelId) { toast('נא להזין Pixel ID', 'warning'); return }
                          setMetaTesting(true)
                          try {
                            await api('POST', 'meta-setup', { pixelId: metaForm.pixelId, accessToken: metaForm.accessToken })
                            setMetaStatus('ok'); toast('Meta Pixel חובר בהצלחה!', 'success')
                          } catch { setMetaStatus('error'); toast('שגיאה בחיבור', 'error') }
                          finally { setMetaTesting(false) }
                        }}
                        disabled={metaTesting}
                        className="flex items-center gap-2 bg-gradient-to-l from-blue-600 to-blue-700 text-white font-bold px-5 py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        {metaTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        {metaTesting ? 'בודק...' : 'שמור ובדוק חיבור'}
                      </button>
                      {metaStatus === 'ok' && <span className="flex items-center gap-1 text-green-400 text-sm"><CheckCircle2 className="w-4 h-4" /> מחובר</span>}
                      {metaStatus === 'error' && <span className="text-red-400 text-sm">✗ שגיאה</span>}
                    </div>
                    <p className="text-slate-600 text-xs">ניתן למצוא את הפרטים ב-Meta Events Manager → הגדרות → Pixel</p>
                  </div>
                </div>
              )}

              {/* Team */}
              {tab === 'team' && (
                <div>
                  <h2 className="text-white font-bold mb-4">ניהול צוות</h2>
                  <div className="text-center py-8">
                    <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400 text-sm">ניהול צוות זמין בחבילת Agency</p>
                    <button className="mt-4 bg-gradient-to-l from-purple-600 to-indigo-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl hover:opacity-90">
                      שדרג לAgency
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
