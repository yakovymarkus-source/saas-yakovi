import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Image, Upload, Search, Trash2, ExternalLink,
  Loader2, Copy, CheckCheck, Grid3X3, List,
  Globe, ImageIcon, FileText,
} from 'lucide-react'
import { useAppState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { useToast } from '../hooks/useToast'
import { sb } from '../api/client'
import { getPlanLimits } from '../state/types'

type AssetCategory = 'all' | 'landing_page' | 'post_banner' | 'copywriting'

interface Asset {
  id: string
  name: string
  type: 'image' | 'video' | 'document' | 'other'
  category: AssetCategory | 'general'
  url: string
  thumbnail_url: string | null
  size_bytes: number | null
  created_at: string
}

const CATEGORIES: { id: AssetCategory; label: string; Icon: React.ElementType; color: string }[] = [
  { id: 'all',          label: 'הכל',            Icon: Image,     color: 'from-pink-500 to-rose-600'    },
  { id: 'landing_page', label: 'דפי נחיתה',      Icon: Globe,     color: 'from-blue-500 to-cyan-600'    },
  { id: 'post_banner',  label: 'פוסטים ובאנרים', Icon: ImageIcon, color: 'from-purple-500 to-violet-600' },
  { id: 'copywriting',  label: 'קופירייטינג',    Icon: FileText,  color: 'from-amber-500 to-orange-600' },
]

const CAT_LABELS: Record<string, string> = {
  general: 'כללי', landing_page: 'דף נחיתה', post_banner: 'פוסט / באנר', copywriting: 'קופירייטינג',
}

export function Assets() {
  const { state } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const toast = useToast()
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [activeCategory, setActiveCategory] = useState<AssetCategory>('all')
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [preview, setPreview] = useState<Asset | null>(null)
  const [uploadCategory, setUploadCategory] = useState<string>('general')
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const plan = state.subscription?.plan || 'free'
  const limits = getPlanLimits(plan)
  const assetsLimit = limits.assetsLimit ?? Infinity
  const atLimit = assets.length >= assetsLimit

  useEffect(() => {
    if (!state.user) return
    loadAssets()
  }, [state.user])

  const loadAssets = async () => {
    setLoading(true)
    try {
      const { data, error } = await sb
        .from('assets')
        .select('*')
        .eq('user_id', state.user!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      setAssets((data || []) as Asset[])
    } catch {
      toast('שגיאה בטעינת נכסים', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (atLimit) { openUpgrade('להעלאת נכסים נוספים'); return }
    setPendingFile(file)
    setUploadCategory('general')
    setShowCategoryPicker(true)
    e.target.value = ''
  }

  const doUpload = async () => {
    if (!pendingFile) return
    setShowCategoryPicker(false)
    setUploading(true)
    try {
      const ext = pendingFile.name.split('.').pop()
      const path = `${state.user!.id}/${Date.now()}.${ext}`
      const { error: upErr } = await sb.storage.from('assets').upload(path, pendingFile)
      if (upErr) throw upErr

      const { data: urlData } = sb.storage.from('assets').getPublicUrl(path)
      const fileType = pendingFile.type.startsWith('image/') ? 'image'
        : pendingFile.type.startsWith('video/') ? 'video'
        : 'document'

      const { error: dbErr } = await sb.from('assets').insert({
        user_id: state.user!.id,
        name: pendingFile.name,
        type: fileType,
        category: uploadCategory,
        url: urlData.publicUrl,
        size_bytes: pendingFile.size,
      })
      if (dbErr) throw dbErr
      await loadAssets()
      toast('הנכס הועלה בהצלחה', 'success')
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'שגיאה בהעלאה', 'error')
    } finally {
      setUploading(false)
      setPendingFile(null)
    }
  }

  const deleteAsset = async (asset: Asset) => {
    if (!confirm('למחוק נכס זה?')) return
    setDeleting(asset.id)
    try {
      await sb.from('assets').delete().eq('id', asset.id)
      setAssets(prev => prev.filter(a => a.id !== asset.id))
      toast('נכס נמחק', 'success')
    } catch {
      toast('שגיאה במחיקה', 'error')
    } finally {
      setDeleting(null)
    }
  }

  const copyUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
    toast('הקישור הועתק', 'success')
  }

  const fmtSize = (bytes: number | null) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  }

  const filtered = assets.filter(a => {
    if (activeCategory !== 'all' && a.category !== activeCategory) return false
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const countByCategory = (cat: AssetCategory) =>
    cat === 'all' ? assets.length : assets.filter(a => a.category === cat).length

  return (
    <div className="p-6 max-w-6xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg">
            <Image className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">נכסים</h1>
            <p className="text-slate-400 text-sm">{assets.length} / {assetsLimit === Infinity ? '∞' : assetsLimit} נכסים</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setView(v => v === 'grid' ? 'list' : 'grid')}
            className="p-2 text-slate-400 hover:text-white border border-white/10 rounded-xl hover:bg-white/5 transition-colors">
            {view === 'grid' ? <List className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
          </button>
          <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold cursor-pointer transition-all ${
            atLimit || uploading
              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-gradient-to-l from-pink-500 to-rose-600 text-white hover:opacity-90'
          }`}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            העלה נכס
            <input type="file" className="hidden" onChange={handleFileSelect}
              accept="image/*,video/*,.pdf,.doc,.docx,.txt" disabled={atLimit || uploading} />
          </label>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon ?? Image
          const count = countByCategory(cat.id)
          return (
            <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${
                activeCategory === cat.id
                  ? `bg-gradient-to-l ${cat.color} text-white border-transparent shadow-md`
                  : 'bg-slate-900/60 border-white/10 text-slate-400 hover:text-white hover:border-white/20'
              }`}>
              <Icon className="w-3.5 h-3.5" />
              {cat.label}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                activeCategory === cat.id ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-400'
              }`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Limit bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>שימוש בנכסים</span>
          <span>{assets.length} / {assetsLimit === Infinity ? '∞' : assetsLimit}</span>
        </div>
        <div className="bg-slate-800 rounded-full h-1.5 overflow-hidden">
          <div className="h-full bg-gradient-to-l from-pink-500 to-rose-600 rounded-full transition-all"
            style={{ width: assetsLimit === Infinity ? '10%' : `${Math.min(100, (assets.length / assetsLimit) * 100)}%` }} />
        </div>
        {atLimit && (
          <button onClick={() => openUpgrade('נכסים נוספים')} className="text-xs text-purple-400 mt-1 underline hover:no-underline">
            שדרג להגדלת המכסה
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute top-2.5 right-3 w-4 h-4 text-slate-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="חפש נכס..."
          className="w-full bg-slate-900/60 border border-white/10 rounded-xl pr-9 px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500" />
      </div>

      {/* Grid / List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-pink-400 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-3xl bg-slate-800/60 border border-white/10 flex items-center justify-center mx-auto mb-4">
            <Image className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-slate-500 text-sm">
            {activeCategory === 'all' ? 'אין נכסים עדיין' : `אין נכסים בקטגוריה "${CATEGORIES.find(c => c.id === activeCategory)?.label}"`}
          </p>
          <p className="text-slate-600 text-xs mt-1">העלה קבצים ובחר קטגוריה מתאימה</p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map(asset => (
            <motion.div key={asset.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="group bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden cursor-pointer hover:border-pink-500/50 transition-colors"
              onClick={() => setPreview(asset)}>
              <div className="aspect-square bg-slate-800 flex items-center justify-center overflow-hidden">
                {asset.type === 'image' ? (
                  <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-4xl">
                    {asset.type === 'video' ? '🎬' : asset.type === 'document' ? '📄' : '📁'}
                  </div>
                )}
              </div>
              <div className="p-2">
                <p className="text-white text-xs font-medium truncate">{asset.name}</p>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-slate-500 text-[10px]">{fmtSize(asset.size_bytes)}</p>
                  {asset.category && asset.category !== 'general' && (
                    <span className="text-[9px] bg-white/10 text-slate-400 px-1.5 py-0.5 rounded-full">
                      {CAT_LABELS[asset.category]}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(asset => (
            <motion.div key={asset.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex items-center gap-3 bg-slate-900/60 border border-white/10 rounded-xl p-3 hover:border-pink-500/30 transition-colors">
              <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                {asset.type === 'image' ? (
                  <img src={asset.url} alt={asset.name} className="w-full h-full object-cover rounded-xl" />
                ) : (
                  <span className="text-xl">{asset.type === 'video' ? '🎬' : '📄'}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{asset.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-slate-500 text-xs">{fmtSize(asset.size_bytes)} · {new Date(asset.created_at).toLocaleDateString('he-IL')}</p>
                  {asset.category && asset.category !== 'general' && (
                    <span className="text-[10px] bg-white/10 text-slate-400 px-2 py-0.5 rounded-full">
                      {CAT_LABELS[asset.category]}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => copyUrl(asset.url, asset.id)} className="p-1.5 text-slate-500 hover:text-blue-400 transition-colors rounded-lg hover:bg-white/5">
                  {copied === asset.id ? <CheckCheck className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <a href={asset.url} target="_blank" rel="noopener noreferrer" className="p-1.5 text-slate-500 hover:text-white transition-colors rounded-lg hover:bg-white/5">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button onClick={() => deleteAsset(asset)} disabled={deleting === asset.id} className="p-1.5 text-slate-500 hover:text-red-400 transition-colors rounded-lg hover:bg-white/5">
                  {deleting === asset.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Category picker modal */}
      <AnimatePresence>
        {showCategoryPicker && pendingFile && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => { setShowCategoryPicker(false); setPendingFile(null) }}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-sm"
              onClick={e => e.stopPropagation()}>
              <h3 className="text-white font-bold text-base mb-1">לאיזה קטגוריה שייך הנכס?</h3>
              <p className="text-slate-400 text-xs mb-5 truncate">📎 {pendingFile.name}</p>
              <div className="space-y-2 mb-5">
                {[
                  { id: 'general',     label: 'כללי',            desc: 'קבצים שאינם שייכים לקטגוריה ספציפית' },
                  { id: 'landing_page', label: 'דף נחיתה',       desc: 'תמונות, לוגו וגרפיקה לדפי נחיתה' },
                  { id: 'post_banner',  label: 'פוסט / באנר',    desc: 'עיצובים לרשתות חברתיות ומודעות' },
                  { id: 'copywriting',  label: 'קופירייטינג',    desc: 'מסמכי טקסט, סקריפטים וקופי' },
                ].map(opt => (
                  <button key={opt.id} onClick={() => setUploadCategory(opt.id)}
                    className={`w-full flex items-start gap-3 p-3 rounded-xl border text-right transition-all ${
                      uploadCategory === opt.id
                        ? 'border-pink-500/60 bg-pink-500/10'
                        : 'border-white/10 bg-slate-800/40 hover:border-white/20'
                    }`}>
                    <div className={`w-3 h-3 rounded-full border-2 mt-0.5 flex-shrink-0 ${uploadCategory === opt.id ? 'border-pink-500 bg-pink-500' : 'border-slate-500'}`} />
                    <div>
                      <p className="text-white text-sm font-medium">{opt.label}</p>
                      <p className="text-slate-400 text-xs">{opt.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowCategoryPicker(false); setPendingFile(null) }}
                  className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm transition-colors">
                  ביטול
                </button>
                <button onClick={doUpload}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-l from-pink-500 to-rose-600 text-white font-bold text-sm hover:opacity-90 transition-opacity">
                  העלה
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview Modal */}
      <AnimatePresence>
        {preview && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setPreview(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-slate-900 border border-white/20 rounded-3xl p-4 max-w-2xl w-full max-h-[80vh] overflow-hidden"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-white font-semibold truncate">{preview.name}</p>
                  {preview.category && preview.category !== 'general' && (
                    <span className="text-[10px] text-slate-400">{CAT_LABELS[preview.category]}</span>
                  )}
                </div>
                <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
              </div>
              {preview.type === 'image' && (
                <img src={preview.url} alt={preview.name} className="w-full max-h-[60vh] object-contain rounded-xl" />
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={() => copyUrl(preview.url, preview.id)}
                  className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm py-2 rounded-xl transition-colors">
                  <Copy className="w-4 h-4" /> העתק קישור
                </button>
                <a href={preview.url} target="_blank" rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm py-2 rounded-xl transition-colors">
                  <ExternalLink className="w-4 h-4" /> פתח בחלון חדש
                </a>
                <button onClick={() => { deleteAsset(preview); setPreview(null) }}
                  className="px-3 flex items-center gap-2 bg-red-900/30 hover:bg-red-900/50 border border-red-500/30 text-red-400 text-sm py-2 rounded-xl transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
