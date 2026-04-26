import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Megaphone, Plus, Play, ChevronRight, Loader2,
  AlertTriangle, CheckCircle2, BarChart3, Share2, X, RefreshCw,
} from 'lucide-react'
import { useAppState, setState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { useToast } from '../hooks/useToast'
import { useJobPoller } from '../hooks/useJobPoller'
import { api, sb } from '../api/client'
import { getPlanLimits } from '../state/types'
import { ProgressBanner } from '../components/ui/ProgressBanner'

interface Rec { text: string; urgency: 'high' | 'medium' | 'low'; effort: 'low' | 'medium' | 'high' }
interface CampaignScore {
  traffic: number; ctr: number; conversion: number; roas: number; coverage: number
  overall: number; verdict: 'healthy' | 'needs_work' | 'critical'
  weak_link: string | null; recommendations: Rec[]
}
interface Camp {
  id: string; name: string; created_at: string
  score: CampaignScore | null; analysing: boolean
}

const VERDICT = {
  healthy:    { label: 'תקין',        color: 'text-green-400',  bg: 'bg-green-500/20',  Icon: CheckCircle2 },
  needs_work: { label: 'טעון שיפור',  color: 'text-yellow-400', bg: 'bg-yellow-500/20', Icon: AlertTriangle },
  critical:   { label: 'קריטי',       color: 'text-red-400',    bg: 'bg-red-500/20',    Icon: AlertTriangle },
}
const URGENCY_CLS = { high: 'bg-red-500/20 text-red-400', medium: 'bg-yellow-500/20 text-yellow-400', low: 'bg-blue-500/20 text-blue-400' }
const URGENCY_LBL = { high: 'דחוף', medium: 'חשוב', low: 'אופציונלי' }
const EFFORT_LBL  = { low: 'קל', medium: 'בינוני', high: 'מורכב' }

function ScoreBar({ label, value }: { label: string; value: number }) {
  const cls = value >= 70 ? 'bg-green-500' : value >= 40 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="text-white font-bold">{value}</span>
      </div>
      <div className="bg-slate-700 rounded-full h-1.5 overflow-hidden">
        <motion.div className={`h-full rounded-full ${cls}`}
          initial={{ width: 0 }} animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }} />
      </div>
    </div>
  )
}

