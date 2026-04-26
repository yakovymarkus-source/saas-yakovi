import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  BarChart3, RefreshCw, TrendingUp, TrendingDown, Minus,
  Loader2, Link2, Sparkles, Play, AlertTriangle, CheckCircle2,
  Info, ChevronDown, ChevronUp, Zap, Users, Globe, FlaskConical,
  Target, ArrowRight, Activity, DollarSign,
} from 'lucide-react'
import { useAppState } from '../state/store'
import { useUpgradeModal } from '../hooks/useUpgradeModal'
import { useToast } from '../hooks/useToast'
import { api } from '../api/client'

// ── Dictionary (mirrors backend _shared/dictionary.js) ─────────────────────────
const DICTIONARY: Record<string, {
  professional_label: string; simple_label: string; simple_summary: string
  likely_causes: string[]; first_action: string
  learn_more: { term: string; definition: string }
}> = {
  low_ctr:            { professional_label:'Low CTR',             simple_label:'מעט מדי אנשים לוחצים על המודעה',    simple_summary:'המודעה לא מצליחה לעצור מספיק אנשים.', likely_causes:['הכותרת חלשה','הקריאייטיב לא בולט','המסר לא ברור'], first_action:'החלף קודם כותרת או קריאייטיב.', learn_more:{term:'CTR',definition:'אחוז האנשים שלחצו על המודעה מתוך כל מי שראו אותה.'} },
  high_cpa:           { professional_label:'High CPA',            simple_label:'כל ליד עולה לך יקר מדי',             simple_summary:'הקמפיין מביא תוצאות, אבל המחיר לכל תוצאה כבד.', likely_causes:['הקהל רחב מדי','המודעה מביאה תנועה חלשה','ההצעה לא ברורה'], first_action:'בדוק קהל, קריאייטיב והצעה לפני הגדלת תקציב.', learn_more:{term:'CPA',definition:'העלות שאתה משלם כדי לקבל פעולה אחת חשובה, כמו ליד או רכישה.'} },
  low_conversion_rate:{ professional_label:'Low Conversion Rate', simple_label:'אנשים נכנסים אבל לא משאירים פרטים',  simple_summary:'יש תנועה, אבל מעט מדי ממנה הופכת לפעולה.', likely_causes:['הדף לא מסביר מהר מספיק','CTA חלש','חוסר התאמה בין מודעה לדף'], first_action:'פשט את הדף, חזק את ההצעה.', learn_more:{term:'Conversion Rate',definition:'האחוז מתוך המבקרים שביצעו את הפעולה שרצית.'} },
  low_roas:           { professional_label:'Low ROAS',            simple_label:'הפרסום לא מחזיר מספיק כסף',         simple_summary:'ההכנסות מהקמפיין נמוכות ביחס להשקעה.', likely_causes:['הצעה חלשה','קהל לא מדויק','המרה נמוכה אחרי הקליק'], first_action:'בדוק קודם את איכות ההצעה והעמוד.', learn_more:{term:'ROAS',definition:'כמה הכנסה נכנסה על כל שקל שהושקע בפרסום.'} },
  audience_mismatch:  { professional_label:'Audience Mismatch',   simple_label:'המודעה מגיעה לאנשים הלא נכונים',   simple_summary:'המסר נחשף לקהל שלא מתאים להצעה.', likely_causes:['הטרגוט רחב מדי','המסר מושך קהל כללי','הקריאייטיב לא מסנן'], first_action:'צמצם או דייק את הטרגוט.', learn_more:{term:'Audience Fit',definition:'כמה הקהל שנחשף למודעה מתאים למוצר שלך.'} },
  landing_page_issue: { professional_label:'Landing Page Issue',  simple_label:'הדף לא משכנע מספיק',               simple_summary:'אנשים מגיעים, אבל לא מבינים למה להישאר.', likely_causes:['כותרת לא ברורה','עמוד עמוס','CTA חלש'], first_action:'פשט כותרת וCTA והסר רעש.', learn_more:{term:'Landing Page',definition:'��עמוד שאליו מגיעים אחרי הלחיצה על המודעה.'} },
  poor_creative:      { professional_label:'Poor Creative',       simple_label:'הקריאייטיב לא מחזיק תשומת לב',     simple_summary:'המודעה לא חזקה מספיק לעצור, לסקרן ולהניע.', likely_causes:['פתיח חלש','ויזואל לא בולט','אין מסר חד'], first_action:'בדוק זווית חדשה למסר הראשי.', learn_more:{term:'Creative',definition:'השילוב של תמונה, וידאו, כותרת וטקסט במודעה.'} },
  weak_offer:         { professional_label:'Weak Offer',          simple_label:'ההצעה לא מספיק חזקה',              simple_summary:'הלקוח לא מרגיש שיש כאן סיבה טובה לפעול.', likely_causes:['אין בידול ברור','אין תועלת חדה','אין דחיפות'], first_action:'חדד ערך מרכזי והצג סיבה לפעול עכשיו.', learn_more:{term:'Offer Strength',definition:'כמה ההצעה שלך ברורה, מושכת ומשכנעת לפעולה.'} },
  low_quality_traffic:{ professional_label:'Low Quality Traffic', simple_label:'מגיעים אנשים, אבל הם לא שווים',     simple_summary:'יש תנועה, אבל היא לא מתנהגת כמו קהל שבא לקנות.', likely_causes:['המסר מושך קהל סקרן ולא בשל','טרגוט רחב','הערוץ מביא כמות לא איכות'], first_action:'בדוק מחדש מסר וטרגוט.', learn_more:{term:'Traffic Quality',definition:'עד כמה התנועה שמגיעה מתאימה למטרה העסקית שלך.'} },
  tracking_uncertainty:{professional_label:'Tracking Uncertainty',simple_label:'הנתונים לא מספיק אמינים',           simple_summary:'קשה לסמוך על המספרים ולקבל החלטה חכמה.', likely_causes:['אירועים לא מוגדרים נכון','חסרים חיבורים בין מערכות','פער בין פלטפורמה לאתר'], first_action:'בדוק שאירועים מרכזיים נמדדים נכון מקצה לקצה.', learn_more:{term:'Tracking',definition:'הדרך שבה המערכת מודדת קליקים, לידים, רכישות ושאר פעולות.'} },
}

// ── Types ───────────────────────────────────────────────────────────────────────
interface UnifiedMetrics {
  impressions?: number; clicks?: number; ctr?: number; cpc?: number
  cpa?: number; roas?: number; conversions?: number; cost?: number
  revenue?: number; engagement?: number; reach?: number; followers?: number
  frequency?: number; sessions?: number
}

