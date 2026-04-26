import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Image, Upload, Search, Trash2, ExternalLink,
  Loader2, Copy, CheckCheck, Grid3X3, List,
} from 'lucide-react'
import { useAppState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { useToast } from '../hooks/useToast'
import { sb } from '../api/client'
import { getPlanLimits } from '../state/types'

interface Asset {
  id: string
  name: string
  type: 'image' | 'video' | 'document' | 'other'
  url: string
  thumbnail_url: string | null
  size_bytes: number | null
  created_at: string
}

export function Assets() {
  const { state } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const toast = useToast()
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [preview, setPreview] = useState<Asset | null>(null)

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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (atLimit) { openUpgrade('להעלאת נכסים נוספים'); return }

    setUploading(true)
    try {
      const ext = file.name.split('.').pop()
      const path = `${state.user!.id}/${Date.now()}.${ext}`
      const { error: upErr } = await sb.storage.from('assets').upload(path, file)
      if (upErr) throw upErr

      const { data: urlData } = sb.storage.from('assets').getPublicUrl(path)
      const { error: dbErr } = await sb.from('assets').insert({
        user_id: state.user!.id,
        name: file.name,
        type: file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document',
        url: urlData.publicUrl,
        size_bytes: file.size,
      })
      if (dbErr) throw dbErr
      await loadAssets()
      toast('הנכס הועלה בהצלחה', 'success')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'שגיאה בהעלאה'
      toast(msg, 'error')
    } finally {
      setUploading(false)
      e.target.value = ''
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

  const filtered = assets.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase())
  )

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
          <button
            onClick={() => setView(v => v === 'grid' ? 'list' : 'grid')}
            className="p-2 text-slate-400 hover:text-white border border-white/10 rounded-xl hover:bg-white/5 transition-colors"
          >
            {view === 'grid' ? <List className="w-4 h-4" /> : <Grid3X3 className="w-4 h-4" />}
          </button>
          <label className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold cursor-pointer transition-all ${
            atLimit || uploading
              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-gradient-to-l from-pink-500 to-rose-600 text-white hover:opacity-90'
          }`}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            העלה נכס
            <input type="file" className="hidden" onChange={handleUpload} accept="image/*,video/*,.pdf,.doc,.docx" disabled={atLimit || uploading} />
          </label>
        </div>
      </div>

      {/* Limit bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>שימוש בנכסים</span>
          <span>{assets.length} / {assetsLimit === Infinity ? '∞' : assetsLimit}</span>
        </div>
        <div className="bg-slate-800 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-full bg-gradient-to-l from-pink-500 to-rose-600 rounded-full transition-all"
            style={{ width: assetsLimit === Infinity ? '10%' : `${Math.min(100, (assets.length / assetsLimit) * 100)}%` }}
          />
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
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="חפש נכס..."
          className="w-full bg-slate-900/60 border border-white/10 rounded-xl pr-9 px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
        />
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
          <p className="text-slate-500 text-sm">אין נכסים עדיין</p>
          <p className="text-slate-600 text-xs mt-1">העלה תמונות, סרטונים ומסמכים לספרייה</p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map(asset => (
            <motion.div
              key={asset.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="group bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden cursor-pointer hover:border-pink-500/50 transition-colors"
              onClick={() => setPreview(asset)}
            >
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
                <p className="text-slate-500 text-[10px]">{fmtSize(asset.size_bytes)}</p>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(asset => (
            <motion.div
              key={asset.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-3 bg-slate-900/60 border border-white/10 rounded-xl p-3 hover:border-pink-500/30 transition-colors"
            >
              <div className="w-10 h-10 bg-slate-800 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                {asset.type === 'image' ? (
                  <img src={asset.url} alt={asset.name} className="w-full h-full object-cover rounded-xl" />
                ) : (
                  <span className="text-xl">{asset.type === 'video' ? '🎬' : '📄'}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{asset.name}</p>
                <p className="text-slate-500 text-xs">{fmtSize(asset.size_bytes)} · {new Date(asset.created_at).toLocaleDateString('he-IL')}</p>
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

      {/* Preview Modal */}
      <AnimatePresence>
        {preview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setPreview(null)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-slate-900 border border-white/20 rounded-3xl p-4 max-w-2xl w-full max-h-[80vh] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-white font-semibold truncate">{preview.name}</p>
                <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
              </div>
              {preview.type === 'image' && (
                <img src={preview.url} alt={preview.name} className="w-full max-h-[60vh] object-contain rounded-xl" />
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={() => copyUrl(preview.url, preview.id)} className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm py-2 rounded-xl transition-colors">
                  <Copy className="w-4 h-4" /> העתק קישור
                </button>
                <a href={preview.url} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm py-2 rounded-xl transition-colors">
                  <ExternalLink className="w-4 h-4" /> פתח בחלון חדש
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
