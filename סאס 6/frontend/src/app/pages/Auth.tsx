import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, Eye, EyeOff, Mail, Lock, User, Loader2, ArrowRight } from 'lucide-react'
import { sb } from '../api/client'
import { useToast } from '../hooks/useToast'

type Mode = 'login' | 'signup' | 'forgot'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M18 9a9 9 0 1 0-10.406 8.892V11.25H5.344V9h2.25V7.013c0-2.22 1.323-3.447 3.347-3.447.97 0 1.984.173 1.984.173v2.18h-1.118c-1.101 0-1.444.683-1.444 1.383V9h2.457l-.393 2.25H10.36v6.642A9.002 9.002 0 0 0 18 9z" fill="#1877F2"/>
    </svg>
  )
}

export function Auth() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [socialLoading, setSocialLoading] = useState<'google' | 'facebook' | null>(null)
  const [forgotSent, setForgotSent] = useState(false)
  const toast = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (mode === 'forgot') {
      if (!email.trim()) { toast('נא להזין כתובת מייל', 'warning'); return }
      setLoading(true)
      try {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/#type=recovery`,
        })
        if (error) throw error
        setForgotSent(true)
      } catch (err: unknown) {
        toast(err instanceof Error ? err.message : 'שגיאה', 'error')
      } finally {
        setLoading(false)
      }
      return
    }

    if (mode === 'signup' && !termsAccepted) {
      toast('יש לאשר את תנאי השימוש', 'warning'); return
    }

    setLoading(true)
    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await sb.auth.signUp({
          email, password,
          options: { data: { name, marketing_consent: marketingConsent } },
        })
        if (error) throw error
        toast('ברוך הבא! בדוק את תיבת המייל לאישור.', 'success')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'שגיאה'
      toast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  const signInWithProvider = async (provider: 'google' | 'facebook') => {
    setSocialLoading(provider)
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      })
      if (error) throw error
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'שגיאה', 'error')
      setSocialLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-indigo-900 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative bg-white/10 backdrop-blur-xl rounded-3xl p-8 w-full max-w-md border border-white/20 shadow-2xl"
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center shadow-2xl mb-4">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">CampaignBrain</h1>
          <p className="text-white/60 text-sm mt-1">פלטפורמת שיווק מונעת AI</p>
        </div>

        {/* Forgot password flow */}
        <AnimatePresence mode="wait">
          {mode === 'forgot' ? (
            <motion.div key="forgot" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              {forgotSent ? (
                <div className="text-center py-4">
                  <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <Mail className="w-7 h-7 text-green-400" />
                  </div>
                  <p className="text-white font-semibold mb-1">בדוק את המייל שלך</p>
                  <p className="text-white/60 text-sm mb-6">שלחנו לך קישור לאיפוס הסיסמה ל-{email}</p>
                  <button onClick={() => { setMode('login'); setForgotSent(false) }}
                    className="text-purple-300 text-sm hover:text-purple-200 flex items-center gap-1 mx-auto">
                    <ArrowRight className="w-4 h-4" /> חזור לכניסה
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-white font-semibold mb-1">שכחת סיסמה?</p>
                  <p className="text-white/60 text-sm mb-5">הכנס את המייל שלך ונשלח לך קישור לאיפוס</p>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="relative">
                      <Mail className="absolute top-3.5 right-3.5 w-5 h-5 text-white/40" />
                      <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                        placeholder="כתובת מייל" required
                        className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 py-3 pr-11 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm" />
                    </div>
                    <button type="submit" disabled={loading}
                      className="w-full py-3.5 bg-gradient-to-l from-purple-600 to-blue-600 text-white rounded-2xl font-bold text-sm hover:opacity-90 disabled:opacity-60 transition-opacity flex items-center justify-center gap-2">
                      {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> שולח...</> : 'שלח קישור לאיפוס'}
                    </button>
                  </form>
                  <button onClick={() => setMode('login')}
                    className="mt-4 text-white/50 hover:text-white/80 text-sm flex items-center gap-1">
                    <ArrowRight className="w-4 h-4" /> חזור לכניסה
                  </button>
                </>
              )}
            </motion.div>
          ) : (
            <motion.div key="main" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              {/* Mode Toggle */}
              <div className="flex bg-white/10 rounded-2xl p-1 mb-6">
                {(['login', 'signup'] as Mode[]).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                      mode === m ? 'bg-white text-gray-900 shadow' : 'text-white/70 hover:text-white'
                    }`}>
                    {m === 'login' ? 'כניסה' : 'הרשמה'}
                  </button>
                ))}
              </div>

              {/* Social Login */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <button type="button" onClick={() => signInWithProvider('google')}
                  disabled={!!socialLoading || loading}
                  className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl py-3 text-white text-sm font-medium transition-all disabled:opacity-50">
                  {socialLoading === 'google' ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleIcon />}
                  Google
                </button>
                <button type="button" onClick={() => signInWithProvider('facebook')}
                  disabled={!!socialLoading || loading}
                  className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl py-3 text-white text-sm font-medium transition-all disabled:opacity-50">
                  {socialLoading === 'facebook' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FacebookIcon />}
                  Facebook
                </button>
              </div>

              <div className="flex items-center gap-3 mb-5">
                <div className="flex-1 h-px bg-white/15" />
                <span className="text-white/40 text-xs">או עם מייל</span>
                <div className="flex-1 h-px bg-white/15" />
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <AnimatePresence>
                  {mode === 'signup' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      <div className="relative">
                        <User className="absolute top-3.5 right-3.5 w-5 h-5 text-white/40" />
                        <input type="text" value={name} onChange={e => setName(e.target.value)}
                          placeholder="שם מלא"
                          className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 py-3 pr-11 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm" />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="relative">
                  <Mail className="absolute top-3.5 right-3.5 w-5 h-5 text-white/40" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="כתובת מייל" required
                    className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 py-3 pr-11 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm" />
                </div>

                <div className="relative">
                  <Lock className="absolute top-3.5 right-3.5 w-5 h-5 text-white/40" />
                  <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="סיסמה" required
                    className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 py-3 pr-11 pl-11 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm" />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute top-3.5 left-3.5 text-white/40 hover:text-white/70">
                    {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>

                {mode === 'login' && (
                  <div className="text-left">
                    <button type="button" onClick={() => setMode('forgot')}
                      className="text-purple-300 text-xs hover:text-purple-200 transition-colors">
                      שכחתי סיסמה
                    </button>
                  </div>
                )}

                <AnimatePresence>
                  {mode === 'signup' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-3 pt-1">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} className="mt-0.5 w-4 h-4 accent-purple-400" />
                        <span className="text-white/70 text-xs leading-relaxed">
                          קראתי ואני מסכים/ה ל<a href="/terms" target="_blank" className="text-purple-300 underline mx-1">תנאי השימוש</a>ול<a href="/privacy" target="_blank" className="text-purple-300 underline mx-1">מדיניות הפרטיות</a><span className="text-red-400">*</span>
                        </span>
                      </label>
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input type="checkbox" checked={marketingConsent} onChange={e => setMarketingConsent(e.target.checked)} className="mt-0.5 w-4 h-4 accent-purple-400" />
                        <span className="text-white/70 text-xs leading-relaxed">אני מעוניין/ת לקבל עדכונים, טיפים ומידע שיווקי במייל (ניתן לביטול בכל עת)</span>
                      </label>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button type="submit" disabled={loading || !!socialLoading}
                  className="w-full py-3.5 bg-gradient-to-l from-purple-600 to-blue-600 text-white rounded-2xl font-bold text-sm hover:shadow-2xl transition-all hover:scale-[1.02] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> רגע...</> : mode === 'login' ? 'כניסה למערכת' : 'יצירת חשבון'}
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-white/40 text-xs text-center mt-6 leading-relaxed">
          🤖 המערכת משתמשת ב-AI ליצירת תוכן. התוצאות אינן מהוות ייעוץ מקצועי.
        </p>
      </motion.div>
    </div>
  )
}
