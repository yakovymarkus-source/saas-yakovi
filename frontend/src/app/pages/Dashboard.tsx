import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { TrendingUp, Users, MousePointerClick, DollarSign, Sparkles, Lightbulb, Zap, Plus } from 'lucide-react'
import { useAppState, setState } from '../state/store'
import { api, sb } from '../api/client'
import { getPlanLabel, getPlanLimits } from '../state/types'
import { useToast } from '../hooks/useToast'
import { useUpgradeModal } from '../hooks/useUpgradeModal'

interface BarrelData {
  score: number
  barrel: { label: string; cta: string; key: string }
  ctr_score: number
  scroll_score: number
  form_score: number
  conversion_score: number
}

function ScoreBar({ label, value, desc }: { label: string; value: number; desc: string }) {
  const color = value >= 70 ? '#22c55e' : value >= 45 ? '#f59e0b' : '#ef4444'
  return (
    <div className="mb-3" title={desc}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm font-bold" style={{ color }}>{value}/100</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
    </div>
  )
}

export function Dashboard() {
  const { state, dispatch } = useAppState()
  const toast = useToast()
  const { showUpgrade } = useUpgradeModal()
  const [barrel, setBarrel] = useState<BarrelData | null>(null)
  const [liveStats, setLiveStats] = useState<Record<string, { total: Record<string, number>; cached: boolean }>>({})

  const plan      = state.subscription?.plan || 'free'
  const planLabel = getPlanLabel(plan)
  const planLimits = getPlanLimits(plan)
  const connectedInteg = (state.integrations || []).filter(i => i.connection_status === 'active')
  const businessName = state.businessProfile?.business_name || state.profile?.name || 'משתמש'

  // Load barrel effect for first campaign
  useEffect(() => {
    const camp = state.campaigns?.[0]
    if (!camp) return
    api<BarrelData>('GET', `campaign-score?campaignId=${camp.id}`)
      .then(data => setBarrel(data))
      .catch(() => {})
  }, [state.campaigns])

  // Load live stats
  useEffect(() => {
    if (!connectedInteg.length) return
    const providers = { google_ads: 'Google Ads', ga4: 'GA4', meta: 'Meta Ads' }
    connectedInteg.forEach(async integ => {
      try {
        const { data: cache } = await sb.from('api_cache')
          .select('payload,updated_at')
          .eq('user_id', state.user!.id)
          .eq('source', integ.provider)
          .maybeSingle()
        if (cache?.payload) {
          const metrics = Array.isArray(cache.payload.metrics) ? cache.payload.metrics : []
          const total = metrics.reduce((acc: Record<string, number>, m: Record<string, number>) => ({
            clicks:      (acc.clicks || 0)      + (m.clicks || 0),
            impressions: (acc.impressions || 0) + (m.impressions || 0),
            spend:       (acc.spend || 0)       + (m.spend || m.costMicros / 1e6 || 0),
            conversions: (acc.conversions || 0) + (m.conversions || 0),
          }), {})
          setLiveStats(prev => ({ ...prev, [integ.provider]: { total, cached: true } }))
        }
      } catch {}
    })
  }, [connectedInteg, state.user])

  // Total clicks from live stats
  const totalClicks = Object.values(liveStats).reduce((s, v) => s + (v.total.clicks || 0), 0)
  const totalConv   = Object.values(liveStats).reduce((s, v) => s + (v.total.conversions || 0), 0)

  const kpis = [
    {
      label: 'לידים היום',
      value: '—',
      icon: Users,
      gradient: 'from-blue-500 via-cyan-500 to-teal-500',
      change: '+0',
      page: 'leads',
    },
    {
      label: 'קמפיינים',
      value: state.campaigns.length > 0 ? String(state.campaigns.length) : '0',
      icon: Sparkles,
      gradient: 'from-purple-500 via-fuchsia-500 to-pink-500',
      change: '',
      page: 'agents',
    },
    {
      label: 'קליקים (כולל)',
      value: totalClicks > 0 ? totalClicks.toLocaleString() : '—',
      icon: MousePointerClick,
      gradient: 'from-amber-500 via-orange-500 to-red-500',
      change: '',
      page: 'analytics',
    },
    {
      label: 'המרות',
      value: totalConv > 0 ? totalConv.toLocaleString() : '—',
      icon: TrendingUp,
      gradient: 'from-green-500 via-emerald-500 to-teal-500',
      change: '',
      page: 'analytics',
    },
  ]

  const handleNewCampaign = () => {
    if (planLimits.campaignLimit === 0) {
      showUpgrade({ feature: 'יצירת קמפיינים', requiredPlan: 'Early Bird' }); return
    }
    setState(dispatch, { currentPage: 'agents' })
    window.location.hash = 'agents'
  }

  const ONBOARDING_STEPS = [
    { done: !!state.businessProfile?.business_name, label: 'הגדר פרופיל עסקי', page: 'settings' },
    { done: connectedInteg.length > 0,              label: 'חבר אינטגרציה',    page: 'integrations' },
    { done: state.campaigns.length > 0,             label: 'צור קמפיין ראשון', page: 'agents' },
  ]
  const onboardingDone = ONBOARDING_STEPS.filter(s => s.done).length
  const showOnboarding = onboardingDone < 3

  return (
    <div className="flex-1 bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 overflow-auto" dir="rtl">
      <div className="max-w-7xl mx-auto p-8">

        {/* Header */}
        <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-l from-purple-600 via-blue-600 to-cyan-600 bg-clip-text text-transparent mb-1">
              שלום, {businessName}! 👋
            </h1>
            <p className="text-gray-500 font-light">
              {showOnboarding ? 'בוא נגדיר את המערכת שלך' : 'סקירת ביצועים שיווקיים מונעת AI'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {connectedInteg.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                מערכת פעילה
              </span>
            )}
            <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-gradient-to-l from-purple-100 to-blue-100 text-purple-700 border border-purple-200">
              {planLabel}
            </span>
          </div>
        </div>

        {/* Upgrade promo for free */}
        {plan === 'free' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 bg-gradient-to-l from-purple-600 to-blue-600 rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap"
          >
            <div className="flex items-center gap-3 text-white">
              <Zap className="w-5 h-5 flex-shrink-0" />
              <span className="font-semibold text-sm">שדרג ל-Early Bird ב-₪10 לצמיתות — קמפיינים, אינטגרציות, כל הכלים</span>
            </div>
            <button
              onClick={() => showUpgrade({ feature: 'כל הפיצ\'רים', requiredPlan: 'Early Bird' })}
              className="bg-white text-purple-700 font-bold text-sm px-5 py-2 rounded-xl hover:shadow-lg transition-all hover:scale-105 flex-shrink-0"
            >
              שדרג עכשיו →
            </button>
          </motion.div>
        )}

        {/* Onboarding widget */}
        {showOnboarding && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 bg-white/80 backdrop-blur-xl rounded-3xl p-6 shadow-lg border border-white/20"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">🎯 תחילת דרך</h2>
              <span className="text-sm font-semibold text-purple-600 bg-purple-50 px-3 py-1 rounded-full">
                {onboardingDone}/3 שלבים
              </span>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full mb-4 overflow-hidden">
              <motion.div
                animate={{ width: `${(onboardingDone / 3) * 100}%` }}
                className="h-full bg-gradient-to-l from-purple-600 to-blue-600 rounded-full"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {ONBOARDING_STEPS.map((step, i) => (
                <button
                  key={i}
                  onClick={() => { setState(dispatch, { currentPage: step.page }); window.location.hash = step.page }}
                  className={`p-3 rounded-2xl border-2 text-right transition-all hover:shadow-md ${
                    step.done
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-purple-200 bg-purple-50 text-purple-700 hover:border-purple-400'
                  }`}
                >
                  <div className="text-lg mb-1">{step.done ? '✅' : `${i + 1}.`}</div>
                  <div className="text-xs font-semibold">{step.label}</div>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
          {kpis.map((kpi, index) => {
            const Icon = kpi.icon
            return (
              <motion.div
                key={kpi.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.07 }}
                onClick={() => { setState(dispatch, { currentPage: kpi.page }); window.location.hash = kpi.page }}
                className="bg-white/80 backdrop-blur-xl rounded-3xl p-6 shadow-lg border border-white/20 hover:shadow-2xl transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${kpi.gradient} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div className="text-3xl font-bold text-gray-900 mb-1">{kpi.value}</div>
                <div className="text-sm text-gray-500 font-medium">{kpi.label}</div>
              </motion.div>
            )
          })}
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-3 gap-5 mb-5">

          {/* Barrel Effect / Score */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="col-span-2 bg-white/80 backdrop-blur-xl rounded-3xl p-7 shadow-lg border border-white/20"
          >
            {barrel ? (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <TrendingUp className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">ניקוד קמפיין</h2>
                    <p className="text-sm text-gray-500">ניתוח Barrel Effect</p>
                  </div>
                  <div className="mr-auto text-4xl font-bold bg-gradient-to-l from-purple-600 to-blue-600 bg-clip-text text-transparent">
                    {barrel.score}
                  </div>
                </div>
                <ScoreBar label="CTR — שיעור הקלקה" value={barrel.ctr_score} desc="כמה אנשים לחצו על המודעה מתוך כל מי שראה אותה" />
                <ScoreBar label="גלילה בדף" value={barrel.scroll_score} desc="כמה אנשים גללו יותר ממחצית הדף" />
                <ScoreBar label="השלמת טופס" value={barrel.form_score} desc="מתוך מי שהתחיל — כמה סיים למלא" />
                <ScoreBar label="המרה" value={barrel.conversion_score} desc="כמה גולשים ביצעו פעולה (השאירו פרטים / קנו)" />
                {barrel.barrel && (
                  <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
                    <div className="text-sm font-bold text-amber-800 mb-1">⚠️ חוליה חלשה: {barrel.barrel.label}</div>
                    <div className="text-xs text-amber-700">{barrel.barrel.cta}</div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">המלצות AI</h2>
                </div>
                <div className="space-y-3 opacity-50">
                  {['שפר את ה-CTR על מודעה #1', 'הגדל תקציב לקמפיין עם ROAS גבוה', 'בדוק ירידה בחשיפות ב-Meta'].map(r => (
                    <div key={r} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-3">
                      <Lightbulb className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span className="text-sm text-gray-600">{r}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 text-center mt-4">
                  {state.campaigns.length === 0 ? 'צור קמפיין ראשון כדי לקבל ניתוח' : 'הרץ ניתוח קמפיין כדי לקבל המלצות'}
                </p>
              </>
            )}
          </motion.div>

          {/* Agents Status */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white/80 backdrop-blur-xl rounded-3xl p-7 shadow-lg border border-white/20"
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">סטטוס סוכנים</h2>
              <button
                onClick={() => { setState(dispatch, { currentPage: 'agents' }); window.location.hash = 'agents' }}
                className="text-xs text-purple-600 font-semibold hover:text-purple-800 transition-colors"
              >
                הפעל →
              </button>
            </div>
            <div className="space-y-3">
              {[
                { name: 'מחקר שוק',       color: 'from-blue-500 to-cyan-500'    },
                { name: 'אסטרטגיה',        color: 'from-purple-500 to-pink-500'  },
                { name: 'קופירייטינג',     color: 'from-amber-500 to-orange-500' },
                { name: 'ניתוח נתונים',    color: 'from-green-500 to-emerald-500'},
                { name: 'בדיקת איכות',     color: 'from-rose-500 to-red-500'     },
                { name: 'אורקסטרטור',      color: 'from-indigo-500 to-blue-500'  },
              ].map((agent, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full bg-gradient-to-br ${agent.color}`} />
                    <span className="text-sm text-gray-700 font-medium">{agent.name}</span>
                  </div>
                  <span className="text-xs text-gray-400">מוכן</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setState(dispatch, { currentPage: 'agents' }); window.location.hash = 'agents' }}
              className="w-full mt-5 py-3 bg-gradient-to-l from-purple-600 to-blue-600 text-white rounded-2xl text-sm font-bold hover:shadow-xl transition-all hover:scale-[1.02]"
            >
              הפעל סוכנים
            </button>
          </motion.div>
        </div>

        {/* Campaigns + New */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-white/80 backdrop-blur-xl rounded-3xl p-7 shadow-lg border border-white/20"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-bold text-gray-900">קמפיינים</h2>
            <button
              onClick={handleNewCampaign}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-l from-purple-600 to-blue-600 text-white rounded-xl text-sm font-bold hover:shadow-lg transition-all hover:scale-105"
            >
              <Plus className="w-4 h-4" /> קמפיין חדש
            </button>
          </div>
          {state.campaigns.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <div className="text-4xl mb-3">📢</div>
              <p className="font-medium">אין קמפיינים עדיין</p>
              <p className="text-sm mt-1">צור קמפיין ראשון כדי להתחיל</p>
            </div>
          ) : (
            <div className="space-y-2">
              {state.campaigns.slice(0, 5).map(c => (
                <div key={c.id} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-gray-900" />
                    <span className="font-medium text-gray-800 text-sm">{c.name}</span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(c.created_at).toLocaleDateString('he-IL')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>

      </div>
    </div>
  )
}
