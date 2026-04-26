import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Search, TrendingUp, PenTool, BarChart3, Layers, Cpu,
  Play, Loader2, CheckCircle2, AlertCircle, ChevronDown,
  ChevronUp, Sparkles, FileText, Share2, RefreshCw,
  History, Clock, ChevronRight, Download,
} from 'lucide-react'
import { useAppState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { useToast } from '../hooks/useToast'
import { useJobPoller } from '../hooks/useJobPoller'
import { api, sb } from '../api/client'
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
  jobTable: string
}

const AGENTS: AgentDef[] = [
  {
    id: 'research', icon: Search, label: 'סוכן מחקר שוק',
    description: 'מנתח מתחרים, טרנדים וקהלי יעד. מספק תובנות מקיפות על הנישה שלך.',
    gradient: 'from-cyan-500 to-blue-600',
    startPath: 'research-start', statusPath: 'research-status', reportPath: 'research-report',
    tags: ['מתחרים', 'קהל יעד', 'טרנדים'], jobTable: 'research_jobs',
  },
  {
    id: 'strategy', icon: TrendingUp, label: 'סוכן אסטרטגיה',
    description: 'בונה תוכנית שיווקית מקיפה עם יעדים, ערוצים ומסרים מותאמים.',
    gradient: 'from-purple-500 to-pink-600',
    startPath: 'strategy-start', statusPath: 'strategy-status', reportPath: 'strategy-report',
    tags: ['תוכנית', 'ערוצים', 'מסרים'], jobTable: 'strategy_jobs',
  },
  {
    id: 'execution', icon: PenTool, label: 'סוכן עוציב/קופי',
    description: 'יוצר תוכן שיווקי: מודעות, פוסטים, מיילים, דפי נחיתה.',
    gradient: 'from-orange-500 to-red-600',
    startPath: 'execution-start', statusPath: 'execution-status', reportPath: 'execution-report',
    tags: ['מודעות', 'פוסטים', 'מיילים'], jobTable: 'execution_jobs',
  },
  {
    id: 'analysis', icon: BarChart3, label: 'סוכן אנליטיקס',
    description: 'מנתח נתוני קמפיין, מזהה צווארי בקבוק ומציע שיפורים.',
    gradient: 'from-green-500 to-teal-600',
    startPath: 'analysis-start', statusPath: 'analysis-status', reportPath: 'analysis-report',
    tags: ['KPI', 'ROI', 'ביצועים'], jobTable: 'analysis_jobs',
  },
  {
    id: 'qa', icon: Layers, label: 'סוכן בקרת איכות',
    description: 'בודק תוכן, מסרים ועמידה במיתוג לפני פרסום.',
    gradient: 'from-pink-500 to-rose-600',
    startPath: 'qa-start', statusPath: 'qa-status', reportPath: 'qa-report',
    tags: ['מיתוג', 'תוכן', 'בדיקה'], jobTable: 'qa_jobs',
  },
  {
    id: 'orchestrate', icon: Cpu, label: 'אורקסטרטור',
    description: 'מריץ את כל הסוכנים יחד — קמפיין מלא מהמחקר ועד הפרסום.',
    gradient: 'from-indigo-500 to-purple-600',
    startPath: 'orchestrate-start', statusPath: 'orchestrate-status', reportPath: 'orchestrate-status',
    tags: ['אוטומציה', 'קמפיין מלא', 'AI'], jobTable: 'orchestration_jobs',
  },
]

const AGENT_BY_ID = Object.fromEntries(AGENTS.map(a => [a.id, a]))

interface AgentState {
  status: 'idle' | 'running' | 'done' | 'error'
  jobId: string | null
  report: string | Record<string, unknown> | null
  input: string
  campaignId: string
  expanded: boolean
}

type AgentStates = Record<string, AgentState>

// ── History types ──────────────────────────────────────────────────────────────