function DetailPanel({ camp, onClose, onAnalyse }: { camp: Camp; onClose: () => void; onAnalyse: (id: string) => void }) {
  const s = camp.score
  const v = s ? VERDICT[s.verdict] : null
  return (
    <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
      className="fixed inset-y-0 left-0 w-full max-w-lg bg-slate-900 border-r border-white/10 shadow-2xl z-40 overflow-y-auto" dir="rtl">
      <div className="p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-white font-bold text-lg">{camp.name}</h2>
            <p className="text-slate-500 text-xs">{new Date(camp.created_at).toLocaleDateString('he-IL')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onAnalyse(camp.id)} disabled={camp.analysing}
              className="flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-xl disabled:opacity-50 transition-colors">
              {camp.analysing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              {camp.analysing ? 'מנתח...' : 'נתח מחדש'}
            </button>
            <button onClick={onClose} className="p-1.5 text-slate-500 hover:text-white rounded-xl hover:bg-white/10 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {camp.analysing && (
          <div className="bg-purple-900/30 border border-purple-500/30 rounded-2xl p-4 mb-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
            <p className="text-purple-300 text-sm">מנתח את הקמפיין עם AI...</p>
          </div>
        )}

        {!s && !camp.analysing && (
          <div className="text-center py-10 bg-slate-800/40 border border-white/10 rounded-2xl">
            <BarChart3 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">לחץ "נתח מחדש" לקבלת תובנות AI</p>
          </div>
        )}

        {s && v && (
          <div className="space-y-4">
            <div className={`rounded-2xl p-4 border flex items-center gap-3 ${v.bg} border-white/10`}>
              <v.Icon className={`w-6 h-6 flex-shrink-0 ${v.color}`} />
              <div className="flex-1">
                <p className={`font-bold ${v.color}`}>{v.label}</p>
                <p className="text-slate-400 text-xs">ציון כולל: {s.overall}/100</p>
              </div>
              <span className="text-4xl font-black text-white opacity-20">{s.overall}</span>
            </div>

            <div className="bg-slate-800/60 border border-white/10 rounded-2xl p-4 space-y-3">
              <p className="text-white text-sm font-semibold mb-1">ציוני ביצועים</p>
              <ScoreBar label="תנועה" value={s.traffic} />
              <ScoreBar label="CTR" value={s.ctr} />
              <ScoreBar label="המרה" value={s.conversion} />
              <ScoreBar label="ROAS" value={s.roas} />
              <ScoreBar label="כיסוי" value={s.coverage} />
            </div>

            {s.weak_link && (
              <div className="bg-red-900/20 border border-red-500/30 rounded-2xl p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-300 text-xs font-bold">חוליה חלשה</p>
                  <p className="text-red-400/80 text-xs mt-0.5">{s.weak_link}</p>
                </div>
              </div>
            )}

            {s.recommendations?.length > 0 && (
              <div className="bg-slate-800/60 border border-white/10 rounded-2xl p-4">
                <p className="text-white text-sm font-semibold mb-3">המלצות</p>
                <div className="space-y-2">
                  {s.recommendations.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 py-2 border-b border-white/5 last:border-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${URGENCY_CLS[r.urgency]}`}>
                        {URGENCY_LBL[r.urgency]}
                      </span>
                      <p className="text-slate-300 text-xs leading-relaxed flex-1">{r.text}</p>
                      <span className="text-slate-600 text-[10px] flex-shrink-0">{EFFORT_LBL[r.effort]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

export function Campaigns() {
  const { state, dispatch } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const toast = useToast()

  const [camps, setCamps] = useState<Camp[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Camp | null>(null)
  const [newName, setNewName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [bannerName, setBannerName] = useState<string | null>(null)
  const [pollJobId, setPollJobId] = useState<string | null>(null)
  const [pollCampId, setPollCampId] = useState<string | null>(null)

  const plan = state.subscription?.plan || 'free'
  const limits = getPlanLimits(plan)
  const canCreate = (limits.campaignLimit ?? 0) > 0

  useEffect(() => { if (state.user) loadCamps() }, [state.user])

  const loadCamps = async () => {
    setLoading(true)
    try {
      const { data: campsData } = await sb.from('campaigns')
        .select('id,name,created_at')
        .eq('owner_user_id', state.user!.id)
        .order('created_at', { ascending: false })

      const campIds = (campsData || []).map((c: Record<string, unknown>) => c.id as string)
      const { data: scoresData } = campIds.length
        ? await sb.from('campaign_scores').select('campaign_id,score_payload').in('campaign_id', campIds)
        : { data: [] }
      const scoresMap = Object.fromEntries((scoresData || []).map((s: Record<string, unknown>) => [s.campaign_id, s.score_payload]))

      const list: Camp[] = (campsData || []).map((c: Record<string, unknown>) => ({
        id: c.id as string, name: c.name as string, created_at: c.created_at as string,
        score: (scoresMap[c.id as string] as CampaignScore | null) ?? null, analysing: false,
      }))
      setCamps(list)
      setState(dispatch, { campaigns: list.map(c => ({ id: c.id, name: c.name, created_at: c.created_at })) })
    } catch { toast('שגיאה בטעינה', 'error') }
    finally { setLoading(false) }
  }

  const createCamp = async () => {
    if (!canCreate) { openUpgrade('יצירת קמפיין'); return }
    if (!newName.trim()) { toast('נא להזין שם', 'warning'); return }
    if (limits.campaignLimit && camps.length >= limits.campaignLimit) { openUpgrade('קמפיינים נוספים'); return }
    setCreating(true)
    try {
      const data = await api<{ id: string; name: string; created_at: string }>('POST', 'create-campaign', { name: newName.trim() })
      setCamps(prev => [{ id: data.id, name: data.name, created_at: data.created_at, score: null, analysing: false }, ...prev])
      setNewName(''); setShowCreate(false)
      toast('קמפיין נוצר!', 'success')
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'שגיאה', 'error') }
    finally { setCreating(false) }
  }

  const patch = (id: string, partial: Partial<Camp>) =>
    setCamps(prev => prev.map(c => c.id === id ? { ...c, ...partial } : c))

  const analysecamp = async (id: string) => {
    const camp = camps.find(c => c.id === id)
    if (!camp) return
    patch(id, { analysing: true })
    setSelected(prev => prev?.id === id ? { ...prev, analysing: true } : prev)
    setBannerName(camp.name)
    try {
      const res = await api<{ jobId?: string; result?: CampaignScore }>('POST', 'analyze-campaign-background', {
        campaignId: id, userId: state.user!.id,
      })
      if (res.result) { applyScore(id, res.result) }
      else if (res.jobId) { setPollJobId(res.jobId); setPollCampId(id) }
      else { patch(id, { analysing: false }); setBannerName(null) }
    } catch (e: unknown) {
      patch(id, { analysing: false }); setBannerName(null)
      setSelected(prev => prev?.id === id ? { ...prev, analysing: false } : prev)
      toast(e instanceof Error ? e.message : 'שגיאה בניתוח', 'error')
    }
  }

  const applyScore = (id: string, score: CampaignScore) => {
    patch(id, { score, analysing: false })
    setSelected(prev => prev?.id === id ? { ...prev, score, analysing: false } : prev)
    setBannerName(null)
    toast('ניתוח הסתיים!', 'success')
  }

  useJobPoller(
    pollJobId,
    (payload) => { if (pollCampId) applyScore(pollCampId, payload as CampaignScore); setPollJobId(null); setPollCampId(null) },
    () => {
      if (pollCampId) { patch(pollCampId, { analysing: false }); setSelected(prev => prev?.id === pollCampId ? { ...prev, analysing: false } : prev) }
      setBannerName(null); setPollJobId(null); setPollCampId(null)
      toast('הניתוח נכשל', 'error')
    }
  )

  const shareReport = async (camp: Camp) => {
    if (!camp.score) { toast('אין נתונים לשיתוף', 'warning'); return }
    try {
      const res = await api<{ url: string }>('POST', 'share-create', { type: 'campaign_score', payload: camp.score, title: camp.name })
      await navigator.clipboard.writeText(res.url)
      toast('קישור הועתק!', 'success')
    } catch { toast('שגיאה ביצירת קישור', 'error') }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center shadow-lg">
            <Megaphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">קמפיינים</h1>
            <p className="text-slate-400 text-sm">{camps.length} קמפיינים</p>
          </div>
        </div>
        <button onClick={() => canCreate ? setShowCreate(v => !v) : openUpgrade('יצירת קמפיין')}
          className="flex items-center gap-2 bg-gradient-to-l from-violet-600 to-purple-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-90 transition-opacity">
          <Plus className="w-4 h-4" /> קמפיין חדש
        </button>
      </div>

      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-5 overflow-hidden">
            <div className="bg-slate-900/60 border border-violet-500/30 rounded-2xl p-4 flex gap-3">
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createCamp()}
                placeholder="שם הקמפיין..." className="flex-1 bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              <button onClick={createCamp} disabled={creating}
                className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors disabled:opacity-50">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} צור
              </button>
              <button onClick={() => setShowCreate(false)} className="p-2 text-slate-500 hover:text-white rounded-xl hover:bg-white/5"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {canCreate && limits.campaignLimit && (
        <div className="mb-5">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>קמפיינים פעילים</span><span>{camps.length} / {limits.campaignLimit}</span>
          </div>
          <div className="bg-slate-800 rounded-full h-1 overflow-hidden">
            <div className="h-full bg-gradient-to-l from-violet-500 to-purple-600 rounded-full"
              style={{ width: `${Math.min(100, (camps.length / limits.campaignLimit) * 100)}%` }} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-violet-400 animate-spin" /></div>
      ) : camps.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-3xl bg-slate-800/60 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <Megaphone className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-slate-500 text-sm">אין קמפיינים עדיין</p>
          <p className="text-slate-600 text-xs mt-1">צור קמפיין וקבל ניתוח AI</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {camps.map((camp, i) => {
            const v = camp.score ? VERDICT[camp.score.verdict] : null
            return (
              <motion.div key={camp.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 hover:border-violet-500/30 transition-colors">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{camp.name}</p>
                    <p className="text-slate-500 text-xs mt-0.5">{new Date(camp.created_at).toLocaleDateString('he-IL')}</p>
                  </div>
                  {v ? (
                    <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${v.bg} ${v.color}`}>
                      <v.Icon className="w-3 h-3" /> {v.label}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full flex-shrink-0">לא נותח</span>
                  )}
                </div>

                {camp.score && (
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                      <div className={`h-full rounded-full ${camp.score.overall >= 70 ? 'bg-green-500' : camp.score.overall >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${camp.score.overall}%` }} />
                    </div>
                    <span className="text-white text-xs font-bold w-7">{camp.score.overall}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button onClick={() => analysecamp(camp.id)} disabled={camp.analysing}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-violet-600/20 hover:bg-violet-600/40 text-violet-400 py-2 rounded-xl transition-colors disabled:opacity-50">
                    {camp.analysing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    {camp.analysing ? 'מנתח...' : 'נתח'}
                  </button>
                  <button onClick={() => setSelected(camp)}
                    className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-2 rounded-xl transition-colors">
                    <ChevronRight className="w-3.5 h-3.5" /> פרטים
                  </button>
                  {camp.score && (
                    <button onClick={() => shareReport(camp)} className="p-2 text-slate-500 hover:text-blue-400 bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors">
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      <AnimatePresence>
        {selected && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-30" onClick={() => setSelected(null)} />
            <DetailPanel camp={selected} onClose={() => setSelected(null)} onAnalyse={analysecamp} />
          </>
        )}
      </AnimatePresence>

      <ProgressBanner campaignName={bannerName} onDismiss={() => setBannerName(null)} />
    </div>
  )
}
