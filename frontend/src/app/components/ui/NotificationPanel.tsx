import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Bell, X, Loader2, Sparkles, Wrench, Zap, Megaphone } from 'lucide-react'
import { useAppState, setState } from '../../state/store'
import { sb } from '../../api/client'

interface Update {
  id: string
  title: string
  body: string
  type: 'feature' | 'fix' | 'improvement' | 'announcement'
  published_at: string | null
  created_at: string
}

const TYPE_CFG = {
  feature:      { label: 'פיצ\'ר',  icon: Sparkles,  color: 'text-purple-400', bg: 'bg-purple-500/15' },
  fix:          { label: 'תיקון',    icon: Wrench,    color: 'text-red-400',    bg: 'bg-red-500/15'    },
  improvement:  { label: 'שיפור',   icon: Zap,       color: 'text-blue-400',   bg: 'bg-blue-500/15'   },
  announcement: { label: 'הודעה',   icon: Megaphone, color: 'text-green-400',  bg: 'bg-green-500/15'  },
}

const EMOJI = { feature: '✨', fix: '🔧', improvement: '⚡', announcement: '📢' }

export function NotificationBell() {
  const { state, dispatch } = useAppState()
  const [open, setOpen] = useState(false)
  const [updates, setUpdates] = useState<Update[]>([])
  const [loading, setLoading] = useState(false)
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)

  const badge = state.updatesCount || 0

  useEffect(() => {
    if (!open) return
    loadUpdates()
  }, [open])

  // close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const loadUpdates = async () => {
    setLoading(true)
    try {
      const { data } = await sb.from('system_updates').select('*')
        .eq('published', true).order('published_at', { ascending: false })
      const list = (data || []) as Update[]
      setUpdates(list)

      if (state.user) {
        const seenKey = 'seen_updates_' + state.user.id
        const existing: string[] = JSON.parse(localStorage.getItem(seenKey) || '[]')
        const newSeen = new Set(existing)
        list.forEach(u => newSeen.add(u.id))
        localStorage.setItem(seenKey, JSON.stringify([...newSeen]))
        setSeen(newSeen)
        setState(dispatch, { updatesCount: 0 })
      }
    } finally {
      setLoading(false)
    }
  }

  const fmt = (d: string) => new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: 'short' })

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`group relative flex flex-col items-center gap-1 p-2.5 rounded-2xl transition-all duration-200 w-16 ${
          open ? 'bg-white/20 text-white shadow-lg' : 'text-white/50 hover:text-white hover:bg-white/10'
        }`}
        title="עדכונים"
      >
        <div className="relative">
          <Bell className="w-5 h-5" />
          {badge > 0 && (
            <span className="absolute -top-1.5 -left-1.5 bg-red-500 text-white text-[9px] font-bold min-w-[14px] h-[14px] rounded-full flex items-center justify-center px-0.5 leading-none">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </div>
        <span className="text-[9px] font-semibold tracking-wide text-center leading-tight">עדכונים</span>
      </button>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: -12, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -12, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed right-20 top-4 w-80 max-h-[calc(100vh-2rem)] bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col z-50"
            dir="rtl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center">
                  <Bell className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-white font-bold text-sm">עדכוני מערכת</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                </div>
              ) : updates.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <Bell className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-500 text-sm">אין עדכונים עדיין</p>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {updates.map(u => {
                    const cfg = TYPE_CFG[u.type] || TYPE_CFG.announcement
                    const Icon = cfg.icon
                    const isNew = !seen.has(u.id)
                    return (
                      <div key={u.id} className={`px-4 py-3 ${isNew ? 'bg-indigo-500/5' : ''}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm">{EMOJI[u.type]}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
                              {cfg.label}
                            </span>
                            {isNew && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400">חדש</span>
                            )}
                          </div>
                          <span className="text-slate-600 text-[10px]">{fmt(u.published_at || u.created_at)}</span>
                        </div>
                        <p className="text-white text-xs font-semibold mb-0.5">{u.title}</p>
                        <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">{u.body}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