interface HistoryJob {
  id: string
  agentId: string
  agentLabel: string
  gradient: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  niche?: string
  created_at: string
  completed_at?: string | null
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-green-500/20 text-green-400 border-green-500/30',
    running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    queued: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  }
  const labels: Record<string, string> = {
    completed: 'הושלם', running: 'פועל', queued: 'ממתין', failed: 'נכשל',
  }
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${map[status] ?? 'bg-slate-700 text-slate-400 border-slate-600'}`}>
      {labels[status] ?? status}
    </span>
  )
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ReportViewer({ job, onClose }: { job: HistoryJob; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState<string | Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const agent = AGENT_BY_ID[job.agentId]

  useEffect(() => {
    if (!agent || job.status !== 'completed') {
      setLoading(false)
      return
    }
    api('GET', `${agent.reportPath}?jobId=${job.id}`)
      .then((res: unknown) => {
        const r = res as { report?: unknown }
        setReport((r?.report ?? res) as string | Record<string, unknown>)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'שגיאה בטעינת הדוח'))
      .finally(() => setLoading(false))
  }, [job.id, job.status, agent])

  const reportText = typeof report === 'string' ? report : JSON.stringify(report, null, 2)

  const downloadReport = () => {
    if (!reportText) return
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report-${job.agentId}-${job.id.slice(0, 8)}.txt`
    a.click()
    URL.revokeObjectURL(url)
    toast('הדוח הורד!', 'success')
  }

  const shareReport = async () => {
    if (!report) return
    try {
      const res = await api<{ url: string }>('POST', 'share-create', {
        type: `agent_report_${job.agentId}`,
        payload: report,
        title: job.agentLabel,
      })
      await navigator.clipboard.writeText(res.url)
      toast('קישור הועתק!', 'success')
    } catch { toast('שגיאה ביצירת קישור', 'error') }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${job.gradient} flex items-center justify-center`}>
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-white font-semibold text-sm">{job.agentLabel}</h3>
              <p className="text-slate-400 text-xs">{job.niche || '—'} · {formatDate(job.created_at)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {report && (
              <>
                <button onClick={downloadReport}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors">
                  <Download className="w-3.5 h-3.5" /> הורד
                </button>
                <button onClick={shareReport}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-400 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors">
                  <Share2 className="w-3.5 h-3.5" /> שתף
                </button>
              </>
            )}
            <button onClick={onClose}
              className="text-slate-500 hover:text-white w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-lg leading-none">
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center py-16 gap-3">
              <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
              <span className="text-slate-400 text-sm">טוען דוח...</span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 bg-red-900/20 border border-red-500/30 rounded-xl p-4">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}
          {!loading && !error && job.status !== 'completed' && (
            <div className="text-center py-16">
              <StatusBadge status={job.status} />
              <p className="text-slate-400 text-sm mt-3">
                {job.status === 'failed' ? 'הסוכן נכשל — אין דוח זמין.' : 'הסוכן עדיין לא סיים — נסה שוב בהמשך.'}
              </p>
            </div>
          )}
          {!loading && !error && report && (
            <pre className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap font-mono bg-slate-800/50 rounded-xl p-4">
              {reportText}
            </pre>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function HistoryTab({ userId }: { userId: string }) {
  const [jobs, setJobs] = useState<HistoryJob[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedJob, setSelectedJob] = useState<HistoryJob | null>(null)

  const QUERYABLE_AGENTS = AGENTS.filter(a => a.jobTable !== 'orchestration_jobs')

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.allSettled(
        QUERYABLE_AGENTS.map(agent =>
          sb.from(agent.jobTable)
            .select('id, status, niche, created_at, completed_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20)
            .then(({ data }) =>
              (data ?? []).map(row => ({
                id: row.id as string,
                agentId: agent.id,
                agentLabel: agent.label,
                gradient: agent.gradient,
                status: row.status as HistoryJob['status'],
                niche: (row.niche as string | undefined) || undefined,
                created_at: row.created_at as string,
                completed_at: row.completed_at as string | null | undefined,
              }))
            )
        )
      )

      const all: HistoryJob[] = results
        .flatMap(r => r.status === 'fulfilled' ? r.value : [])
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      setJobs(all)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { loadHistory() }, [loadHistory])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 gap-3">
        <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
        <span className="text-slate-400 text-sm">טוען היסטוריה...</span>
      </div>
    )
  }

  if (!jobs.length) {
    return (
      <div className="text-center py-24">
        <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
          <History className="w-7 h-7 text-slate-500" />
        </div>
        <p className="text-slate-300 font-semibold text-sm mb-1">אין דוחות עדיין</p>
        <p className="text-slate-500 text-xs">הפעל סוכן כדי לראות את התוצאות כאן</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-slate-400 text-xs">{jobs.length} הרצות</p>
        <button onClick={loadHistory}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
          <RefreshCw className="w-3 h-3" /> רענן
        </button>
      </div>

      <div className="space-y-2">
        {jobs.map((job, i) => {
          const AgentIcon = AGENT_BY_ID[job.agentId]?.icon ?? FileText
          return (
            <motion.button key={job.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => setSelectedJob(job)}
              className="w-full bg-slate-900/60 hover:bg-slate-800/60 border border-white/8 hover:border-white/15 rounded-xl p-3.5 flex items-center gap-3 text-right transition-all group">
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${job.gradient} flex items-center justify-center flex-shrink-0`}>
                <AgentIcon className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-white text-sm font-medium truncate">{job.agentLabel}</span>
                  <StatusBadge status={job.status} />
                </div>
                <div className="flex items-center gap-3 text-slate-400 text-xs">
                  {job.niche && <span className="truncate max-w-[180px]">{job.niche}</span>}
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <Clock className="w-3 h-3" />
                    {formatDate(job.created_at)}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 flex-shrink-0 transition-colors" />
            </motion.button>
          )
        })}
      </div>

      <AnimatePresence>
        {selectedJob && (
          <ReportViewer job={selectedJob} onClose={() => setSelectedJob(null)} />
        )}
      </AnimatePresence>
    </>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function Agents() {
  const { state } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<'agents' | 'history'>('agents')

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
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">סוכני AI</h1>
            <p className="text-slate-400 text-sm">הפעל סוכנים חכמים לאוטומציה שיווקית</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 bg-slate-800/50 rounded-xl p-1 w-fit">
          {[
            { id: 'agents', label: 'סוכנים', icon: Sparkles },
            { id: 'history', label: 'היסטוריית דוחות', icon: History },
          ].map(tab => {
            const Icon = tab.icon
            return (
              <button key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-300'
                }`}>
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Upgrade banner */}
      {activeTab === 'agents' && !canRun && (
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

      {/* Agents grid */}
      <AnimatePresence mode="wait">
        {activeTab === 'agents' && (
          <motion.div key="agents" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                  <AnimatePresence>
                    {as.expanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                        <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-4">

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

                          {isDone && as.report && (
                            <div className="bg-slate-800/60 border border-green-500/20 rounded-xl p-3">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5">
                                  <FileText className="w-3.5 h-3.5 text-green-400" />
                                  <span className="text-green-400 text-xs font-bold">דוח מוכן</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button onClick={() => {
                                    const text = typeof as.report === 'string' ? as.report : JSON.stringify(as.report, null, 2)
                                    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
                                    const url = URL.createObjectURL(blob)
                                    const a = document.createElement('a'); a.href = url
                                    a.download = `report-${agent.id}.txt`; a.click()
                                    URL.revokeObjectURL(url)
                                  }} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors">
                                    <Download className="w-3 h-3" /> הורד
                                  </button>
                                  <button onClick={() => shareReport(agent)}
                                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-400 transition-colors">
                                    <Share2 className="w-3 h-3" /> שתף
                                  </button>
                                </div>
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
          </motion.div>
        )}

        {activeTab === 'history' && state.user?.id && (
          <motion.div key="history" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <HistoryTab userId={state.user.id} />
          </motion.div>
        )}
      </AnimatePresence>

      <ProgressBanner campaignName={bannerName} onDismiss={() => setBannerName(null)} />
    </div>
  )
}
