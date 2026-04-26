import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Bell, Loader2, CheckCheck } from 'lucide-react'
import { useAppState, setState } from '../state/store'
import { sb } from '../api/client'

interface Update {
  id: string
  title: string
  body: string
  type: 'feature' | 'fix' | 'improvement' | 'announcement'
  published_at: string | null
  created_at: string
}

const TYPE_CONFIG = {
  feature: { label: 'פיצ\'ר חדש', color: 'bg-purple-500/20 text-purple-400', emoji: '✨' },
  fix: { label: 'תיקון', color: 'bg-red-500/20 text-red-400', emoji: '🔧' },
  improvement: { label: 'שיפור', color: 'bg-blue-500/20 text-blue-400', emoji: '⚡' },
  announcement: { label: 'הודעה', color: 'bg-green-500/20 text-green-400', emoji: '📢' },
}

export function Updates() {
  const { state, dispatch } = useAppState()
  const [updates, setUpdates] = useState<Update[]>([])
  const [loading, setLoading] = useState(true)
  const [seen, setSeen] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadUpdates()
  }, [])

  useEffect(() => {
    if (!state.user || updates.length === 0) return
    const seenKey = 'seen_updates_' + state.user.id
    const existing: string[] = JSON.parse(localStorage.getItem(seenKey) || '[]')
    const newSeen = new Set(existing)
    updates.forEach(u => newSeen.add(u.id))
    localStorage.setItem(seenKey, JSON.stringify([...newSeen]))
    setSeen(newSeen)
    setState(dispatch, { updatesCount: 0 })
  }, [updates, state.user, dispatch])

  const loadUpdates = async () => {
    setLoading(true)
    try {
      const { data, error } = await sb
        .from('system_updates')
        .select('*')
        .eq('published', true)
        .order('published_at', { ascending: false })
      if (!error) setUpdates((data || []) as Update[])
    } finally {
      setLoading(false)
    }
  }

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <div className="p-6 max-w-3xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-lg">
            <Bell className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">עדכוני מערכת</h1>
            <p className="text-slate-400 text-sm">חדשות, שיפורים ותיקונים</p>
          </div>
        </div>
        {updates.length > 0 && (
          <div className="flex items-center gap-1.5 text-green-400 text-xs">
            <CheckCheck className="w-4 h-4" />
            <span>הכל נקרא</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
        </div>
      ) : updates.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-3xl bg-slate-800/60 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <Bell className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-slate-500 text-sm">אין עדכונים עדיין</p>
        </div>
      ) : (
        <div className="space-y-4">
          {updates.map((update, i) => {
            const cfg = TYPE_CONFIG[update.type] || TYPE_CONFIG.announcement
            const isNew = !seen.has(update.id)
            return (
              <motion.div
                key={update.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className={`bg-slate-900/60 border rounded-2xl p-5 transition-colors ${
                  isNew ? 'border-indigo-500/40' : 'border-white/10'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{cfg.emoji}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.color}`}>
                      {cfg.label}
                    </span>
                    {isNew && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400">
                        חדש
                      </span>
                    )}
                  </div>
                  <span className="text-slate-500 text-xs flex-shrink-0">
                    {fmtDate(update.published_at || update.created_at)}
                  </span>
                </div>
                <h3 className="text-white font-bold text-sm mb-2">{update.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed whitespace-pre-wrap">{update.body}</p>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
