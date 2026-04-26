import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Search, TrendingUp, PenTool, BarChart3,
  Layers, Cpu, Play, Loader2, CheckCircle2,
  AlertCircle, ChevronDown, ChevronUp, Sparkles,
} from 'lucide-react'
import { useAppState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { useToast } from '../hooks/useToast'
import { api } from '../api/client'
import { ProgressBanner } from '../components/ui/ProgressBanner'

interface AgentDef {
  id: string
  icon: React.ElementType
  label: string
  description: string
  gradient: string
  pipeline: string | null
  tags: string[]
}

const AGENTS: AgentDef[] = [
  {
    id: 'research',
    icon: Search,
    label: 'סוכן מחקר שוק',
    description: 'מנתח מתחרים, טרנדים, וקהלי יעד. מספק תובנות מקיפות על הנישה שלך.',
    gradient: 'from-cyan-500 to-blue-600',
    pipeline: 'research-start',
    tags: ['מתחרים', 'קהל יעד', 'טרנדים'],
  },
  {
    id: 'strategy',
    icon: TrendingUp,
    label: 'סוכן אסטרטגיה',
    description: 'בונה תוכנית שיווקית מקיפה עם יעדים, ערוצים ומסרים מותאמים.',
    gradient: 'from-purple-500 to-pink-600',
    pipeline: 'create-campaign',
    tags: ['תוכנית', 'ערוצים', 'מסרים'],
  },
  {
    id: 'copywriting',
    icon: PenTool,
    label: 'סוכן קופירייטינג',
    description: 'יוצר תוכן שיווקי: מודעות, פוסטים, מיילים, דפי נחיתה ועוד.',
    gradient: 'from-orange-500 to-red-600',
    pipeline: 'generate-content',
    tags: ['מודעות', 'פוסטים', 'מיילים'],
  },
  {
    id: 'analytics',
    icon: BarChart3,
    label: 'סוכן אנליטיקס',
    description: 'מנתח נתוני קמפיין, מזהה צווארי בקבוק ומציע שיפורים.',
    gradient: 'from-green-500 to-teal-600',
    pipeline: null,
    tags: ['KPI', 'ROI', 'ביצועים'],
  },
  {
    id: 'design',
    icon: Layers,
    label: 'סוכן עיצוב',
    description: 'מייצר ויזואלים לפרסום: בנרים, תמונות מוצר, סרטוני קצר.',
    gradient: 'from-pink-500 to-rose-600',
    pipeline: 'generate-ad-visual',
    tags: ['בנרים', 'תמונות', 'וידאו'],
  },
  {
    id: 'orchestrator',
    icon: Cpu,
    label: 'אורקסטרטור',
    description: 'מנהל את כל הסוכנים יחד — קמפיין מלא מהמחקר ועד הפרסום.',
    gradient: 'from-indigo-500 to-purple-600',
    pipeline: 'orchestrate',
    tags: ['אוטומציה', 'קמפיין מלא', 'AI'],
  },
]

interface AgentInputs {
  [agentId: string]: string
}

export function Agents() {
  const { state } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const toast = useToast()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [inputs, setInputs] = useState<AgentInputs>({})
  const [running, setRunning] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const [bannerCampaign, setBannerCampaign] = useState<string | null>(null)

  const plan = state.subscription?.plan || 'free'
  const canRun = plan !== 'free'

  const toggle = (id: string) => setExpanded(prev => prev === id ? null : id)

  const runAgent = async (agent: AgentDef) => {
    if (!canRun) {
      openUpgrade('להפעלת סוכן AI')
      return
    }
    if (!agent.pipeline) {
      toast('סוכן זה יהיה זמין בקרוב', 'info')
      return
    }
    const input = inputs[agent.id] || ''
    if (!input.trim()) {
      toast('נא להזין תיאור או שאלה לסוכן', 'warning')
      return
    }

    setRunning(agent.id)
    setFailed(prev => { const s = new Set(prev); s.delete(agent.id); return s })
    setBannerCampaign(agent.label)

    try {
      await api('POST', agent.pipeline, {
        businessDescription: input,
        userId: state.user?.id,
      })
      setDone(prev => new Set(prev).add(agent.id))
      toast(`${agent.label} סיים בהצלחה!`, 'success')
    } catch (err: unknown) {
      setFailed(prev => new Set(prev).add(agent.id))
      const msg = err instanceof Error ? err.message : 'שגיאה בהפעלת הסוכן'
      toast(msg, 'error')
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">סוכני AI</h1>
            <p className="text-slate-400 text-sm">הפעל סוכנים חכמים לאוטומציה שיווקית</p>
          </div>
        </div>
      </div>

      {/* Plan notice for free users */}
      {!canRun && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-gradient-to-l from-purple-900/40 to-indigo-900/40 border border-purple-500/30 rounded-2xl p-4 flex items-center justify-between"
        >
          <div>
            <p className="text-white font-semibold text-sm">שדרג לגישה לסוכנים</p>
            <p className="text-slate-400 text-xs mt-0.5">חבילת Early Bird — ₪10 לכל החיים</p>
          </div>
          <button
            onClick={() => openUpgrade('סוכני AI')}
            className="bg-gradient-to-l from-purple-600 to-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity"
          >
            שדרג עכשיו
          </button>
        </motion.div>
      )}

      {/* Agents Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {AGENTS.map((agent, i) => {
          const Icon = agent.icon
          const isExpanded = expanded === agent.id
          const isRunning = running === agent.id
          const isDone = done.has(agent.id)
          const isFailed = failed.has(agent.id)

          return (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden"
            >
              {/* Agent Header */}
              <button
                onClick={() => toggle(agent.id)}
                className="w-full p-4 flex items-center gap-4 hover:bg-white/5 transition-colors text-right"
              >
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${agent.gradient} flex items-center justify-center shadow-lg flex-shrink-0`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white font-semibold text-sm">{agent.label}</span>
                    {isDone && <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />}
                    {isFailed && <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
                    {isRunning && <Loader2 className="w-4 h-4 text-purple-400 animate-spin flex-shrink-0" />}
                  </div>
                  <p className="text-slate-400 text-xs line-clamp-1">{agent.description}</p>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {agent.tags.map(tag => (
                      <span key={tag} className="text-[10px] bg-white/10 text-slate-300 px-2 py-0.5 rounded-full">{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="text-slate-500 flex-shrink-0">
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </button>

              {/* Expanded Input Area */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-4">
                      <textarea
                        value={inputs[agent.id] || ''}
                        onChange={e => setInputs(prev => ({ ...prev, [agent.id]: e.target.value }))}
                        placeholder={`תאר את העסק / הקמפיין שלך ל${agent.label}...`}
                        rows={3}
                        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                      />
                      <button
                        onClick={() => runAgent(agent)}
                        disabled={isRunning}
                        className={`w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                          isRunning
                            ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                            : `bg-gradient-to-l ${agent.gradient} text-white hover:opacity-90 hover:shadow-lg`
                        }`}
                      >
                        {isRunning ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> מפעיל סוכן...</>
                        ) : (
                          <><Play className="w-4 h-4" /> הפעל סוכן</>
                        )}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>

      <ProgressBanner campaignName={bannerCampaign} onDismiss={() => setBannerCampaign(null)} />
    </div>
  )
}
