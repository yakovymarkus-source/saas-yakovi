import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Bell, Bell as BellIcon, CheckCheck, Loader2 } from 'lucide-react'
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

const TYPE_CONFIG = {
  feature:      { label: 'פיצ\'ר חדש', color: 'bg-purple-500/20 text-purple-400', dot: 'bg-purple-400', emoji: '✨' },
  fix:          { label: 'תיקון',       color: 'bg-red-500/20 text-red-400',       dot: 'bg-red-400',    emoji: '🔧' },
  improvement:  { label: 'שיפור',       color: 'bg-blue-500/20 text-blue-400',     dot: 'bg-blue-400',   emoji: '⚡' },
  announcement: { label: 'הודעה',       color: 'bg-green-500/20 text-green-400',   dot: 'bg-green-400',  emoji: '📢' },
}

export function TopBar() {
  const { state, dispatch } = useAppState()
  const [open, setOpen] = useState(false)
  const [updates, setUpdates] = useState<Update[]>([])
  const [loading, setLoading] = useState(false)
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const panelRef = useRef<HTMLDivElement>(null)
  const badge = (state.updatesCount || 0) + (state.localNotifCount || 0)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const openPanel = async () => {
    setOpen(v => !v)
    if (updates.length === 0) await load()
  }

  const load = async () => {
    setLoading(true)
    try {
      const { data, error } = await sb
        .from('system_updates')
        .select('*')
        .eq('published', true)
        .order('published_at', { ascending: false })
        .limit(20)
      if (!error && data) {
        setUpdates(data as Update[])
        const seenKey = state.user ? 'seen_updates_' + state.user.id : 'seen_updates'
        const existing: string[] = JSON.parse(localStorage.getItem(seenKey) || '[]')
        const newSeen = new Set(existing)
        ;(data as Update[]).forEach(u => newSeen.add(u.id))
        localStorage.setItem(seenKey, JSON.stringify([...newSeen]))
        setSeen(newSeen)
        setState(dispatch, { updatesCount: 0 })
      }
    } finally {
      setLoading(false)
    }
  }

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: 'short' })

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between px-5 py-3 bg-slate-950/80 backdrop-blur-md border-b border-white/5" dir="rtl">
      {/* Right side — page title could go here later */}
      <div />

      {/* Left side — Bell */}
      <div className="relative" ref={panelRef}>
        <motion.button
          onClick={openPanel}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.95 }}
          className={`relative flex items-center justify-center w-9 h-9 rounded-xl transition-all ${
            open ? 'bg-white/15 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white'
          }`}
          title="הודעות מערכת"
        >
          <BellIcon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
          {badge > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold min-w-[16px] h-[16px] rounded-full flex items-center justify-center px-0.5 leading-none shadow-lg">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </motion.button>

        {/* Dropdown panel */}
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute left-0 top-11 w-80 bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-indigo-400" />
                  <span className="text-white font-bold text-sm">הודעות מערכת</span>
                </div>
                {updates.length > 0 && (
                  <div className="flex items-center gap-1 text-green-400 text-[11px]">
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>הכל נקרא</span>
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="max-h-[420px] overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                  </div>
                ) : updates.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <Bell className="w-8 h-8 text-slate-600" />
                    <p className="text-slate-500 text-sm">אין הודעות עדיין</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {updates.map(u => {
                      const cfg = TYPE_CONFIG[u.type] ?? TYPE_CONFIG.announcement
                      const isNew = !seen.has(u.id)
                      return (
                        <div key={u.id} className={`px-4 py-3 transition-colors hover:bg-white/5 ${isNew ? 'bg-indigo-500/5' : ''}`}>
                          <div className="flex items-start gap-2.5">
                            <span className="text-base mt-0.5 flex-shrink-0">{cfg.emoji}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cfg.color}`}>
                                  {cfg.label}
                                </span>
                                {isNew && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                                )}
                                <span className="text-slate-600 text-[10px] mr-auto">{fmtDate(u.published_at || u.created_at)}</span>
                              </div>
                              <p className="text-white text-xs font-semibold leading-snug">{u.title}</p>
                              <p className="text-slate-500 text-[11px] leading-relaxed mt-0.5 line-clamp-2">{u.body}</p>
                            </div>
                          </div>
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
    </div>
  )
}
