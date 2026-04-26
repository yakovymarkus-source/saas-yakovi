import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { BarChart3, RefreshCw, TrendingUp, TrendingDown, Minus, Loader2, Link2, Sparkles } from 'lucide-react'
import { useAppState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { api } from '../api/client'

const TABS = ['סקירה', 'ביצועים', 'קהל', 'המרות', 'השוואה'] as const
type Tab = typeof TABS[number]

const PIE_COLORS = ['#818cf8', '#34d399', '#f472b6', '#fb923c', '#38bdf8']

function Stat({ label, value, change }: { label: string; value: string; change?: number }) {
  const Icon = change == null ? Minus : change > 0 ? TrendingUp : TrendingDown
  const color = change == null ? 'text-slate-400' : change > 0 ? 'text-green-400' : 'text-red-400'
  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
      <p className="text-slate-400 text-xs mb-1">{label}</p>
      <p className="text-white text-2xl font-bold">{value}</p>
      {change != null && (
        <div className={`flex items-center gap-1 mt-1 ${color}`}>
          <Icon className="w-3 h-3" />
          <span className="text-xs">{Math.abs(change)}% vs. חודש שעבר</span>
        </div>
      )}
    </div>
  )
}

function UpgradeBanner({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="mb-6 bg-gradient-to-l from-green-900/30 to-teal-900/30 border border-green-500/25 rounded-2xl p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-green-400" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm">רוצה לראות נתוני אמת על הקמפיין שלך?</p>
          <p className="text-slate-400 text-xs mt-0.5">שדרג לחבילה בתשלום לקבלת נתונים חיים מ-Google, Meta ו-TikTok</p>
        </div>
      </div>
      <button onClick={onUpgrade}
        className="bg-gradient-to-l from-green-500 to-teal-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity flex-shrink-0">
        עשה מנוי
      </button>
    </motion.div>
  )
}

function ConnectBanner({ onNavigate }: { onNavigate: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="mb-6 bg-gradient-to-l from-blue-900/30 to-cyan-900/30 border border-blue-500/25 rounded-2xl p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
          <Link2 className="w-4 h-4 text-blue-400" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm">חבר אינטגרציות לנתונים חיים</p>
          <p className="text-slate-400 text-xs mt-0.5">כרגע מוצגים נתוני דמו — חבר את חשבונות הפרסום שלך לנתוני אמת</p>
        </div>
      </div>
      <button onClick={onNavigate}
        className="bg-gradient-to-l from-blue-500 to-cyan-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity flex-shrink-0 flex items-center gap-1.5">
        <Link2 className="w-3.5 h-3.5" /> חבר אינטגרציות
      </button>
    </motion.div>
  )
}