interface SocialPlatform {
  platform: string; status: string; followers?: number
  follower_growth_pct?: number | null; engagement_rate?: number
  engagement_status?: string; reach?: number
  paid_vs_organic?: { source: string; note: string; paid_cost?: number }
  benchmarks?: { engagement_benchmark: number; your_rate: number; rating: string }
  alerts: { code: string; severity: string; message: string; action: string }[]
}

interface SocialResult {
  has_social_data: boolean
  platforms: Record<string, SocialPlatform>
  combined?: { total_followers: number; avg_engagement_rate: number; platforms_growing: number; platforms_total: number; overall_social_health: string }
  alerts: { platform: string; code: string; severity: string; message: string; action: string }[]
}

interface FunnelStage { id: string; label: string; from: number; to: number; rate: number; status: string; loss: number }
interface FunnelResult { funnel: { impressions: number; clicks: number; landing: number; leads: number; customers: number }; stages: FunnelStage[]; bottleneck?: { id: string; label: string; rate: number }; summary?: string }

interface InsightItem { id: string; category: string; what: string; why: string; impact: string; confidence: number; priority: string; sentiment: string }
interface AlertItem { platform?: string; code: string; severity: string; message: string; action: string }
interface Recommendation { action: string; why: string; urgency: string; source?: string; effort?: string }
interface Experiment { title?: string; hypothesis?: string; variant?: string; metric?: string; expected_lift?: string | number }
interface KpiItem { key: string; label: string; value: number | null; target?: number | null; status?: string }

interface AnalysisReport {
  id: string; campaign_id?: string
  scores: { overall: number; kpi: number; data: number; roas: number; business: number; verdict: string }
  summary: { score: number; verdict: string; goal: string; top_action: string | null; narrative: string; has_critical: boolean; alert_count: number }
  metrics: UnifiedMetrics
  kpi: { primary: KpiItem; secondary: KpiItem[]; operational: { key: string; value: number | null }[]; goal_score?: number; goal_verdict?: string }
  funnel?: FunnelResult
  social?: SocialResult
  insights: InsightItem[]
  recommendations?: Recommendation[]
  attribution?: { top_channel?: { platform: string }; attribution?: { channels?: { platform: string; clicks: number; conversions: number; cost: number }[] } }
  business?: { unit_economics?: { cac?: number | null; ltv?: number | null; ltv_cac_ratio?: number | null; ltv_cac_health?: string; payback_months?: number | null; cost_per_click?: number | null }; profitability?: { status?: string; note?: string }; scalability?: { assessment?: string } }
  experiments?: Experiment[]
  alerts?: AlertItem[]
  ai_narrative?: string | null
}

// ── Demo data ───────────────────────────────────────────────────────────────────
const DEMO_REPORT: AnalysisReport = {
  id: 'demo', scores: { overall: 68, kpi: 72, data: 80, roas: 65, business: 55, verdict: 'needs_improvement' },
  summary: { score: 68, verdict: 'needs_improvement', goal: 'leads', top_action: 'שפר CTR על ידי בדיקת כותרות חדשות', narrative: 'הקמפיין מביא תנועה סבירה, אך שיעור ההמרה נמוך יחסית לתעשייה. הצעד הקריטי הוא שיפור הדף הממיר.', has_critical: false, alert_count: 2 },
  metrics: { impressions: 48200, clicks: 1250, ctr: 0.026, cpc: 2.8, cpa: 38, roas: 2.4, conversions: 92, cost: 3496, revenue: 8390, engagement: 960, reach: 31400, frequency: 1.5 },
  kpi: { primary: { key: 'cpl', label: 'CPL (עלות ליד)', value: 38, target: 30, status: 'below_target' }, secondary: [{ key: 'conversion_rate', label: 'שיעור המרה', value: 0.073, status: 'ok' }, { key: 'ctr', label: 'CTR', value: 0.026, status: 'ok' }], operational: [{ key: 'impressions', value: 48200 }, { key: 'clicks', value: 1250 }, { key: 'cpc', value: 2.8 }, { key: 'frequency', value: 1.5 }], goal_score: 72, goal_verdict: 'on_track' },
  funnel: { funnel: { impressions: 48200, clicks: 1250, landing: 1100, leads: 92, customers: 18 }, stages: [{ id:'impression_to_click', label:'חשיפה → קליק', from:48200, to:1250, rate:0.026, status:'ok', loss:46950 }, { id:'click_to_landing', label:'קליק → דף נחיתה', from:1250, to:1100, rate:0.88, status:'ok', loss:150 }, { id:'landing_to_lead', label:'דף נחיתה → ליד', from:1100, to:92, rate:0.084, status:'ok', loss:1008 }, { id:'lead_to_customer', label:'ליד → לקוח', from:92, to:18, rate:0.196, status:'good', loss:74 }], bottleneck: { id:'landing_to_lead', label:'דף נחיתה → ליד', rate:0.084 } },
  social: { has_social_data: true, platforms: { meta: { platform:'meta', status:'stable', followers:4820, follower_growth_pct:2.1, engagement_rate:0.031, engagement_status:'good', reach:31400, paid_vs_organic:{ source:'mixed', note:'שילוב תנועה ממומנת ואורגנית' }, benchmarks:{ engagement_benchmark:0.02, your_rate:0.031, rating:'good' }, alerts:[] }, tiktok: { platform:'tiktok', status:'growing', followers:2340, follower_growth_pct:8.4, engagement_rate:0.071, engagement_status:'excellent', reach:18900, paid_vs_organic:{ source:'organic', note:'גידול אורגני' }, benchmarks:{ engagement_benchmark:0.06, your_rate:0.071, rating:'excellent' }, alerts:[] } }, combined: { total_followers: 7160, avg_engagement_rate: 0.051, platforms_growing: 1, platforms_total: 2, overall_social_health: 'healthy' }, alerts: [] },
  insights: [
    { id:'kpi_cpl', category:'kpi', what:'CPL ₪38 — גבוה מהיעד ₪30', why:'ההמרה בדף נמוכה', impact:'חיסכון אפשרי של עד ₪740/חודש עם שיפור', confidence:0.85, priority:'high', sentiment:'negative' },
    { id:'funnel_bottleneck', category:'funnel', what:'דף הנחיתה הוא צוואר הבקבוק', why:'רק 8.4% מהמבקרים משאירים פרטים', impact:'כפל לידים אפשרי עם שיפור הדף', confidence:0.88, priority:'high', sentiment:'negative' },
    { id:'social_tiktok', category:'social', what:'TikTok גדלה ב-8.4%', why:'תוכן אורגני עובד', impact:'ערוץ עלות נמוכה שכדאי להגדיל', confidence:0.75, priority:'medium', sentiment:'positive' },
  ],
  recommendations: [{ action:'שפר CTR על ידי בדיקת כותרות', why:'CTR נמוך מגביל כניסות', urgency:'high', effort:'low' }, { action:'שנה כפתור CTA בדף', why:'שיעור המרה נמוך בשלב הדף', urgency:'high', effort:'low' }, { action:'הגדל תקציב TikTok', why:'מעורבות גבוהה עם ROAS טוב', urgency:'medium', effort:'medium' }],
  attribution: { top_channel: { platform: 'meta' }, attribution: { channels: [{ platform:'meta', clicks:780, conversions:62, cost:2240 }, { platform:'google_ads', clicks:320, conversions:22, cost:896 }, { platform:'tiktok', clicks:150, conversions:8, cost:360 }] } },
  business: { unit_economics: { cac:38, ltv:320, ltv_cac_ratio:8.4, ltv_cac_health:'excellent', payback_months:1.4, cost_per_click:2.8 }, profitability: { status:'profitable', note:'LTV:CAC יחס טוב מאוד' }, scalability: { assessment:'scalable' } },
  experiments: [{ title:'A/B בכותרת הראשית', hypothesis:'כותרת עם שם פרטי תעלה CTR', variant:'גרסה A vs B', metric:'CTR', expected_lift:'15-25%' }, { title:'שינוי צבע כפתור CTA', hypothesis:'כפתור ירוק ימשוך יותר לחיצות', variant:'כחול vs ירוק', metric:'Click-to-Lead Rate', expected_lift:'5-12%' }],
  alerts: [{ code:'high_cpa', severity:'medium', message:'CPA גבוה מהיעד ב-27%', action:'שפר הדף הממיר' }, { code:'low_roas', severity:'low', message:'ROAS 2.4 — מתחת ל-3', action:'בדוק ערך הצעה ועמוד' }],
  ai_narrative: 'הקמפיין פועל ברמה סבירה, אך צוואר הבקבוק העיקרי הוא שלב דף הנחיתה — רק 8.4% ממבקרים הופכים ללידים. שיפור הדף יכול להכפיל את כמות הלידים בלי להגדיל תקציב. TikTok מציגה גידול מרשים ויכולה להפוך לערוץ עיקרי.',
}

