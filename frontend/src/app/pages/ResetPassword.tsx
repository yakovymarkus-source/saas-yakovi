import { useState } from 'react'
import { motion } from 'motion/react'
import { Sparkles, Eye, EyeOff, Lock, Loader2, CheckCircle2 } from 'lucide-react'
import { sb } from '../api/client'
import { useToast } from '../hooks/useToast'

export function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const toast = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) { toast('סיסמה חייבת להכיל לפחות 6 תווים', 'warning'); return }
    if (password !== confirm) { toast('הסיסמאות אינן תואמות', 'warning'); return }

    setLoading(true)
    try {
      const { error } = await sb.auth.updateUser({ password })
      if (error) throw error
      setDone(true)
      // clear hash so future refreshes don't re-trigger
      window.history.replaceState(null, '', window.location.pathname)
      setTimeout(() => window.location.reload(), 2000)
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'שגיאה', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-indigo-900 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl" />
      </div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
        className="relative bg-white/10 backdrop-blur-xl rounded-3xl p-8 w-full max-w-md border border-white/20 shadow-2xl">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center shadow-2xl mb-4">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">איפוס סיסמה</h1>
          <p className="text-white/60 text-sm mt-1">בחר סיסמה חדשה לחשבונך</p>
        </div>

        {done ? (
          <div className="text-center py-4">
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <p className="text-white font-semibold">הסיסמה עודכנה בהצלחה!</p>
            <p className="text-white/60 text-sm mt-1">מעביר אותך למערכת...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Lock className="absolute top-3.5 right-3.5 w-5 h-5 text-white/40" />
              <input type={showPass ? 'text' : 'password'} value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="סיסמה חדשה (מינימום 6 תווים)" required
                className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 py-3 pr-11 pl-11 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm" />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute top-3.5 left-3.5 text-white/40 hover:text-white/70">
                {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            <div className="relative">
              <Lock className="absolute top-3.5 right-3.5 w-5 h-5 text-white/40" />
              <input type={showPass ? 'text' : 'password'} value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="אימות סיסמה" required
                className="w-full bg-white/10 border border-white/20 rounded-2xl px-4 py-3 pr-11 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm" />
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-gradient-to-l from-purple-600 to-blue-600 text-white rounded-2xl font-bold text-sm hover:opacity-90 disabled:opacity-60 transition-opacity flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> מעדכן...</> : 'עדכן סיסמה'}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  )
}