export function Analytics() {
  const { state } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const [tab, setTab] = useState<Tab>('סקירה')
  const [loading, setLoading] = useState(false)
  const [liveData, setLiveData] = useState<Record<string, unknown> | null>(null)

  const plan = state.subscription?.plan || 'free'
  const isPaid = plan !== 'free'
  const hasIntegrations = state.integrations.some(i => i.connection_status === 'active')

  useEffect(() => {
    if (!isPaid || !hasIntegrations) return
    setLoading(true)
    api<Record<string, unknown>>('GET', 'fetch-live-stats')
      .then(d => setLiveData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isPaid, hasIntegrations])

  const navigateToIntegrations = () => {
    window.location.hash = '#integrations'
  }

  // Demo data
  const areaData = [
    { name: 'ינו', clicks: 1200, leads: 80,  conversions: 12 },
    { name: 'פבר', clicks: 1900, leads: 120, conversions: 18 },
    { name: 'מרץ', clicks: 1600, leads: 95,  conversions: 14 },
    { name: 'אפר', clicks: 2400, leads: 160, conversions: 24 },
    { name: 'מאי', clicks: 2100, leads: 140, conversions: 21 },
    { name: 'יונ', clicks: 2800, leads: 190, conversions: 31 },
  ]
  const channelData = [
    { name: 'גוגל',     value: 42 },
    { name: 'פייסבוק',  value: 28 },
    { name: 'אורגני',   value: 18 },
    { name: 'מייל',     value: 8  },
    { name: 'אחר',      value: 4  },
  ]
  const barData = [
    { name: 'מודעה 1', ctr: 4.2, cpc: 1.8 },
    { name: 'מודעה 2', ctr: 3.1, cpc: 2.4 },
    { name: 'מודעה 3', ctr: 5.8, cpc: 1.2 },
    { name: 'מודעה 4', ctr: 2.9, cpc: 3.1 },
    { name: 'מודעה 5', ctr: 6.4, cpc: 0.9 },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center shadow-lg">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">תובנות</h1>
            <p className="text-slate-400 text-sm">
              {hasIntegrations && isPaid ? 'נתונים חיים מהפלטפורמות' : 'ניתוח ביצועים — נתוני דמו'}
            </p>
          </div>
        </div>
        <button onClick={() => { if (isPaid && hasIntegrations) { setLoading(true); api('GET','fetch-live-stats').then(d => setLiveData(d as Record<string,unknown>)).catch(()=>{}).finally(()=>setLoading(false)) } }}
          className="flex items-center gap-2 text-slate-400 hover:text-white border border-white/10 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-white/5">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          רענן
        </button>
      </div>

      {/* Smart banner */}
      {!isPaid && <UpgradeBanner onUpgrade={() => openUpgrade('תובנות מתקדמות')} />}
      {isPaid && !hasIntegrations && <ConnectBanner onNavigate={navigateToIntegrations} />}

      {/* Tabs */}
      <div className="flex bg-slate-900/60 border border-white/10 rounded-2xl p-1 mb-6 overflow-x-auto gap-1">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 px-3 rounded-xl text-sm font-semibold transition-all whitespace-nowrap min-w-fit ${
              tab === t ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="קליקים"   value="14,892" change={18} />
        <Stat label="לידים"    value="784"    change={12} />
        <Stat label="המרות"    value="98"     change={-4} />
        <Stat label="עלות לליד" value="₪23"  change={-8} />
      </div>

      {/* Charts */}
      {tab === 'סקירה' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-slate-900/60 border border-white/10 rounded-2xl p-4">
            <h3 className="text-white font-semibold text-sm mb-4">מגמות לאורך זמן</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={areaData}>
                <defs>
                  <linearGradient id="gClicks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#818cf8" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#34d399" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, color: '#f1f5f9' }} />
                <Area type="monotone" dataKey="clicks" stroke="#818cf8" fill="url(#gClicks)" strokeWidth={2} name="קליקים" />
                <Area type="monotone" dataKey="leads"  stroke="#34d399" fill="url(#gLeads)"  strokeWidth={2} name="לידים" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
            <h3 className="text-white font-semibold text-sm mb-4">חלוקת ערוצים</h3>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={channelData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                  {channelData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, color: '#f1f5f9' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {channelData.map((c, i) => (
                <div key={c.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i] }} />
                    <span className="text-slate-400">{c.name}</span>
                  </div>
                  <span className="text-white font-semibold">{c.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'ביצועים' && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <h3 className="text-white font-semibold text-sm mb-4">ביצועי מודעות — CTR vs. CPC</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, color: '#f1f5f9' }} />
              <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
              <Bar dataKey="ctr" name="CTR %" fill="#818cf8" radius={[6, 6, 0, 0]} />
              <Bar dataKey="cpc" name="CPC ₪" fill="#34d399" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {(tab === 'קהל' || tab === 'המרות' || tab === 'השוואה') && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <h3 className="text-white font-semibold text-sm mb-4">
            {tab === 'קהל' ? 'קהל — גיל ומגדר' : tab === 'המרות' ? 'משפך המרות' : 'השוואת קמפיינים'}
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={areaData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, color: '#f1f5f9' }} />
              <Line type="monotone" dataKey="conversions" stroke="#f472b6" strokeWidth={2} dot={{ fill: '#f472b6', r: 4 }} name="המרות" />
              <Line type="monotone" dataKey="leads"       stroke="#818cf8" strokeWidth={2} dot={{ fill: '#818cf8', r: 4 }} name="לידים" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Live data (paid + integrations) */}
      {liveData && (
        <div className="mt-4 bg-slate-900/60 border border-green-500/20 rounded-2xl p-4">
          <p className="text-green-400 text-xs font-semibold mb-2">נתונים חיים מהפלטפורמות</p>
          <pre className="text-slate-400 text-xs overflow-auto max-h-40">{JSON.stringify(liveData, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
