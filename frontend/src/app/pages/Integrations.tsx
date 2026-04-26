import { useState } from 'react'
import { motion } from 'motion/react'
import {
  Plug, CheckCircle2, XCircle, AlertCircle,
  RefreshCw, ExternalLink, Loader2,
} from 'lucide-react'
import { useAppState, setState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { useToast } from '../hooks/useToast'
import { api } from '../api/client'
import type { Integration } from '../state/types'

interface ProviderDef {
  id: Integration['provider']
  name: string
  description: string
  logo: string
  color: string
  oauthPath: string
}

const PROVIDERS: ProviderDef[] = [
  {
    id: 'google_ads',
    name: 'Google Ads',
    description: 'ניהול ומעקב קמפיינים בגוגל אדס',
    logo: '🔵',
    color: 'from-blue-500 to-indigo-600',
    oauthPath: 'google-ads-auth',
  },
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    description: 'נתוני אתר, המרות ותנועה',
    logo: '📊',
    color: 'from-orange-500 to-yellow-500',
    oauthPath: 'ga4-auth',
  },
  {
    id: 'meta',
    name: 'Meta Ads',
    description: 'קמפיינים בפייסבוק ואינסטגרם',
    logo: '🔷',
    color: 'from-blue-600 to-purple-600',
    oauthPath: 'meta-auth',
  },
  {
    id: 'tiktok',
    name: 'TikTok Ads',
    description: 'פרסום בטיקטוק',
    logo: '🎵',
    color: 'from-pink-500 to-red-500',
    oauthPath: 'tiktok-auth',
  },
]

const STATUS_CONFIG = {
  active: { icon: CheckCircle2, label: 'מחובר', color: 'text-green-400', bg: 'bg-green-500/20' },
  revoked: { icon: XCircle, label: 'התנתק', color: 'text-red-400', bg: 'bg-red-500/20' },
  error: { icon: AlertCircle, label: 'שגיאה', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
}

export function Integrations() {
  const { state, dispatch } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const toast = useToast()
  const [syncing, setSyncing] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)

  const plan = state.subscription?.plan || 'free'
  const canConnect = plan !== 'free'

  const getIntegration = (id: Integration['provider']) =>
    state.integrations.find(i => i.provider === id)

  const connect = async (provider: ProviderDef) => {
    if (!canConnect) { openUpgrade('אינטגרציות'); return }
    setConnecting(provider.id)
    try {
      const res = await api<{ url: string }>('GET', provider.oauthPath)
      if (res.url) window.open(res.url, '_blank', 'width=600,height=700')
    } catch (err: unknown) {
      toast('שגיאה בחיבור לפלטפורמה', 'error')
    } finally {
      setConnecting(null)
    }
  }

  const disconnect = async (provider: Integration['provider']) => {
    if (!confirm('לנתק אינטגרציה זו?')) return
    try {
      await api('DELETE', `integrations/${provider}`)
      setState(dispatch, {
        integrations: state.integrations.filter(i => i.provider !== provider),
      })
      toast('האינטגרציה נותקה', 'success')
    } catch {
      toast('שגיאה בניתוק', 'error')
    }
  }

  const sync = async (provider: Integration['provider']) => {
    setSyncing(provider)
    try {
      await api('POST', 'fetch-live-stats', { provider })
      toast('נתונים עודכנו', 'success')
    } catch {
      toast('שגיאה בסנכרון', 'error')
    } finally {
      setSyncing(null)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
            <Plug className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">אינטגרציות</h1>
            <p className="text-slate-400 text-sm">חבר פלטפורמות פרסום לנתוני חיים</p>
          </div>
        </div>
      </div>

      {!canConnect && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-gradient-to-l from-purple-900/40 to-indigo-900/40 border border-purple-500/30 rounded-2xl p-4 flex items-center justify-between"
        >
          <div>
            <p className="text-white font-semibold text-sm">שדרג לחיבור פלטפורמות</p>
            <p className="text-slate-400 text-xs mt-0.5">נדרשת חבילת Early Bird לפחות</p>
          </div>
          <button
            onClick={() => openUpgrade('אינטגרציות')}
            className="bg-gradient-to-l from-purple-600 to-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity"
          >
            שדרג עכשיו
          </button>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PROVIDERS.map((provider, i) => {
          const integration = getIntegration(provider.id)
          const isConnected = integration?.connection_status === 'active'
          const status = integration ? STATUS_CONFIG[integration.connection_status] : null
          const StatusIcon = status?.icon

          return (
            <motion.div
              key={provider.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className="bg-slate-900/60 border border-white/10 rounded-2xl p-5"
            >
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${provider.color} flex items-center justify-center shadow-lg text-2xl flex-shrink-0`}>
                  {provider.logo}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-white font-bold text-sm">{provider.name}</h3>
                    {status && StatusIcon && (
                      <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
                        <StatusIcon className="w-3 h-3" />
                        {status.label}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400 text-xs leading-relaxed mb-3">{provider.description}</p>

                  {integration && (
                    <div className="text-xs text-slate-500 mb-3">
                      {integration.account_name && <span className="text-slate-400">חשבון: {integration.account_name} · </span>}
                      {integration.last_sync_at && <span>סנכרון אחרון: {new Date(integration.last_sync_at).toLocaleDateString('he-IL')}</span>}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {isConnected ? (
                      <>
                        <button
                          onClick={() => sync(provider.id)}
                          disabled={syncing === provider.id}
                          className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          {syncing === provider.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <RefreshCw className="w-3.5 h-3.5" />}
                          סנכרן
                        </button>
                        <button
                          onClick={() => disconnect(provider.id)}
                          className="text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          נתק
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => connect(provider)}
                        disabled={connecting === provider.id}
                        className={`flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-lg transition-all ${
                          connecting === provider.id
                            ? 'bg-slate-700 text-slate-400'
                            : `bg-gradient-to-l ${provider.color} text-white hover:opacity-90`
                        }`}
                      >
                        {connecting === provider.id
                          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> מחבר...</>
                          : <><ExternalLink className="w-3.5 h-3.5" /> חבר</>}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
