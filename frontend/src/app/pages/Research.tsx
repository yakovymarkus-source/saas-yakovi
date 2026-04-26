import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Search, Play, Loader2, CheckCircle2, AlertCircle,
  ChevronDown, ChevronUp, Globe, Target, TrendingUp,
  Users, FileText,
} from 'lucide-react'
import { useAppState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { useToast } from '../hooks/useToast'
import { useJobPoller } from '../hooks/useJobPoller'
import { api } from '../api/client'
import { ProgressBanner } from '../components/ui/ProgressBanner'

interface ResearchSection {
  icon: React.ElementType
  label: string
  key: string
  color: string
}

const SECTIONS: ResearchSection[] = [
  { icon: Globe,      label: 'סקירת שוק',     key: 'market',      color: 'text-cyan-400' },
  { icon: Target,     label: 'מתחרים',         key: 'competitors', color: 'text-red-400' },
  { icon: Users,      label: 'קהל יעד',        key: 'audience',    color: 'text-purple-400' },
  { icon: TrendingUp, label: 'טרנדים',         key: 'trends',      color: 'text-green-400' },
  { icon: FileText,   label: 'הזדמנויות',      key: 'opportunities', color: 'text-orange-400' },
]

interface ReportData {
  [key: string]: string | object
}

export function Research() {
  const { state } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const toast = useToast()
  const [query, setQuery] = useState(state.businessProfile?.offer || '')
  const [jobId, setJobId] = useState<string | null>(null)
  const [report, setReport] = useState<ReportData | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [expanded, setExpanded] = useState<string | null>('market')
  const [bannerName, setBannerName] = useState<string | null>(null)

  const plan = state.subscription?.plan || 'free'
  const canResearch = plan !== 'free'

  useJobPoller(
    jobId,
    (data) => {
      setReport(data as ReportData)
      setStatus('done')
      setBannerName(null)
      toast('מחקר השוק הסתיים!', 'success')
    },
    () => {
      setStatus('error')
      setBannerName(null)
      toast('המחקר נכשל, נסה שוב', 'error')
    },
  )

  const startResearch = async () => {
    if (!canResearch) { openUpgrade('מחקר שוק AI'); return }
    if (!query.trim()) { toast('נא להזין תיאור עסק', 'warning'); return }

    setStatus('running')
    setReport(null)
    setBannerName('מחקר שוק')
    try {
      const res = await api<{ jobId?: string; result?: ReportData }>('POST', 'research-start', {
        businessDescription: query,
        userId: state.user?.id,
      })
      if (res.result) {
        setReport(res.result as ReportData)
        setStatus('done')
        setBannerName(null)
      } else if (res.jobId) {
        setJobId(res.jobId)
      }
    } catch (err: unknown) {
      setStatus('error')
      setBannerName(null)
      const msg = err instanceof Error ? err.message : 'שגיאה'
      toast(msg, 'error')
    }
  }

  const renderSection = (key: string) => {
    if (!report) return null
    const val = report[key]
    if (!val) return <p className="text-slate-500 text-sm">אין מידע זמין</p>
    if (typeof val === 'string') return <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{val}</p>
    return <pre className="text-slate-300 text-xs leading-relaxed overflow-auto">{JSON.stringify(val, null, 2)}</pre>
  }

  return (
    <div className="p-6 max-w-4xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg">
            <Search className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">מחקר שוק AI</h1>
            <p className="text-slate-400 text-sm">ניתוח מתחרים, קהל יעד וטרנדים בזמן אמת</p>
          </div>
        </div>
      </div>

      {/* Input Card */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 mb-6">
        <label className="block text-white text-sm font-semibold mb-2">תאר את העסק שלך</label>
        <textarea
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="לדוגמה: חנות אונליין למוצרי טיפוח טבעיים, קהל יעד נשים 25-45, ישראל..."
          rows={3}
          className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
        />
        <div className="flex items-center justify-between mt-3">
          <p className="text-slate-500 text-xs">המחקר לוקח כ-60-90 שניות</p>
          <button
            onClick={startResearch}
            disabled={status === 'running'}
            className="flex items-center gap-2 bg-gradient-to-l from-cyan-500 to-blue-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {status === 'running'
              ? <><Loader2 className="w-4 h-4 animate-spin" /> מחקר בתהליך...</>
              : <><Play className="w-4 h-4" /> הפעל מחקר</>}
          </button>
        </div>
      </div>

      {/* Status messages */}
      <AnimatePresence>
        {status === 'error' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="mb-4 flex items-center gap-2 bg-red-900/30 border border-red-500/30 rounded-xl px-4 py-3"
          >
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span className="text-red-300 text-sm">המחקר נכשל. בדוק חיבור ונסה שנית.</span>
          </motion.div>
        )}
        {status === 'done' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="mb-4 flex items-center gap-2 bg-green-900/30 border border-green-500/30 rounded-xl px-4 py-3"
          >
            <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
            <span className="text-green-300 text-sm">המחקר הסתיים בהצלחה!</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Report */}
      {report && (
        <div className="space-y-3">
          {SECTIONS.map(section => {
            const Icon = section.icon
            const isOpen = expanded === section.key
            return (
              <motion.div
                key={section.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden"
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : section.key)}
                  className="w-full flex items-center gap-3 p-4 hover:bg-white/5 transition-colors text-right"
                >
                  <Icon className={`w-5 h-5 ${section.color} flex-shrink-0`} />
                  <span className="text-white font-semibold text-sm flex-1">{section.label}</span>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                </button>
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t border-white/10"
                    >
                      <div className="p-4">
                        {renderSection(section.key)}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {status === 'idle' && !report && (
        <div className="text-center py-16">
          <div className="w-20 h-20 rounded-3xl bg-slate-800/60 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <Search className="w-10 h-10 text-slate-600" />
          </div>
          <p className="text-slate-500 text-sm">הזן תיאור עסק והפעל מחקר שוק</p>
        </div>
      )}

      <ProgressBanner campaignName={bannerName} onDismiss={() => setBannerName(null)} />
    </div>
  )
}
