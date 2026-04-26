import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Search, TrendingUp, PenTool, BarChart3, Layers, Cpu,
  Play, Loader2, CheckCircle2, AlertCircle, ChevronDown,
  ChevronUp, Sparkles, FileText, Share2, RefreshCw,
} from 'lucide-react'
import { useAppState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { useToast } from '../hooks/useToast'
import { useJobPoller } from '../hooks/useJobPoller'
import { api } from '../api/client'
import { ProgressBanner } from '../components/ui/ProgressBanner'

interface AgentDef {
  id: string
  icon: React.ElementType
  label: string
  description: string
  gradient: string
  startPath: string
  statusPath: string
  reportPath: string
  tags: string[]
}

const AGENTS: AgentDef[] = [
  {
    id: 'research', icon: Search, label: 'סוכן מחקר שוק',
    description: 'מנתח מתחרים, טרנדים וקהלי יעד. מספק תובנות מקיפות על הנישה שלך.',
    gradient: 'from-cyan-500 to-blue-600',
    startPath: 'research-start', statusPath: 'research-status', reportPath: 'research-report',
    tags: ['מתחרים', 'קהל יעד', 'טרנדים'],
  },
  {
    id: 'strategy', icon: TrendingUp, label: 'סוכן אסטרטגיה',
    description: 'בונה תוכנית שיווקית מקיפה עם יעדים, ערוצים ומסרים מותאמים.',
    gradient: 'from-purple-500 to-pink-600',
    startPath: 'strategy-start', statusPath: 'strategy-status', reportPath: 'strategy-report',
    tags: ['תוכנית', 'ערוצים', 'מסרים'],
  },
  {
    id: 'execution', icon: PenTool, label: 'סוכן עוציב/קופי',
    description: 'יוצר תוכן שיווקי: מודעות, פוסטים, מיילים, דפי נחיתה.',
    gradient: 'from-orange-500 to-red-600',
    startPath: 'execution-start', statusPath: 'execution-status', reportPath: 'execution-report',
    tags: ['מודעות', 'פוסטים', 'מיילים'],
  },
  {
    id: 'analysis', icon: BarChart3, label: 'סוכן אנליטיקס',
    description: 'מנתח נתוני קמפיין, מזהה צווארי בקבוק ומציע שיפורים.',
    gradient: 'from-green-500 to-teal-600',
    startPath: 'analysis-start', statusPath: 'analysis-status', reportPath: 'analysis-report',
    tags: ['KPI', 'ROI', 'ביצועים'],
  },
  {
    id: 'qa', icon: Layers, label: 'סוכן בקרת איכות',
    description: 'בודק תוכן, מסרים ועמידה במיתוג לפני פרסום.',
    gradient: 'from-pink-500 to-rose-600',
    startPath: 'qa-start', statusPath: 'qa-status', reportPath: 'qa-report',
    tags: ['מיתוג', 'תוכן', 'בדיקה'],
  },
  {
    id: 'orchestrate', icon: Cpu, label: 'אורקסטרטור',
    description: 'מריץ את כל הסוכנים יחד — קמפיין מלא מהמחקר ועד הפרסום.',
    gradient: 'from-indigo-500 to-purple-600',
    startPath: 'orchestrate-start', statusPath: 'orchestrate-status', reportPath: 'orchestrate-status',
    tags: ['אוטומציה', 'קמפיין מלא', 'AI'],
  },
]

interface AgentState {
  status: 'idle' | 'running' | 'done' | 'error'
  jobId: string | null
  report: string | Record<string, unknown> | null
  input: string
  campaignId: string
  expanded: boolean
}

type AgentStates = Record<string, AgentState>

export function Agents() {
  const { state } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const toast = useToast()

  const [agentStates, setAgentStates] = useState<AgentStates>(() =>
    Object.fromEntries(AGENTS.map(a => [a.id, { status: 'idle', jobId: null, report: null, input: '', campaignId: '', expanded: false }]))
  )
  const [bannerName, setBannerName] = useState<string | null>(null)
  const [pollingAgent, setPollingAgent] = useState<string | null>(null)
  const [pollingJobId, setPollingJobId] = useState<string | null>(null)

  const plan = state.subscription?.plan || 'free'
  const canRun = plan !== 'free'

  const patch = (agentId: string, partial: Partial<AgentState>) =>
    setAgentStates(prev => ({ ...prev, [agentId]: { ...prev[agentId], ...partial } }))

  const toggle = (id: string) => patch(id, { expanded: !agentStates[id].expanded })

  useJobPoller(
    pollingJobId,
    async (payload) => {
      if (!pollingAgent) return
      const agent = AGENTS.find(a => a.id === pollingAgent)
      if (!agent) return
      // fetch final report
      try {
        const report = await api('GET', `${agent.reportPath}?jobId=${pollingJobId}`)
        patch(pollingAgent, { status: 'done', report: report as string | Record<string, unknown>, jobId: null })
        toast(`${agent.label} סיים!`, 'success')
      } catch {
        patch(pollingAgent, { status: 'done', report: payload as string | Record<string, unknown>, jobId: null })
        toast(`${agent.label} סיים!`, 'success')
      }
      setBannerName(null)
      setPollingAgent(null)
      setPollingJobId(null)
    },
    () => {
      if (pollingAgent) { patch(pollingAgent, { status: 'error', jobId: null }); toast('הסוכן נכשל', 'error') }
      setBannerName(null); setPollingAgent(null); setPollingJobId(null)
    }
  )

  const runAgent = async (agent: AgentDef) => {
    if (!canRun) { openUpgrade(`סוכן ${agent.label}`); return }
    const as = agentStates[agent.id]
    if (!as.input.trim()) { toast('נא להזין תיאור', 'warning'); return }

    patch(agent.id, { status: 'running', report: null })
    setBannerName(agent.label)

    try {
      const res = await api<{ jobId?: string; result?: string | Record<string, unknown> }>('POST', agent.startPath, {
        businessDescription: as.input,
        campaignId: as.campaignId || undefined,
        userId: state.user?.id,
        businessProfile: state.businessProfile,
      })

      if (res.result) {
        patch(agent.id, { status: 'done', report: res.result })
        toast(`${agent.label} סיים!`, 'success')
        setBannerName(null)
      } else if (res.jobId) {
        patch(agent.id, { jobId: res.jobId })
        setPollingAgent(agent.id)
        setPollingJobId(res.jobId)
      } else {
        patch(agent.id, { status: 'done' })
        setBannerName(null)
      }
    } catch (e: unknown) {
      patch(agent.id, { status: 'error' })
      setBannerName(null)
      toast(e instanceof Error ? e.message : 'שגיאה', 'error')
    }
  }

  const shareReport = async (agent: AgentDef) => {
    const as = agentStates[agent.id]
    if (!as.report) return
    try {
      const res = await api<{ url: string }>('POST', 'share-create', {
        type: `agent_report_${agent.id}`,
        payload: as.report,
        title: agent.label,
      })
      await navigator.clipboard.writeText(res.url)
      toast('קישור הועתק!', 'success')
    } catch { toast('שגיאה ביצירת קישור', 'error') }
  }

  const reset = (id: string) => patch(id, { status: 'idle', report: null, jobId: null })

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
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

      {!canRun && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-gradient-to-l from-purple-900/40 to-indigo-900/40 border border-purple-500/30 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-white font-semibold text-sm">שדרג לגישה לסוכנים</p>
            <p className="text-slate-400 text-xs mt-0.5">נדרשת חבילת Early Bird לפחות</p>
          </div>
          <button onClick={() => openUpgrade('סוכני AI')}
            className="bg-gradient-to-l from-purple-600 to-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity">
            שדרג עכשיו
          </button>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {AGENTS.map((agent, i) => {
          const Icon = agent.icon
          const as = agentStates[agent.id]
          const isRunning = as.status === 'running'
          const isDone = as.status === 'done'
          const isError = as.status === 'error'

          return (
            <motion.div key={agent.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
              {/* Header */}
              <button onClick={() => toggle(agent.id)}
                className="w-full p-4 flex items-center gap-4 hover:bg-white/5 transition-colors text-right">
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${agent.gradient} flex items-center justify-center shadow-lg flex-shrink-0`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-white font-semibold text-sm">{agent.label}</span>
                    {isDone && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                    {isError && <AlertCircle className="w-4 h-4 text-red-400" />}
                    {isRunning && <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />}
                  </div>
                  <p className="text-slate-400 text-xs line-clamp-1">{agent.description}</p>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {agent.tags.map(t => <span key={t} className="text-[10px] bg-white/10 text-slate-300 px-2 py-0.5 rounded-full">{t}</span>)}
                  </div>
                </div>
                {as.expanded ? <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" />}
              </button>

              {/* Expanded */}
              <AnimatePresence>
                {as.expanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                    <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-4">

                      {/* Campaign selector */}
                      {state.campaigns.length > 0 && (
                        <div>
                          <label className="block text-slate-400 text-xs mb-1">קמפיין (אופציונלי)</label>
                          <select value={as.campaignId}
                            onChange={e => patch(agent.id, { campaignId: e.target.value })}
                            className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                            <option value="">ללא קמפיין ספציפי</option>
                            {state.campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      )}

                      <textarea value={as.input}
                        onChange={e => patch(agent.id, { input: e.target.value })}
                        placeholder={`תאר את הקמפיין / העסק ל${agent.label}...`}
                        rows={3}
                        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" />

                      <div className="flex gap-2">
                        <button onClick={() => runAgent(agent)} disabled={isRunning}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                            isRunning ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : `bg-gradient-to-l ${agent.gradient} text-white hover:opacity-90`
                          }`}>
                          {isRunning ? <><Loader2 className="w-4 h-4 animate-spin" /> מפעיל...</> : <><Play className="w-4 h-4" /> הפעל סוכן</>}
                        </button>
                        {(isDone || isError) && (
                          <button onClick={() => reset(agent.id)}
                            className="p-2.5 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded-xl transition-colors">
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {/* Report */}
                      {isDone && as.report && (
                        <div className="bg-slate-800/60 border border-green-500/20 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-green-400" />
                              <span className="text-green-400 text-xs font-bold">דוח מוכן</span>
                            </div>
                            <button onClick={() => shareReport(agent)}
                              className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-400 transition-colors">
                              <Share2 className="w-3 h-3" /> שתף
                            </button>
                          </div>
                          <div className="text-slate-300 text-xs leading-relaxed max-h-48 overflow-y-auto">
                            <pre className="whitespace-pre-wrap">
                              {typeof as.report === 'string' ? as.report : JSON.stringify(as.report, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}

                      {isError && (
                        <div className="flex items-center gap-2 bg-red-900/20 border border-red-500/30 rounded-xl p-3">
                          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                          <p className="text-red-300 text-xs">הסוכן נכשל. בדוק חיבור ונסה שוב.</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>

      <ProgressBanner campaignName={bannerName} onDismiss={() => setBannerName(null)} />
    </div>
  )
}
