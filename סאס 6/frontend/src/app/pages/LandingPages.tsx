import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  LayoutTemplate, Plus, Eye, Trash2,
  Loader2, ExternalLink, Copy, CheckCheck, X, Save,
} from 'lucide-react'
import { useAppState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { useToast } from '../hooks/useToast'
import { api, sb } from '../api/client'
import { ProgressBanner } from '../components/ui/ProgressBanner'

interface LandingPage {
  id: string
  title: string
  status: 'active' | 'deleted'
  created_at: string
}

export function LandingPages() {
  const { state } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const toast = useToast()

  const [pages, setPages] = useState<LandingPage[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<LandingPage | null>(null)
  const [generating, setGenerating] = useState(false)
  const [showGen, setShowGen] = useState(false)
  const [genForm, setGenForm] = useState({ title: '', goal: '', audience: '', offer: '' })
  const [bannerName, setBannerName] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const plan = state.subscription?.plan || 'free'
  const canGenerate = plan !== 'free'

  useEffect(() => { if (state.user) load() }, [state.user])

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await sb.from('generated_assets')
        .select('id,title,status,created_at')
        .eq('user_id', state.user!.id)
        .eq('type', 'landing_page_html')
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })
      setPages((data || []).map((d: Record<string, unknown>) => ({
        id: d.id as string,
        title: (d.title as string) || 'דף ללא שם',
        status: (d.status as 'active' | 'deleted') || 'active',
        created_at: d.created_at as string,
      })))
    } catch { toast('שגיאה בטעינה', 'error') }
    finally { setLoading(false) }
  }

  const generate = async () => {
    if (!canGenerate) { openUpgrade('יצירת דפי נחיתה'); return }
    if (!genForm.title.trim()) { toast('נא להזין כותרת', 'warning'); return }
    setGenerating(true)
    setBannerName(genForm.title)
    try {
      await api('POST', 'generate-content', {
        type: 'landing_page',
        title: genForm.title,
        goal: genForm.goal,
        audience: genForm.audience,
        offer: genForm.offer,
        userId: state.user!.id,
        businessProfile: state.businessProfile,
      })
      setGenForm({ title: '', goal: '', audience: '', offer: '' })
      setShowGen(false)
      await load()
      toast('דף הנחיתה נוצר!', 'success')
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'שגיאה', 'error') }
    finally { setGenerating(false); setBannerName(null) }
  }

  const deletePage = async (id: string) => {
    if (!confirm('למחוק דף זה?')) return
    setDeleting(id)
    try {
      await sb.from('generated_assets').update({ status: 'deleted' }).eq('id', id)
      setPages(prev => prev.filter(p => p.id !== id))
      toast('דף נמחק', 'success')
    } catch { toast('שגיאה במחיקה', 'error') }
    finally { setDeleting(null) }
  }

  const copyLink = async (page: LandingPage) => {
    const url = `${window.location.origin}/.netlify/functions/serve-asset?id=${page.id}`
    await navigator.clipboard.writeText(url)
    setCopied(page.id)
    setTimeout(() => setCopied(null), 2000)
    toast('קישור הועתק!', 'success')
  }

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
            <LayoutTemplate className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">דפי נחיתה</h1>
            <p className="text-slate-400 text-sm">{pages.length} דפים</p>
          </div>
        </div>
        <button onClick={() => canGenerate ? setShowGen(v => !v) : openUpgrade('יצירת דפי נחיתה')}
          className="flex items-center gap-2 bg-gradient-to-l from-emerald-500 to-teal-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:opacity-90 transition-opacity">
          <Plus className="w-4 h-4" /> צור דף חדש
        </button>
      </div>

      {/* Generate form */}
      <AnimatePresence>
        {showGen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-6 overflow-hidden">
            <div className="bg-slate-900/60 border border-emerald-500/30 rounded-2xl p-5 space-y-3">
              <p className="text-white font-semibold text-sm">יצירת דף נחיתה עם AI</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { k: 'title' as const, ph: 'כותרת הדף', label: 'כותרת *' },
                  { k: 'goal' as const, ph: 'הרשמה / רכישה / פנייה', label: 'מטרה' },
                  { k: 'audience' as const, ph: 'למי מיועד הדף?', label: 'קהל יעד' },
                  { k: 'offer' as const, ph: 'מה מציעים בדף?', label: 'הצעה' },
                ].map(f => (
                  <div key={f.k}>
                    <label className="block text-slate-400 text-xs mb-1">{f.label}</label>
                    <input value={genForm[f.k]} onChange={e => setGenForm(p => ({ ...p, [f.k]: e.target.value }))}
                      placeholder={f.ph}
                      className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={generate} disabled={generating}
                  className="flex items-center gap-2 bg-gradient-to-l from-emerald-500 to-teal-600 text-white font-bold px-5 py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity">
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {generating ? 'יוצר...' : 'צור דף'}
                </button>
                <button onClick={() => setShowGen(false)} className="px-4 py-2 text-slate-400 hover:text-white text-sm">ביטול</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-emerald-400 animate-spin" /></div>
      ) : pages.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-3xl bg-slate-800/60 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <LayoutTemplate className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-slate-500 text-sm">אין דפי נחיתה עדיין</p>
          <p className="text-slate-600 text-xs mt-1">צור דף נחיתה עם AI בלחיצה אחת</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pages.map((page, i) => (
            <motion.div key={page.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 hover:border-emerald-500/30 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-sm truncate">{page.title}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{new Date(page.created_at).toLocaleDateString('he-IL')}</p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 bg-green-500/20 text-green-400">פעיל</span>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={() => setPreview(page)}
                  className="flex-1 flex items-center justify-center gap-1.5 text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 py-2 rounded-xl transition-colors">
                  <Eye className="w-3.5 h-3.5" /> תצוגה מקדימה
                </button>
                <button onClick={() => copyLink(page)} className="p-2 text-slate-500 hover:text-blue-400 bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors">
                  {copied === page.id ? <CheckCheck className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => deletePage(page.id)} disabled={deleting === page.id}
                  className="p-2 text-slate-500 hover:text-red-400 bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors">
                  {deleting === page.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Preview modal */}
      <AnimatePresence>
        {preview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col" onClick={() => setPreview(null)}>
            <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-white/10" onClick={e => e.stopPropagation()}>
              <p className="text-white font-semibold text-sm">{preview.title}</p>
              <div className="flex items-center gap-2">
                <a href={`/.netlify/functions/serve-asset?id=${preview.id}`} target="_blank" rel="noopener noreferrer"
                  className="text-slate-400 hover:text-white transition-colors p-1">
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-white p-1"><X className="w-4 h-4" /></button>
              </div>
            </div>
            <iframe src={`/.netlify/functions/serve-asset?id=${preview.id}`}
              className="flex-1 bg-white" title={preview.title} onClick={(e: React.MouseEvent) => e.stopPropagation()} />
          </motion.div>
        )}
      </AnimatePresence>

      <ProgressBanner campaignName={bannerName} onDismiss={() => setBannerName(null)} />
    </div>
  )
}
