import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import {
  HeadphonesIcon, Send, Loader2, CheckCircle2,
  Clock, AlertCircle, MessageSquare,
} from 'lucide-react'
import { useAppState } from '../state/store'
import { useToast } from '../hooks/useToast'
import { sb } from '../api/client'

interface Ticket {
  id: string
  subject: string
  body: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  created_at: string
  updated_at: string
}

const STATUS_CONFIG = {
  open: { icon: AlertCircle, label: 'פתוח', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  in_progress: { icon: Clock, label: 'בטיפול', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  resolved: { icon: CheckCircle2, label: 'נפתר', color: 'text-green-400', bg: 'bg-green-500/20' },
  closed: { icon: CheckCircle2, label: 'סגור', color: 'text-slate-400', bg: 'bg-slate-500/20' },
}

export function Support() {
  const { state } = useAppState()
  const toast = useToast()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [form, setForm] = useState({ subject: '', body: '' })
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    if (!state.user) return
    loadTickets()
  }, [state.user])

  const loadTickets = async () => {
    setLoading(true)
    try {
      const { data, error } = await sb
        .from('support_tickets')
        .select('*')
        .eq('user_id', state.user!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      setTickets((data || []) as Ticket[])
    } catch {
      toast('שגיאה בטעינת פניות', 'error')
    } finally {
      setLoading(false)
    }
  }

  const submitTicket = async () => {
    if (!form.subject.trim() || !form.body.trim()) {
      toast('נא למלא נושא ותוכן', 'warning')
      return
    }
    setSending(true)
    try {
      const { error } = await sb.from('support_tickets').insert({
        user_id: state.user!.id,
        subject: form.subject,
        body: form.body,
        status: 'open',
      })
      if (error) throw error
      setForm({ subject: '', body: '' })
      setShowForm(false)
      await loadTickets()
      toast('הפנייה נשלחה בהצלחה!', 'success')
    } catch {
      toast('שגיאה בשליחת פנייה', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg">
            <HeadphonesIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">תמיכה</h1>
            <p className="text-slate-400 text-sm">שלח פנייה לצוות שלנו</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-gradient-to-l from-teal-500 to-cyan-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-90 transition-opacity"
        >
          <MessageSquare className="w-4 h-4" />
          פנייה חדשה
        </button>
      </div>

      {/* New Ticket Form */}
      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900/60 border border-teal-500/30 rounded-2xl p-5 mb-6"
        >
          <h2 className="text-white font-bold mb-4">פנייה חדשה</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-slate-400 text-xs mb-1">נושא</label>
              <input
                value={form.subject}
                onChange={e => setForm(p => ({ ...p, subject: e.target.value }))}
                placeholder="תאר בקצרה את הבעיה"
                className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1">תיאור מפורט</label>
              <textarea
                value={form.body}
                onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
                placeholder="תאר את הבעיה בפירוט — כולל מה ניסית לעשות ומה קרה..."
                rows={4}
                className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={submitTicket}
                disabled={sending}
                className="flex items-center gap-2 bg-gradient-to-l from-teal-500 to-cyan-600 text-white font-bold px-5 py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                שלח פנייה
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2.5 text-slate-400 hover:text-white text-sm transition-colors"
              >
                ביטול
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* FAQ quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {[
          { icon: '🚀', title: 'התחלה מהירה', desc: 'איך להתחיל עם CampaignBrain' },
          { icon: '💳', title: 'חיוב ומנוי', desc: 'שאלות על תוכניות ותשלום' },
          { icon: '🔧', title: 'פתרון בעיות', desc: 'בעיות טכניות נפוצות' },
        ].map(item => (
          <div key={item.title} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 cursor-pointer hover:border-teal-500/30 transition-colors">
            <span className="text-2xl mb-2 block">{item.icon}</span>
            <p className="text-white text-sm font-semibold">{item.title}</p>
            <p className="text-slate-500 text-xs mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Tickets List */}
      <h2 className="text-white font-bold mb-3">הפניות שלי</h2>
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-7 h-7 text-teal-400 animate-spin" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="text-center py-12 bg-slate-900/60 border border-white/10 rounded-2xl">
          <HeadphonesIcon className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">אין פניות עדיין</p>
          <p className="text-slate-600 text-xs mt-1">צוות התמיכה כאן לעזור!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(ticket => {
            const cfg = STATUS_CONFIG[ticket.status]
            const StatusIcon = cfg.icon
            return (
              <motion.div
                key={ticket.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 hover:border-white/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm">{ticket.subject}</p>
                    <p className="text-slate-500 text-xs mt-1 line-clamp-2">{ticket.body}</p>
                    <p className="text-slate-600 text-xs mt-2">{new Date(ticket.created_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <span className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${cfg.bg} ${cfg.color}`}>
                    <StatusIcon className="w-3 h-3" />
                    {cfg.label}
                  </span>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