const TABS = ['סקירה', 'משפך', 'צמיחה חברתית', 'ערוצים', 'תובנות', 'עסקי', 'ניסויים'] as const
type Tab = typeof TABS[number]

const PIE_COLORS = ['#818cf8','#34d399','#f472b6','#fb923c','#38bdf8','#a78bfa']

const GOAL_OPTIONS = [
  { id:'leads',     label:'לידים'       },
  { id:'sales',     label:'מכירות'      },
  { id:'content',   label:'תוכן ומעורבות'},
  { id:'awareness', label:'מודעות'      },
  { id:'traffic',   label:'תנועה'       },
]

const VERDICT_CLS: Record<string, string> = {
  healthy:           'text-green-400 bg-green-500/20 border-green-500/30',
  needs_improvement: 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30',
  critical:          'text-red-400 bg-red-500/20 border-red-500/30',
}
const VERDICT_LBL: Record<string, string> = { healthy:'תקין', needs_improvement:'טעון שיפור', critical:'קריטי', unknown:'לא ידוע' }

const ENG_STATUS_LBL: Record<string, string> = { excellent:'מצוין', good:'טוב', below_average:'מתחת לממוצע', poor:'נמוך', no_data:'אין נתונים' }
const ENG_STATUS_CLS: Record<string, string> = { excellent:'text-green-400', good:'text-blue-400', below_average:'text-yellow-400', poor:'text-red-400', no_data:'text-slate-500' }
const PLATFORM_LABEL: Record<string, string> = { meta:'Meta', tiktok:'TikTok', instagram:'Instagram', facebook:'Facebook' }
const PLATFORM_GRAD: Record<string, string> = { meta:'from-blue-500 to-purple-600', tiktok:'from-slate-800 to-slate-600', instagram:'from-pink-500 to-purple-600', facebook:'from-blue-600 to-blue-400' }

// ── Dictionary Tooltip ──────────────────────────────────────────────────────────
function DictTooltip({ termKey }: { termKey: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const entry = DICTIONARY[termKey]
  if (!entry) return null

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative inline-block" ref={ref}>
      <button onClick={() => setOpen(v => !v)}
        className="w-4 h-4 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white flex items-center justify-center transition-colors flex-shrink-0"
        aria-label="מידע על המונח">
        <Info className="w-2.5 h-2.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 4 }} transition={{ duration: 0.15 }}
            className="absolute z-50 bottom-full mb-2 right-0 w-72 bg-slate-800 border border-white/10 rounded-xl p-3 shadow-xl text-right">
            <p className="text-white font-bold text-xs mb-0.5">{entry.simple_label}</p>
            <p className="text-slate-400 text-[11px] mb-2">{entry.simple_summary}</p>
            <div className="bg-slate-700/50 rounded-lg px-2.5 py-1.5 mb-2">
              <p className="text-slate-500 text-[10px] font-semibold mb-0.5">סיבות נפוצות:</p>
              {entry.likely_causes.map((c, i) => <p key={i} className="text-slate-300 text-[10px]">· {c}</p>)}
            </div>
            <p className="text-[10px]"><span className="text-emerald-400 font-bold">פעולה ראשונה: </span><span className="text-slate-300">{entry.first_action}</span></p>
            <div className="border-t border-white/10 mt-2 pt-2">
              <p className="text-[10px]"><span className="text-purple-400 font-bold">{entry.learn_more.term}: </span><span className="text-slate-400">{entry.learn_more.definition}</span></p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Small helpers ───────────────────────────────────────────────────────────────
function fmt(val: number | null | undefined, type: 'pct' | 'currency' | 'num' | 'ratio' = 'num'): string {
  if (val == null) return '—'
  if (type === 'pct')      return `${(val * 100).toFixed(1)}%`
  if (type === 'currency') return `₪${val.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`
  if (type === 'ratio')    return `${val.toFixed(1)}x`
  if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`
  if (val >= 1000)    return `${(val / 1000).toFixed(1)}K`
  return val.toFixed(val < 10 ? 1 : 0)
}

function ScorePill({ score, verdict }: { score: number; verdict: string }) {
  const cls = VERDICT_CLS[verdict] ?? VERDICT_CLS.needs_improvement
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border ${cls}`}>
      {score}/100 · {VERDICT_LBL[verdict] ?? verdict}
    </span>
  )
}

