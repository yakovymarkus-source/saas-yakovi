import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Send, Bot, User, Sparkles, RotateCcw, Loader2, CheckCircle2 } from 'lucide-react'
import { useAppState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { api } from '../api/client'

const MILESTONES = ['חיבור עסק', 'ניתוח שוק', 'יצירת אסטרטגיה', 'השקת קמפיין']

function MilestoneBar({ completed }: { completed: number }) {
  return (
    <div className="px-6 py-3 border-b border-white/10 bg-slate-900/60 flex-shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-slate-400 text-xs">התקדמות</span>
        <span className="text-slate-400 text-xs">{completed}/{MILESTONES.length}</span>
      </div>
      <div className="flex items-center gap-1">
        {MILESTONES.map((m, i) => (
          <div key={m} className="flex items-center flex-1 gap-1">
            <div className={`flex items-center gap-1 flex-1 ${i < completed ? 'opacity-100' : 'opacity-40'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${i < completed ? 'bg-green-500' : 'bg-slate-700'}`}>
                {i < completed
                  ? <CheckCircle2 className="w-3 h-3 text-white" />
                  : <span className="text-[9px] text-slate-400 font-bold">{i + 1}</span>}
              </div>
              <span className="text-[9px] text-slate-400 hidden sm:block truncate">{m}</span>
            </div>
            {i < MILESTONES.length - 1 && (
              <div className={`h-px flex-1 mx-1 ${i < completed - 1 ? 'bg-green-500' : 'bg-slate-700'}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
}

const QUICK_PROMPTS = [
  'תכתוב לי מודעת פייסבוק למוצר שלי',
  'מה אסטרטגיית תוכן מומלצת לעסק שלי?',
  'תעזור לי לנסח הצעת ערך',
  'איך לשפר את שיעור ההמרה שלי?',
  'תכתוב לי סדרת מיילים ל-3 ימים',
]

export function Chat() {
  const { state } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const plan = state.subscription?.plan || 'free'
  const canChat = plan !== 'free'
  const msgCount = messages.filter(m => m.role === 'user').length
  const FREE_LIMIT = 3

  // milestone: derive from state
  const milestonesCompleted = [
    !!state.businessProfile?.business_name,
    !!state.businessProfile?.offer,
    state.campaigns.length > 0,
    state.integrations.some(i => i.connection_status === 'active'),
  ].filter(Boolean).length

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (text?: string) => {
    const content = (text || input).trim()
    if (!content) return

    if (!canChat && msgCount >= FREE_LIMIT) {
      openUpgrade('שיחות AI ללא הגבלה')
      return
    }

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))
      const res = await api<{ reply: string }>('POST', 'campaigner-chat', {
        messages: history,
        businessProfile: state.businessProfile,
        campaigns: state.campaigns,
      })
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: res.reply || 'לא קיבלתי תשובה, נסה שוב.',
        ts: Date.now(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'שגיאה בשיחה'
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `שגיאה: ${msg}`,
        ts: Date.now(),
      }
      setMessages(prev => [...prev, errMsg])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const clear = () => setMessages([])

  return (
    <div className="flex flex-col h-full" dir="rtl">
      <MilestoneBar completed={milestonesCompleted} />
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold">CampaignBrain AI</h1>
            <p className="text-slate-400 text-xs">יועץ שיווקי חכם</p>
          </div>
        </div>
        <button
          onClick={clear}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors text-xs px-3 py-1.5 rounded-xl hover:bg-white/5"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          שיחה חדשה
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-full text-center py-16"
          >
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-cyan-400/20 to-purple-500/20 border border-purple-500/30 flex items-center justify-center mb-4">
              <Bot className="w-8 h-8 text-purple-400" />
            </div>
            <h2 className="text-white font-semibold mb-2">שלום! אני CampaignBrain AI</h2>
            <p className="text-slate-400 text-sm max-w-sm leading-relaxed mb-6">
              אני יועץ שיווקי חכם שיכול לעזור לך עם אסטרטגיה, תוכן, מודעות ועוד.
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {QUICK_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-300 text-xs px-3 py-2 rounded-xl transition-colors text-right"
                >
                  {p}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map(msg => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                msg.role === 'assistant'
                  ? 'bg-gradient-to-br from-cyan-400 to-purple-500'
                  : 'bg-slate-700'
              }`}>
                {msg.role === 'assistant'
                  ? <Sparkles className="w-4 h-4 text-white" />
                  : <User className="w-4 h-4 text-white" />}
              </div>
              <div className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-gradient-to-l from-purple-600 to-indigo-600 text-white'
                  : 'bg-slate-800/80 border border-white/10 text-slate-200'
              }`}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-3"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="bg-slate-800/80 border border-white/10 px-4 py-3 rounded-2xl">
              <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
            </div>
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Free limit warning */}
      {!canChat && msgCount >= FREE_LIMIT - 1 && (
        <div className="px-4 pb-2 flex-shrink-0">
          <div className="bg-purple-900/40 border border-purple-500/30 rounded-xl px-3 py-2 flex items-center justify-between">
            <span className="text-purple-300 text-xs">נשאר לך {FREE_LIMIT - msgCount} הודעה בחינם</span>
            <button
              onClick={() => openUpgrade('שיחות ללא הגבלה')}
              className="text-xs text-purple-300 font-bold underline hover:no-underline"
            >
              שדרג
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-4 flex-shrink-0 border-t border-white/10 pt-3">
        <div className="flex gap-2 bg-slate-800/60 border border-white/10 rounded-2xl p-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="שאל אותי כל שאלה שיווקית..."
            rows={1}
            className="flex-1 bg-transparent text-white placeholder-slate-500 text-sm focus:outline-none resize-none px-2 py-1 leading-relaxed"
            style={{ maxHeight: '120px' }}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            className="w-9 h-9 rounded-xl bg-gradient-to-l from-purple-600 to-indigo-600 flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:opacity-90 transition-opacity self-end"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
        <p className="text-slate-600 text-[10px] text-center mt-1.5">Enter לשליחה · Shift+Enter לשורה חדשה</p>
      </div>
    </div>
  )
}
