import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Plug, CheckCircle2, XCircle, AlertCircle,
  RefreshCw, ExternalLink, Loader2, Key, Webhook,
  X, Eye, EyeOff, ChevronDown, ChevronUp,
} from 'lucide-react'
import { useAppState, setState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { useToast } from '../hooks/useToast'
import { api, sb } from '../api/client'
import type { Integration } from '../state/types'

/* ─── Types ────────────────────────────────────────────────────────────── */
type OAuthProvider = Integration['provider']

interface OAuthDef {
  kind: 'oauth'
  id: OAuthProvider
  name: string
  desc: string
  logo: string
  color: string
  oauthPath: string
}

interface KeyDef {
  kind: 'key'
  id: string
  name: string
  desc: string
  logo: string
  color: string
  keyLabel: string
  keyPlaceholder: string
  docsUrl?: string
  secondKey?: { id: string; label: string; placeholder: string }
}

interface WebhookDef {
  kind: 'webhook'
  id: string
  name: string
  desc: string
  logo: string
  color: string
}

interface ComingSoonDef {
  kind: 'soon'
  id: string
  name: string
  desc: string
  logo: string
  color: string
}

type ProviderDef = OAuthDef | KeyDef | WebhookDef | ComingSoonDef

interface Category {
  id: string
  label: string
  desc: string
  providers: ProviderDef[]
}

/* ─── Config ────────────────────────────────────────────────────────────── */
const CATEGORIES: Category[] = [
  {
    id: 'ads',
    label: 'פרסום ואנליטיקס',
    desc: 'חיבור לפלטפורמות פרסום ומעקב ביצועים בזמן אמת',
    providers: [
      { kind: 'oauth', id: 'google_ads', name: 'Google Ads', desc: 'ניהול ומעקב קמפיינים בגוגל', logo: '🔵', color: 'from-blue-500 to-indigo-600', oauthPath: 'google-ads-auth' },
      { kind: 'oauth', id: 'ga4',        name: 'Google Analytics 4', desc: 'נתוני אתר, המרות ותנועה', logo: '📊', color: 'from-orange-500 to-yellow-500', oauthPath: 'ga4-auth' },
      { kind: 'oauth', id: 'meta',       name: 'Meta Ads', desc: 'קמפיינים בפייסבוק ואינסטגרם', logo: '🔷', color: 'from-blue-600 to-purple-600', oauthPath: 'meta-auth' },
      { kind: 'oauth', id: 'tiktok',     name: 'TikTok Ads', desc: 'פרסום בטיקטוק', logo: '🎵', color: 'from-pink-500 to-red-500', oauthPath: 'tiktok-auth' },
    ],
  },
  {
    id: 'crm',
    label: 'CRM ומכירות',
    desc: 'חיבור מערכות CRM לסנכרון לידים ולקוחות',
    providers: [
      {
        kind: 'key', id: 'monday', name: 'Monday.com', logo: '📋', color: 'from-red-500 to-pink-600',
        desc: 'סנכרון לידים ומשימות עם Monday.com',
        keyLabel: 'API Token', keyPlaceholder: 'eyJhbGciOiJIUzI1NiJ9...',
        docsUrl: 'https://developer.monday.com/api-reference/docs/authentication',
        secondKey: { id: 'monday_board_id', label: 'Board ID', placeholder: '1234567890' },
      },
      {
        kind: 'key', id: 'pixidigital', name: 'PixiDigital', logo: '💜', color: 'from-purple-500 to-violet-600',
        desc: 'שליחת לידים לCRM של PixiDigital',
        keyLabel: 'API Key', keyPlaceholder: 'pxd_live_...',
        docsUrl: 'https://pixidigital.co.il',
      },
      {
        kind: 'key', id: 'origami', name: 'Origami CRM', logo: '🗂️', color: 'from-teal-500 to-cyan-600',
        desc: 'סנכרון לידים ועסקאות עם Origami',
        keyLabel: 'API Key', keyPlaceholder: 'org_...',
      },
      {
        kind: 'webhook', id: 'webhook_crm', name: 'חיבור אוניברסלי (Webhook)', logo: '🔗', color: 'from-slate-500 to-slate-600',
        desc: 'שלח לידים לכל מערכת שתומכת ב-Webhook — Zapier, Make, n8n ועוד',
      },
    ],
  },
  {
    id: 'research',
    label: 'כלי מחקר לסוכן AI',
    desc: 'מפתחות API שסוכן המחקר ישתמש בהם לאיסוף נתונים בזמן ריצה',
    providers: [
      {
        kind: 'key', id: 'serpapi', name: 'SerpAPI (Google Search)', logo: '🔍', color: 'from-green-500 to-emerald-600',
        desc: 'מאפשר לסוכן לחפש מתחרים ומילות מפתח בגוגל',
        keyLabel: 'API Key', keyPlaceholder: 'abc123def456...',
        docsUrl: 'https://serpapi.com/manage-api-key',
      },
      {
        kind: 'key', id: 'reddit', name: 'Reddit API', logo: '🟠', color: 'from-orange-500 to-red-500',
        desc: 'איסוף אותות כאב ורצון מפורומי Reddit',
        keyLabel: 'Client ID', keyPlaceholder: 'abc123xyz',
        docsUrl: 'https://www.reddit.com/prefs/apps',
        secondKey: { id: 'reddit_secret', label: 'Client Secret', placeholder: 'secret_abc123...' },
      },
      {
        kind: 'key', id: 'meta_ads_library', name: 'Meta Ads Library', logo: '📚', color: 'from-blue-500 to-indigo-500',
        desc: 'ניתוח מודעות מתחרים ממאגר המודעות של Meta',
        keyLabel: 'Access Token', keyPlaceholder: 'EAAxxxxxxxx...',
        docsUrl: 'https://www.facebook.com/ads/library/api',
      },
      {
        kind: 'soon', id: 'semrush', name: 'SEMrush', logo: '📈', color: 'from-orange-400 to-amber-500',
        desc: 'ניתוח SEO, תנועה אורגנית ומחקר מילות מפתח',
      },
    ],
  },
]

const STATUS_CONFIG = {
  active:  { icon: CheckCircle2, label: 'מחובר',  color: 'text-green-400',  bg: 'bg-green-500/15'  },
  revoked: { icon: XCircle,      label: 'נותק',    color: 'text-red-400',    bg: 'bg-red-500/15'    },
  error:   { icon: AlertCircle,  label: 'שגיאה',   color: 'text-yellow-400', bg: 'bg-yellow-500/15' },
}

/* ─── Component ─────────────────────────────────────────────────────────── */
export function Integrations() {
  const { state, dispatch } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const toast = useToast()

  const [syncing, setSyncing]           = useState<string | null>(null)
  const [connecting, setConnecting]     = useState<string | null>(null)
  const [keyModal, setKeyModal]         = useState<KeyDef | WebhookDef | null>(null)
  const [keyValues, setKeyValues]       = useState<Record<string, string>>({})
  const [showKey, setShowKey]           = useState<Record<string, boolean>>({})
  const [savingKey, setSavingKey]       = useState(false)
  const [savedKeys, setSavedKeys]       = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed]       = useState<Record<string, boolean>>({})

  const plan = state.subscription?.plan || 'free'
  const canConnect = plan !== 'free'

  // Load saved API keys from business_profiles.metadata
  useEffect(() => {
    const meta = (state.businessProfile as any)?.metadata || {}
    const saved: Record<string, boolean> = {}
    for (const cat of CATEGORIES) {
      for (const p of cat.providers) {
        if (p.kind === 'key' || p.kind === 'webhook') {
          if (meta[p.id]) saved[p.id] = true
        }
      }
    }
    setSavedKeys(saved)
  }, [state.businessProfile])

  const getOAuthInteg = (id: OAuthProvider) => state.integrations.find(i => i.provider === id)

  const connectOAuth = async (p: OAuthDef) => {
    if (!canConnect) { openUpgrade('אינטגרציות'); return }
    setConnecting(p.id)
    try {
      const res = await api<{ url: string }>('GET', p.oauthPath)
      if (res.url) window.open(res.url, '_blank', 'width=600,height=700')
    } catch { toast('שגיאה בחיבור לפלטפורמה', 'error') }
    finally { setConnecting(null) }
  }

  const disconnectOAuth = async (id: OAuthProvider) => {
    if (!confirm('לנתק אינטגרציה זו?')) return
    try {
      await api('DELETE', `integrations/${id}`)
      setState(dispatch, { integrations: state.integrations.filter(i => i.provider !== id) })
      toast('האינטגרציה נותקה', 'success')
    } catch { toast('שגיאה בניתוק', 'error') }
  }

  const syncOAuth = async (id: OAuthProvider) => {
    setSyncing(id)
    try {
      await api('POST', 'fetch-live-stats', { provider: id })
      toast('נתונים עודכנו', 'success')
    } catch { toast('שגיאה בסנכרון', 'error') }
    finally { setSyncing(null) }
  }

  const openKeyModal = (p: KeyDef | WebhookDef) => {
    const meta = (state.businessProfile as any)?.metadata || {}
    const init: Record<string, string> = {}
    if (p.kind === 'key') {
      init[p.id] = meta[p.id] || ''
      if (p.secondKey) init[p.secondKey.id] = meta[p.secondKey.id] || ''
    } else {
      init[p.id] = meta[p.id] || ''
    }
    setKeyValues(init)
    setKeyModal(p)
  }

  const saveKeyModal = async () => {
    if (!state.user || !keyModal) return
    const primary = keyValues[keyModal.id]?.trim()
    if (!primary) { toast('נא להזין ערך', 'warning'); return }
    setSavingKey(true)
    try {
      const existingMeta = (state.businessProfile as any)?.metadata || {}
      const newMeta: Record<string, string> = { ...existingMeta, [keyModal.id]: primary }
      if (keyModal.kind === 'key' && keyModal.secondKey) {
        const sec = keyValues[keyModal.secondKey.id]?.trim()
        if (sec) newMeta[keyModal.secondKey.id] = sec
      }
      const { error } = await sb.from('business_profiles')
        .upsert({ user_id: state.user.id, ...(state.businessProfile || {}), metadata: newMeta }, { onConflict: 'user_id' })
      if (error) throw error
      setState(dispatch, { businessProfile: { ...(state.businessProfile as any), metadata: newMeta } })
      setSavedKeys(prev => ({ ...prev, [keyModal.id]: true }))
      setKeyModal(null)
      toast('הגדרות נשמרו', 'success')
    } catch { toast('שגיאה בשמירה', 'error') }
    finally { setSavingKey(false) }
  }

  const removeKey = async (id: string) => {
    if (!state.user) return
    const existingMeta = { ...((state.businessProfile as any)?.metadata || {}) }
    delete existingMeta[id]
    try {
      const { error } = await sb.from('business_profiles')
        .upsert({ user_id: state.user.id, ...(state.businessProfile || {}), metadata: existingMeta }, { onConflict: 'user_id' })
      if (error) throw error
      setState(dispatch, { businessProfile: { ...(state.businessProfile as any), metadata: existingMeta } })
      setSavedKeys(prev => { const n = { ...prev }; delete n[id]; return n })
      toast('הוסר', 'success')
    } catch { toast('שגיאה', 'error') }
  }

  const toggleCollapse = (id: string) => setCollapsed(p => ({ ...p, [id]: !p[id] }))

  const inputCls = "w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
          <Plug className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">אינטגרציות</h1>
          <p className="text-slate-400 text-sm">חבר פלטפורמות, CRM וכלי מחקר</p>
        </div>
      </div>

      {!canConnect && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-gradient-to-l from-purple-900/40 to-indigo-900/40 border border-purple-500/30 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-white font-semibold text-sm">שדרג לחיבור פלטפורמות</p>
            <p className="text-slate-400 text-xs mt-0.5">נדרשת חבילת Early Bird לפחות</p>
          </div>
          <button onClick={() => openUpgrade('אינטגרציות')}
            className="bg-gradient-to-l from-purple-600 to-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity flex-shrink-0">
            שדרג עכשיו
          </button>
        </motion.div>
      )}

      {/* Categories */}
      <div className="space-y-6">
        {CATEGORIES.map((cat, ci) => (
          <motion.div key={cat.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: ci * 0.08 }}>
            {/* Category header */}
            <button onClick={() => toggleCollapse(cat.id)}
              className="w-full flex items-center justify-between mb-3 group">
              <div className="text-right">
                <h2 className="text-white font-bold text-base">{cat.label}</h2>
                <p className="text-slate-500 text-xs mt-0.5">{cat.desc}</p>
              </div>
              {collapsed[cat.id]
                ? <ChevronDown className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
                : <ChevronUp   className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />}
            </button>

            {!collapsed[cat.id] && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {cat.providers.map((p, pi) => {
                  /* ── OAuth card ── */
                  if (p.kind === 'oauth') {
                    const integ = getOAuthInteg(p.id)
                    const isActive = integ?.connection_status === 'active'
                    const statusCfg = integ ? STATUS_CONFIG[integ.connection_status] : null
                    const StatusIcon = statusCfg?.icon
                    return (
                      <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pi * 0.05 }}
                        className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center shadow text-xl flex-shrink-0`}>{p.logo}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-white font-bold text-sm">{p.name}</span>
                              {statusCfg && StatusIcon && (
                                <span className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${statusCfg.bg} ${statusCfg.color}`}>
                                  <StatusIcon className="w-2.5 h-2.5" />{statusCfg.label}
                                </span>
                              )}
                            </div>
                            <p className="text-slate-400 text-xs mb-2 leading-relaxed">{p.desc}</p>
                            {integ?.account_name && <p className="text-slate-500 text-[10px] mb-2">חשבון: {integ.account_name}</p>}
                            <div className="flex gap-2">
                              {isActive ? (
                                <>
                                  <button onClick={() => syncOAuth(p.id)} disabled={syncing === p.id}
                                    className="flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
                                    {syncing === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} סנכרן
                                  </button>
                                  <button onClick={() => disconnectOAuth(p.id)}
                                    className="text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 px-3 py-1.5 rounded-lg transition-colors">נתק</button>
                                </>
                              ) : (
                                <button onClick={() => connectOAuth(p)} disabled={connecting === p.id}
                                  className={`flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-lg transition-all ${connecting === p.id ? 'bg-slate-700 text-slate-400' : `bg-gradient-to-l ${p.color} text-white hover:opacity-90`}`}>
                                  {connecting === p.id ? <><Loader2 className="w-3 h-3 animate-spin" /> מחבר...</> : <><ExternalLink className="w-3 h-3" /> חבר</>}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )
                  }

                  /* ── API Key card ── */
                  if (p.kind === 'key') {
                    const isConfigured = !!savedKeys[p.id]
                    return (
                      <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pi * 0.05 }}
                        className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center shadow text-xl flex-shrink-0`}>{p.logo}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-white font-bold text-sm">{p.name}</span>
                              {isConfigured && (
                                <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">
                                  <CheckCircle2 className="w-2.5 h-2.5" /> מוגדר
                                </span>
                              )}
                            </div>
                            <p className="text-slate-400 text-xs mb-2 leading-relaxed">{p.desc}</p>
                            <div className="flex gap-2">
                              <button onClick={() => openKeyModal(p)}
                                className={`flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-lg transition-all bg-gradient-to-l ${p.color} text-white hover:opacity-90`}>
                                <Key className="w-3 h-3" /> {isConfigured ? 'ערוך' : 'הגדר'}
                              </button>
                              {isConfigured && (
                                <button onClick={() => removeKey(p.id)}
                                  className="text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 px-3 py-1.5 rounded-lg transition-colors">הסר</button>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )
                  }

                  /* ── Webhook card ── */
                  if (p.kind === 'webhook') {
                    const isConfigured = !!savedKeys[p.id]
                    return (
                      <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pi * 0.05 }}
                        className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center shadow text-xl flex-shrink-0`}>{p.logo}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-white font-bold text-sm">{p.name}</span>
                              {isConfigured && (
                                <span className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">
                                  <CheckCircle2 className="w-2.5 h-2.5" /> מוגדר
                                </span>
                              )}
                            </div>
                            <p className="text-slate-400 text-xs mb-2 leading-relaxed">{p.desc}</p>
                            <button onClick={() => openKeyModal(p)}
                              className="flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-lg bg-gradient-to-l from-slate-600 to-slate-700 text-white hover:opacity-90 transition-all">
                              <Webhook className="w-3 h-3" /> {isConfigured ? 'ערוך URL' : 'הגדר Webhook'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )
                  }

                  /* ── Coming soon card ── */
                  return (
                    <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: pi * 0.05 }}
                      className="bg-slate-900/40 border border-white/5 rounded-2xl p-4 opacity-60">
                      <div className="flex items-start gap-3">
                        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${p.color} flex items-center justify-center shadow text-xl flex-shrink-0 opacity-60`}>{p.logo}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-white font-bold text-sm">{p.name}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-400">בקרוב</span>
                          </div>
                          <p className="text-slate-500 text-xs leading-relaxed">{p.desc}</p>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* ── Key / Webhook Modal ── */}
      <AnimatePresence>
        {keyModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setKeyModal(null)} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-4">
              <div className="bg-slate-900 border border-white/15 rounded-3xl p-6 w-full max-w-md shadow-2xl" dir="rtl">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{keyModal.logo}</span>
                    <h2 className="text-white font-bold">הגדרת {keyModal.name}</h2>
                  </div>
                  <button onClick={() => setKeyModal(null)} className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  {keyModal.kind === 'webhook' ? (
                    <div>
                      <label className="block text-slate-400 text-xs mb-1">Webhook URL</label>
                      <input
                        type="url"
                        value={keyValues[keyModal.id] || ''}
                        onChange={e => setKeyValues(p => ({ ...p, [keyModal.id]: e.target.value }))}
                        placeholder="https://hooks.zapier.com/hooks/catch/..."
                        className={inputCls}
                      />
                      <p className="text-slate-600 text-xs mt-1.5">לידים חדשים יישלחו אוטומטית לכתובת זו כ-POST request</p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-slate-400 text-xs">{keyModal.keyLabel}</label>
                          {keyModal.docsUrl && (
                            <a href={keyModal.docsUrl} target="_blank" rel="noopener noreferrer"
                              className="text-purple-400 text-xs hover:text-purple-300 flex items-center gap-1">
                              <ExternalLink className="w-3 h-3" /> הוראות
                            </a>
                          )}
                        </div>
                        <div className="relative">
                          <input
                            type={showKey[keyModal.id] ? 'text' : 'password'}
                            value={keyValues[keyModal.id] || ''}
                            onChange={e => setKeyValues(p => ({ ...p, [keyModal.id]: e.target.value }))}
                            placeholder={keyModal.keyPlaceholder}
                            className={inputCls + ' pl-10'}
                          />
                          <button onClick={() => setShowKey(p => ({ ...p, [keyModal.id]: !p[keyModal.id] }))}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors">
                            {showKey[keyModal.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      {keyModal.secondKey && (
                        <div>
                          <label className="block text-slate-400 text-xs mb-1">{keyModal.secondKey.label}</label>
                          <div className="relative">
                            <input
                              type={showKey[keyModal.secondKey.id] ? 'text' : 'password'}
                              value={keyValues[keyModal.secondKey.id] || ''}
                              onChange={e => setKeyValues(p => ({ ...p, [keyModal.secondKey!.id]: e.target.value }))}
                              placeholder={keyModal.secondKey.placeholder}
                              className={inputCls + ' pl-10'}
                            />
                            <button onClick={() => setShowKey(p => ({ ...p, [keyModal.secondKey!.id]: !p[keyModal.secondKey!.id] }))}
                              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors">
                              {showKey[keyModal.secondKey.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                      )}
                      <p className="text-slate-600 text-xs">המפתח נשמר מוצפן ולא יוצג שוב בצורה ברורה</p>
                    </>
                  )}
                </div>

                <div className="flex gap-2 mt-5">
                  <button onClick={() => setKeyModal(null)}
                    className="flex-1 border border-white/10 text-slate-400 hover:text-white py-2.5 rounded-xl text-sm transition-colors hover:bg-white/5">
                    ביטול
                  </button>
                  <button onClick={saveKeyModal} disabled={savingKey}
                    className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-l from-purple-600 to-indigo-600 text-white font-bold py-2.5 rounded-xl text-sm hover:opacity-90 transition-opacity disabled:opacity-50">
                    {savingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                    שמור
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