function MetricCard({ label, value, sub, termKey, trend }: { label: string; value: string; sub?: string; termKey?: string; trend?: number }) {
  const TrendIcon = trend == null ? Minus : trend > 0 ? TrendingUp : TrendingDown
  const trendCls  = trend == null ? 'text-slate-500' : trend > 0 ? 'text-green-400' : 'text-red-400'
  return (
    <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
      <div className="flex items-center gap-1.5 mb-1">
        <p className="text-slate-400 text-xs">{label}</p>
        {termKey && <DictTooltip termKey={termKey} />}
      </div>
      <p className="text-white text-2xl font-bold">{value}</p>
      {(sub || trend != null) && (
        <div className={`flex items-center gap-1 mt-1 ${trendCls}`}>
          {trend != null && <TrendIcon className="w-3 h-3" />}
          <span className="text-xs">{sub ?? `${Math.abs(trend ?? 0)}%`}</span>
        </div>
      )}
    </div>
  )
}

// ── Tab: Overview ───────────────────────────────────────────────────────────────
function OverviewTab({ report, isDemo }: { report: AnalysisReport; isDemo: boolean }) {
  const m = report.metrics
  return (
    <div className="space-y-5">
      {/* Score + narrative */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <ScorePill score={report.scores.overall} verdict={report.scores.verdict} />
              {isDemo && <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-semibold">Demo</span>}
            </div>
            {report.summary.top_action && (
              <div className="flex items-start gap-2 bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 mt-2">
                <Zap className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-purple-300 text-xs font-bold">הפעולה הדחופה ביותר</p>
                  <p className="text-slate-300 text-xs mt-0.5">{report.summary.top_action}</p>
                </div>
              </div>
            )}
          </div>
          <div className="text-center flex-shrink-0">
            <div className="w-20 h-20 rounded-full border-4 border-white/10 flex items-center justify-center bg-slate-800/50 relative">
              <svg className="absolute inset-0" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="#1e293b" strokeWidth="8" />
                <circle cx="40" cy="40" r="34" fill="none" strokeWidth="8"
                  stroke={report.scores.overall >= 70 ? '#4ade80' : report.scores.overall >= 45 ? '#facc15' : '#f87171'}
                  strokeDasharray={`${report.scores.overall * 2.136} 213.6`}
                  strokeLinecap="round" transform="rotate(-90 40 40)" />
              </svg>
              <span className="text-white text-xl font-black relative z-10">{report.scores.overall}</span>
            </div>
          </div>
        </div>
        {report.ai_narrative && (
          <p className="text-slate-300 text-sm leading-relaxed border-t border-white/10 pt-3 mt-3">{report.ai_narrative}</p>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="חשיפות"     value={fmt(m.impressions)}              />
        <MetricCard label="קליקים"     value={fmt(m.clicks)}                   />
        <MetricCard label="CTR"        value={fmt(m.ctr,'pct')}  termKey="low_ctr"     />
        <MetricCard label="עלות ליד"   value={fmt(m.cpa,'currency')} termKey="high_cpa" />
        <MetricCard label="המרות"      value={fmt(m.conversions)}              />
        <MetricCard label="הוצאה"      value={fmt(m.cost,'currency')}          />
        <MetricCard label="ROAS"       value={fmt(m.roas,'ratio')} termKey="low_roas"  />
        <MetricCard label="הכנסה"      value={fmt(m.revenue,'currency')}       />
      </div>

      {/* Primary KPI */}
      {report.kpi?.primary && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <p className="text-slate-400 text-xs mb-3 font-semibold">KPI מרכזי למטרה: {report.summary.goal}</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-bold">{report.kpi.primary.label}</p>
              <p className="text-slate-300 text-2xl font-black mt-0.5">{fmt(report.kpi.primary.value, report.kpi.primary.key === 'cpl' || report.kpi.primary.key === 'cpa' ? 'currency' : report.kpi.primary.key === 'roas' ? 'ratio' : report.kpi.primary.key === 'conversion_rate' || report.kpi.primary.key === 'ctr' || report.kpi.primary.key === 'engagement_rate' ? 'pct' : 'num')}</p>
            </div>
            {report.kpi.primary.target != null && (
              <div className="text-right">
                <p className="text-slate-500 text-xs">יעד</p>
                <p className="text-slate-300 font-bold">{fmt(report.kpi.primary.target, 'currency')}</p>
                <p className={`text-xs font-semibold mt-0.5 ${report.kpi.primary.status === 'on_target' || report.kpi.primary.status === 'excellent' ? 'text-green-400' : 'text-yellow-400'}`}>
                  {report.kpi.primary.status === 'on_target' ? '✓ עומד ביעד' : '↑ מתחת ליעד'}
                </p>
              </div>
            )}
          </div>
          {/* Secondary KPIs */}
          {report.kpi.secondary?.length > 0 && (
            <div className="flex gap-4 mt-4 border-t border-white/10 pt-3">
              {report.kpi.secondary.map(kpi => (
                <div key={kpi.key}>
                  <p className="text-slate-500 text-xs">{kpi.label}</p>
                  <p className="text-white font-bold text-sm">{fmt(kpi.value, kpi.key === 'conversion_rate' || kpi.key === 'ctr' ? 'pct' : 'num')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Alerts */}
      {(report.alerts?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {report.alerts!.map((a, i) => (
            <div key={i} className={`flex items-start gap-3 rounded-xl p-3 border ${a.severity === 'high' || a.severity === 'critical' ? 'bg-red-900/20 border-red-500/30' : 'bg-yellow-900/20 border-yellow-500/20'}`}>
              <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${a.severity === 'high' || a.severity === 'critical' ? 'text-red-400' : 'text-yellow-400'}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-white text-xs font-semibold">{a.message}</p>
                  {DICTIONARY[a.code] && <DictTooltip termKey={a.code} />}
                </div>
                <p className="text-slate-400 text-xs">{a.action}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tab: Funnel ─────────────────────────────────────────────────────────────────
function FunnelTab({ report }: { report: AnalysisReport }) {
  const funnel = report.funnel
  if (!funnel) return <EmptySection text="אין נתוני משפך" />

  const stages = funnel.stages ?? []
  const bottleneckId = funnel.bottleneck?.id

  const STATUS_CLS: Record<string, string> = { good: 'bg-green-500/20 text-green-400 border-green-500/30', ok: 'bg-blue-500/20 text-blue-400 border-blue-500/30', weak: 'bg-red-500/20 text-red-400 border-red-500/30', no_data: 'bg-slate-700 text-slate-500 border-slate-600' }
  const STATUS_LBL: Record<string, string> = { good:'טוב', ok:'סביר', weak:'חלש', no_data:'אין נתונים' }

  const funnelNums = funnel.funnel
  const maxVal = Math.max(funnelNums.impressions, 1)
  const steps = [
    { label:'חשיפות',       val: funnelNums.impressions, icon:'👁' },
    { label:'קליקים',       val: funnelNums.clicks,      icon:'🖱' },
    { label:'דף נחיתה',     val: funnelNums.landing,     icon:'📄' },
    { label:'לידים',        val: funnelNums.leads,        icon:'✉️' },
    { label:'לקוחות',       val: funnelNums.customers,   icon:'🤝' },
  ]

  return (
    <div className="space-y-5">
      {/* Visual funnel */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
        <h3 className="text-white font-semibold text-sm mb-4">משפך שיווקי</h3>
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-400">{s.icon} {s.label}</span>
                <span className="text-white font-bold">{fmt(s.val)}</span>
              </div>
              <div className="bg-slate-800 rounded-full h-5 overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: `${(s.val / maxVal) * 100}%` }}
                  transition={{ delay: i * 0.1, duration: 0.6 }}
                  className={`h-full rounded-full ${['bg-blue-500','bg-indigo-500','bg-purple-500','bg-pink-500','bg-green-500'][i]}`} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stage breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {stages.map(stage => {
          const isBottleneck = stage.id === bottleneckId
          const termKey = stage.id === 'impression_to_click' ? 'low_ctr' : stage.id === 'landing_to_lead' ? 'low_conversion_rate' : undefined
          return (
            <div key={stage.id} className={`rounded-2xl p-4 border ${isBottleneck ? 'bg-red-900/20 border-red-500/30' : 'bg-slate-900/60 border-white/10'}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <p className="text-white text-sm font-semibold">{stage.label}</p>
                  {termKey && <DictTooltip termKey={termKey} />}
                  {isBottleneck && <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full font-bold">צוואר בקבוק</span>}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_CLS[stage.status] ?? STATUS_CLS.no_data}`}>
                  {STATUS_LBL[stage.status] ?? stage.status}
                </span>
              </div>
              <p className="text-slate-300 text-2xl font-black">{(stage.rate * 100).toFixed(1)}%</p>
              <p className="text-slate-500 text-xs mt-0.5">{fmt(stage.to)} מתוך {fmt(stage.from)} · אבדו {fmt(stage.loss)}</p>
            </div>
          )
        })}
      </div>

      {funnel.bottleneck && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-300 font-bold text-sm">צוואר הבקבוק: {funnel.bottleneck.label}</p>
            <p className="text-red-400/80 text-xs mt-0.5">שיפור שלב זה ישפיע הכי הרבה על התוצאות הכלליות</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Social Growth ──────────────────────────────────────────────────────────
function SocialTab({ report }: { report: AnalysisReport }) {
  const social = report.social
  if (!social?.has_social_data) return <EmptySection text="אין נתוני מדיה חברתית — חבר Meta או TikTok" />

  const platforms = Object.values(social.platforms).filter(p => p.status !== 'no_data')

  return (
    <div className="space-y-5">
      {/* Combined summary */}
      {social.combined && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="סה״כ עוקבים"     value={fmt(social.combined.total_followers)} />
          <MetricCard label="מעורבות ממוצעת"   value={fmt(social.combined.avg_engagement_rate,'pct')} />
          <MetricCard label="פלטפורמות בצמיחה" value={`${social.combined.platforms_growing}/${social.combined.platforms_total}`} />
          <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
            <p className="text-slate-400 text-xs mb-1">בריאות כללית</p>
            <p className={`text-lg font-bold ${social.combined.overall_social_health === 'healthy' ? 'text-green-400' : 'text-yellow-400'}`}>
              {social.combined.overall_social_health === 'healthy' ? '✓ בריא' : '⚠ טעון שיפור'}
            </p>
          </div>
        </div>
      )}

      {/* Per-platform cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {platforms.map(p => {
          const growthPositive = (p.follower_growth_pct ?? 0) >= 0
          const gradient = PLATFORM_GRAD[p.platform] ?? 'from-slate-600 to-slate-700'
          return (
            <div key={p.platform} className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
              {/* Platform header */}
              <div className={`bg-gradient-to-l ${gradient} p-4 flex items-center justify-between`}>
                <div>
                  <p className="text-white font-bold">{PLATFORM_LABEL[p.platform] ?? p.platform}</p>
                  <p className="text-white/70 text-xs">{fmt(p.followers)} עוקבים</p>
                </div>
                <div className="text-right">
                  {p.follower_growth_pct != null && (
                    <p className={`text-lg font-black ${growthPositive ? 'text-green-300' : 'text-red-300'}`}>
                      {growthPositive ? '+' : ''}{p.follower_growth_pct}%
                    </p>
                  )}
                  <p className="text-white/60 text-xs">גידול עוקבים</p>
                </div>
              </div>

              {/* Stats */}
              <div className="p-4 space-y-3">
                {/* Engagement rate vs benchmark */}
                {p.benchmarks && (
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400">מעורבות</span>
                        <DictTooltip termKey={p.benchmarks.rating === 'poor' ? 'poor_creative' : 'low_ctr'} />
                      </div>
                      <span className={`font-bold ${ENG_STATUS_CLS[p.benchmarks.rating]}`}>
                        {ENG_STATUS_LBL[p.benchmarks.rating]} · {fmt(p.engagement_rate,'pct')}
                      </span>
                    </div>
                    <div className="bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div className="relative h-full">
                        <motion.div initial={{ width:0 }} animate={{ width: `${Math.min(100,(p.engagement_rate??0)/0.1*100)}%` }}
                          className={`h-full rounded-full ${p.benchmarks.rating === 'excellent' ? 'bg-green-500' : p.benchmarks.rating === 'good' ? 'bg-blue-500' : p.benchmarks.rating === 'below_average' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                      </div>
                    </div>
                    <p className="text-slate-600 text-[10px] mt-0.5">Benchmark: {fmt(p.benchmarks.engagement_benchmark,'pct')}</p>
                  </div>
                )}

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">טווח הגעה</span>
                  <span className="text-white font-semibold">{fmt(p.reach)}</span>
                </div>

                {p.paid_vs_organic && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">מקור צמיחה</span>
                    <span className="text-slate-300">{p.paid_vs_organic.note}</span>
                  </div>
                )}

                {p.alerts?.map((a, i) => (
                  <div key={i} className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-500/20 rounded-lg p-2">
                    <AlertTriangle className="w-3 h-3 text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-yellow-300 text-[10px] font-semibold">{a.message}</p>
                      <p className="text-slate-400 text-[10px]">{a.action}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Tab: Attribution ────────────────────────────────────────────────────────────
function AttributionTab({ report }: { report: AnalysisReport }) {
  const channels = report.attribution?.attribution?.channels ?? []
  const totalConv = channels.reduce((s, c) => s + c.conversions, 0) || 1
  const totalCost = channels.reduce((s, c) => s + c.cost, 0) || 1

  if (!channels.length) return <EmptySection text="אין נתוני ייחוס — חבר אינטגרציות" />

  const pieData = channels.map(c => ({ name: PLATFORM_LABEL[c.platform] ?? c.platform, value: c.conversions }))

  return (
    <div className="space-y-5">
      {report.attribution?.top_channel && (
        <div className="bg-gradient-to-l from-indigo-900/40 to-purple-900/40 border border-indigo-500/30 rounded-2xl p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-indigo-400" />
          <div>
            <p className="text-white font-semibold text-sm">ערוץ מוביל: {PLATFORM_LABEL[report.attribution.top_channel.platform] ?? report.attribution.top_channel.platform}</p>
            <p className="text-slate-400 text-xs">מביא את הכי הרבה המרות מתוך כל הפלטפורמות</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <h3 className="text-white font-semibold text-sm mb-4">חלוקת המרות לפי ערוץ</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" paddingAngle={3}>
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background:'#1e293b', border:'1px solid #334155', borderRadius:12, color:'#f1f5f9' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 mt-2">
            {pieData.map((c, i) => (
              <div key={c.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i] }} /><span className="text-slate-400">{c.name}</span></div>
                <span className="text-white font-semibold">{((c.value / totalConv) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <h3 className="text-white font-semibold text-sm mb-4">עלות לפי ערוץ</h3>
          <div className="space-y-3">
            {channels.map((c, i) => {
              const cpa = c.conversions > 0 ? c.cost / c.conversions : null
              return (
                <div key={c.platform} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PIE_COLORS[i] }} />
                  <div className="flex-1">
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-slate-400">{PLATFORM_LABEL[c.platform] ?? c.platform}</span>
                      <span className="text-white font-bold">{fmt(c.cost,'currency')}</span>
                    </div>
                    <div className="bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width:`${(c.cost/totalCost)*100}%`, background: PIE_COLORS[i] }} />
                    </div>
                    <p className="text-slate-500 text-[10px] mt-0.5">{c.conversions} המרות {cpa ? `· CPA ${fmt(cpa,'currency')}` : ''}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Insights ───────────────────────────────────────────────────────────────
function InsightsTab({ report }: { report: AnalysisReport }) {
  const [expandedRec, setExpandedRec] = useState<number | null>(null)
  const recs = report.recommendations ?? []
  const insights = report.insights ?? []

  const PRIORITY_CLS: Record<string, string> = { high:'bg-red-500/20 text-red-400', medium:'bg-yellow-500/20 text-yellow-400', low:'bg-blue-500/20 text-blue-400' }
  const SENTIMENT_CLS: Record<string, string> = { positive:'border-green-500/30 bg-green-900/10', negative:'border-red-500/20 bg-red-900/10', neutral:'border-white/10 bg-slate-900/60' }

  return (
    <div className="space-y-5">
      {/* Insights */}
      {insights.length > 0 && (
        <div>
          <h3 className="text-white font-semibold text-sm mb-3">תובנות AI</h3>
          <div className="space-y-2">
            {insights.map(ins => (
              <div key={ins.id} className={`rounded-2xl p-4 border ${SENTIMENT_CLS[ins.sentiment] ?? SENTIMENT_CLS.neutral}`}>
                <div className="flex items-start justify-between gap-3 mb-1">
                  <p className="text-white text-sm font-semibold">{ins.what}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${PRIORITY_CLS[ins.priority] ?? 'bg-slate-700 text-slate-400'}`}>
                    {ins.priority === 'high' ? 'דחוף' : ins.priority === 'medium' ? 'חשוב' : 'אופציונלי'}
                  </span>
                </div>
                <p className="text-slate-400 text-xs"><span className="text-slate-500">למה: </span>{ins.why}</p>
                <p className="text-slate-400 text-xs mt-0.5"><span className="text-slate-500">השפעה: </span>{ins.impact}</p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex-1 bg-slate-700 rounded-full h-1 overflow-hidden">
                    <div className="h-full bg-purple-500 rounded-full" style={{ width:`${ins.confidence * 100}%` }} />
                  </div>
                  <span className="text-slate-500 text-[10px]">{(ins.confidence * 100).toFixed(0)}% ביטחון</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recs.length > 0 && (
        <div>
          <h3 className="text-white font-semibold text-sm mb-3">המלצות לפעולה</h3>
          <div className="space-y-2">
            {recs.map((r, i) => {
              const isOpen = expandedRec === i
              const dictKey = Object.entries(DICTIONARY).find(([, v]) => r.action?.toLowerCase().includes(v.learn_more.term.toLowerCase()))?.[0]
              return (
                <div key={i} className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
                  <button onClick={() => setExpandedRec(isOpen ? null : i)}
                    className="w-full flex items-center gap-3 p-3.5 text-right hover:bg-white/5 transition-colors">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-black ${i === 0 ? 'bg-red-500/20 text-red-400' : i === 1 ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'}`}>
                      {i+1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-white text-sm font-medium truncate">{r.action}</p>
                        {dictKey && <DictTooltip termKey={dictKey} />}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.urgency && <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${r.urgency === 'high' ? 'bg-red-500/20 text-red-400' : r.urgency === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>{r.urgency === 'high' ? 'דחוף' : r.urgency === 'medium' ? 'חשוב' : 'אופציונלי'}</span>}
                      {isOpen ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                    </div>
                  </button>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div initial={{ height:0 }} animate={{ height:'auto' }} exit={{ height:0 }} className="overflow-hidden">
                        <div className="px-4 pb-3 pt-0 text-slate-400 text-xs space-y-1 border-t border-white/5">
                          <p><span className="text-slate-500">למה: </span>{r.why}</p>
                          {r.effort && <p><span className="text-slate-500">מאמץ: </span>{r.effort === 'low' ? 'קל' : r.effort === 'medium' ? 'בינוני' : 'מורכב'}</p>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Glossary */}
      <div>
        <h3 className="text-white font-semibold text-sm mb-3">מילון מושגים</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.entries(DICTIONARY).map(([key, entry]) => (
            <div key={key} className="bg-slate-900/60 border border-white/10 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-0.5">
                <p className="text-slate-300 text-xs font-bold">{entry.learn_more.term}</p>
                <DictTooltip termKey={key} />
              </div>
              <p className="text-slate-500 text-[11px] leading-relaxed">{entry.simple_label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Tab: Business ───────────────────────────────────────────────────────────────
function BusinessTab({ report }: { report: AnalysisReport }) {
  const biz = report.business
  if (!biz) return <EmptySection text="אין נתוני יחידת כלכלה" />
  const ue = biz.unit_economics

  const HEALTH_CLS: Record<string, string> = { excellent:'text-green-400', good:'text-blue-400', break_even:'text-yellow-400', negative:'text-red-400', no_data:'text-slate-500' }
  const HEALTH_LBL: Record<string, string> = { excellent:'מצוין (3:1+)', good:'טוב (2:1)', break_even:'איזון', negative:'הפסד', no_data:'—' }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetricCard label="CAC (עלות רכישת לקוח)"   value={fmt(ue?.cac,'currency')}       termKey="high_cpa" />
        <MetricCard label="LTV (ערך לקוח לאורך זמן)" value={fmt(ue?.ltv,'currency')}       />
        <MetricCard label="ROAS"                       value={fmt(report.metrics.roas,'ratio')} termKey="low_roas" />
        <MetricCard label="CPC (עלות לקליק)"          value={fmt(ue?.cost_per_click,'currency')} />
        {ue?.payback_months != null && <MetricCard label="חודשי החזר השקעה" value={`${ue.payback_months} חודשים`} />}
      </div>

      {/* LTV:CAC ratio */}
      {ue?.ltv_cac_ratio != null && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-slate-400 text-xs mb-0.5">יחס LTV:CAC</p>
              <p className={`text-3xl font-black ${HEALTH_CLS[ue.ltv_cac_health ?? 'no_data']}`}>{ue.ltv_cac_ratio.toFixed(1)}:1</p>
            </div>
            <div className="text-right">
              <p className={`font-bold ${HEALTH_CLS[ue.ltv_cac_health ?? 'no_data']}`}>{HEALTH_LBL[ue.ltv_cac_health ?? 'no_data']}</p>
              <p className="text-slate-500 text-xs mt-0.5">יחס 3:1 = הזהב</p>
            </div>
          </div>
          <div className="bg-slate-800 rounded-full h-3 overflow-hidden">
            <motion.div initial={{ width:0 }} animate={{ width:`${Math.min(100,(ue.ltv_cac_ratio/5)*100)}%` }}
              className={`h-full rounded-full ${ue.ltv_cac_health === 'excellent' ? 'bg-green-500' : ue.ltv_cac_health === 'good' ? 'bg-blue-500' : ue.ltv_cac_health === 'break_even' ? 'bg-yellow-500' : 'bg-red-500'}`} />
          </div>
        </div>
      )}

      {biz.profitability?.note && (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-4 flex items-start gap-3">
          <DollarSign className="w-5 h-5 text-green-400 flex-shrink-0" />
          <div>
            <p className="text-white font-semibold text-sm">רווחיות: {biz.profitability.status === 'profitable' ? 'רווחי' : biz.profitability.status}</p>
            <p className="text-slate-400 text-xs mt-0.5">{biz.profitability.note}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Experiments ────────────────────────────────────────────────────────────
function ExperimentsTab({ report }: { report: AnalysisReport }) {
  const exps = report.experiments ?? []
  if (!exps.length) return <EmptySection text="אין הצעות ניסויים" />

  return (
    <div className="space-y-3">
      <p className="text-slate-400 text-xs">ניסויים A/B מוצעים על ידי מנוע הניתוח</p>
      {exps.map((e, i) => (
        <div key={i} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <FlaskConical className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white font-semibold text-sm">{e.title ?? `ניסוי ${i+1}`}</p>
              {e.hypothesis && <p className="text-slate-400 text-xs mt-1">{e.hypothesis}</p>}
              <div className="flex flex-wrap gap-3 mt-2 text-xs">
                {e.metric && <span className="bg-slate-700/60 text-slate-300 px-2 py-0.5 rounded-lg"><span className="text-slate-500">מדד: </span>{e.metric}</span>}
                {e.expected_lift && <span className="bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-lg">צפוי: {e.expected_lift}</span>}
                {e.variant && <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-lg">{e.variant}</span>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptySection({ text }: { text: string }) {
  return (
    <div className="text-center py-16">
      <Activity className="w-10 h-10 text-slate-600 mx-auto mb-3" />
      <p className="text-slate-500 text-sm">{text}</p>
    </div>
  )
}

// ── Run Analysis Panel ──────────────────────────────────────────────────────────
function RunAnalysisPanel({ onStart }: { onStart: (campaignId: string, goal: string, query: string) => void }) {
  const { state } = useAppState()
  const [campaignId, setCampaignId] = useState(state.campaigns[0]?.id ?? '')
  const [goal, setGoal] = useState('leads')
  const [query, setQuery] = useState('')

  return (
    <div className="bg-slate-900/60 border border-purple-500/20 rounded-2xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Target className="w-4 h-4 text-purple-400" />
        <p className="text-white font-semibold text-sm">הפעל ניתוח על קמפיין</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-slate-400 text-xs block mb-1">קמפיין</label>
          <select value={campaignId} onChange={e => setCampaignId(e.target.value)}
            className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
            {state.campaigns.length === 0 && <option value="">אין קמפיינים</option>}
            {state.campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-slate-400 text-xs block mb-1">מטרת הקמפיין</label>
          <select value={goal} onChange={e => setGoal(e.target.value)}
            className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 text-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
            {GOAL_OPTIONS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-slate-400 text-xs block mb-1">שאלה ספציפית (אופציונלי)</label>
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="למה CTR ירד? מה לשפר?"
            className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2 text-slate-300 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
        </div>
      </div>
      <button onClick={() => onStart(campaignId, goal, query)} disabled={!campaignId}
        className="flex items-center gap-2 bg-gradient-to-l from-purple-600 to-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-40">
        <Play className="w-4 h-4" /> הפעל ניתוח
      </button>
    </div>
  )
}

// ── Progress panel ─────────────────────────────────────────────────────────────
function ProgressPanel({ steps, progress }: { steps: { step_key: string; message: string }[]; progress: number }) {
  const lastSteps = steps.slice(-4)
  return (
    <div className="bg-slate-900/60 border border-purple-500/20 rounded-2xl p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
          <p className="text-white font-semibold text-sm">מנתח... {progress}%</p>
        </div>
      </div>
      <div className="bg-slate-800 rounded-full h-2 mb-4 overflow-hidden">
        <motion.div animate={{ width:`${progress}%` }} className="h-full bg-gradient-to-l from-purple-500 to-indigo-500 rounded-full" />
      </div>
      <div className="space-y-1">
        {lastSteps.map((s, i) => (
          <p key={i} className={`text-xs ${i === lastSteps.length-1 ? 'text-purple-300' : 'text-slate-500'}`}>
            {i === lastSteps.length-1 ? '▶ ' : '✓ '}{s.message}
          </p>
        ))}
      </div>
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────────────────
export function Analytics() {
  const { state } = useAppState()
  const { open: openUpgrade } = useUpgradeModal()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('סקירה')
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [isDemo, setIsDemo] = useState(true)
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<{ step_key: string; message: string }[]>([])
  const [progress, setProgress] = useState(0)
  const [jobId, setJobId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sinceRef = useRef(0)

  const plan = state.subscription?.plan || 'free'
  const isPaid = plan !== 'free'
  const hasIntegrations = state.integrations.some(i => i.connection_status === 'active')

  // Load last report from history on mount
  useEffect(() => {
    if (!state.user?.id) return
    // Start with demo data; a real report can be loaded from history
    setReport(DEMO_REPORT)
    setIsDemo(true)
  }, [state.user?.id])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
  }, [])

  const pollStatus = useCallback(async (jId: string) => {
    try {
      const res = await api<{ status: string; reportId?: string; progress: number; steps?: { step_key: string; message: string }[]; errorMessage?: string }>('GET', `analysis-status?jobId=${jId}&since=${sinceRef.current}`)
      if (res.steps?.length) {
        setSteps(prev => [...prev, ...res.steps!])
        sinceRef.current += res.steps!.length
      }
      setProgress(res.progress)

      if (res.status === 'completed' && res.reportId) {
        const rData = await api<{ report: AnalysisReport }>('GET', `analysis-report?reportId=${res.reportId}`)
        setReport(rData.report)
        setIsDemo(false)
        setRunning(false)
        setJobId(null)
        toast('ניתוח הושלם!', 'success')
      } else if (res.status === 'failed') {
        toast(res.errorMessage ?? 'הניתוח נכשל', 'error')
        setRunning(false); setJobId(null)
      } else {
        pollRef.current = setTimeout(() => pollStatus(jId), 3000)
      }
    } catch {
      pollRef.current = setTimeout(() => pollStatus(jId), 4000)
    }
  }, [toast])

  useEffect(() => {
    if (jobId) pollStatus(jobId)
    return stopPolling
  }, [jobId, pollStatus, stopPolling])

  const startAnalysis = async (campaignId: string, goal: string, query: string) => {
    if (!isPaid) { openUpgrade('ניתוח מתקדם'); return }
    if (!campaignId) { toast('בחר קמפיין', 'warning'); return }
    setRunning(true); setSteps([]); setProgress(0); sinceRef.current = 0
    try {
      const res = await api<{ jobId: string }>('POST', 'analysis-start', { campaignId, goal, targets: {}, query })
      setJobId(res.jobId)
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'שגיאה', 'error')
      setRunning(false)
    }
  }

  const displayReport = report ?? DEMO_REPORT
  const displayIsDemo = isDemo || !report

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
            <p className="text-slate-400 text-sm">{hasIntegrations && isPaid ? 'נתונים חיים מהפלטפורמות' : 'ניתוח ביצועים'}</p>
          </div>
        </div>
        {!running && (
          <button onClick={() => { setReport(DEMO_REPORT); setIsDemo(true) }}
            className="flex items-center gap-2 text-slate-400 hover:text-white border border-white/10 px-3 py-2 rounded-xl text-sm transition-colors hover:bg-white/5">
            <RefreshCw className="w-4 h-4" /> אפס
          </button>
        )}
      </div>

      {/* Upgrade / Connect banner */}
      {!isPaid && (
        <motion.div initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }}
          className="mb-5 bg-gradient-to-l from-green-900/30 to-teal-900/30 border border-green-500/25 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-green-400 flex-shrink-0" />
            <div>
              <p className="text-white font-semibold text-sm">רוצה לראות נתוני אמת על הקמפיין שלך?</p>
              <p className="text-slate-400 text-xs mt-0.5">שדרג לחבילה בתשלום לניתוח חי עם AI מ-Google, Meta ו-TikTok</p>
            </div>
          </div>
          <button onClick={() => openUpgrade('תובנות מתקדמות')}
            className="bg-gradient-to-l from-green-500 to-teal-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity flex-shrink-0">
            עשה מנוי
          </button>
        </motion.div>
      )}
      {isPaid && !hasIntegrations && (
        <motion.div initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }}
          className="mb-5 bg-gradient-to-l from-blue-900/30 to-cyan-900/30 border border-blue-500/25 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link2 className="w-5 h-5 text-blue-400 flex-shrink-0" />
            <div>
              <p className="text-white font-semibold text-sm">חבר אינטגרציות לנתונים חיים</p>
              <p className="text-slate-400 text-xs mt-0.5">כרגע מוצגים נתוני דמו — חבר חשבונות פרסום לנתוני אמת</p>
            </div>
          </div>
          <button onClick={() => { window.location.hash = '#integrations' }}
            className="bg-gradient-to-l from-blue-500 to-cyan-600 text-white text-xs font-bold px-4 py-2 rounded-xl hover:opacity-90 transition-opacity flex-shrink-0 flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" /> חבר אינטגרציות
          </button>
        </motion.div>
      )}

      {/* Run panel */}
      {isPaid && !running && <RunAnalysisPanel onStart={startAnalysis} />}

      {/* Progress */}
      {running && <ProgressPanel steps={steps} progress={progress} />}

      {/* Tabs */}
      <div className="flex bg-slate-900/60 border border-white/10 rounded-2xl p-1 mb-6 overflow-x-auto gap-1">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 px-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap min-w-fit ${tab === t ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }} transition={{ duration:0.15 }}>
          {tab === 'סקירה'           && <OverviewTab     report={displayReport} isDemo={displayIsDemo} />}
          {tab === 'משפך'            && <FunnelTab        report={displayReport} />}
          {tab === 'צמיחה חברתית'   && <SocialTab        report={displayReport} />}
          {tab === 'ערוצים'          && <AttributionTab   report={displayReport} />}
          {tab === 'תובנות'          && <InsightsTab      report={displayReport} />}
          {tab === 'עסקי'            && <BusinessTab      report={displayReport} />}
          {tab === 'ניסויים'         && <ExperimentsTab   report={displayReport} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
