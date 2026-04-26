import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { BookOpen, Play, Loader2, Search, ExternalLink } from 'lucide-react'
import { sb } from '../api/client'

interface Tutorial {
  id: string
  title: string
  description: string | null
  youtube_url: string
  category: string | null
  duration_minutes: number | null
  order_index: number
}

const FALLBACK_TUTORIALS: Tutorial[] = [
  {
    id: 'fb-1', title: 'התחלה מהירה — הגדרת פרופיל עסקי',
    description: 'כיצד להגדיר את הפרופיל העסקי שלך, להוסיף מידע על העסק ולחבר ערוצי שיווק.',
    youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    category: 'התחלה', duration_minutes: 4, order_index: 1,
  },
  {
    id: 'fb-2', title: 'יצירת קמפיין ראשון',
    description: 'מדריך שלב-אחר-שלב ליצירת קמפיין שיווקי, הגדרת יעדים וניתוח ביצועים.',
    youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    category: 'קמפיינים', duration_minutes: 7, order_index: 2,
  },
  {
    id: 'fb-3', title: 'שימוש בסוכני AI',
    description: 'כיצד להפעיל את סוכן המחקר, סוכן האסטרטגיה ואת האורקסטרטור לקמפיין מלא.',
    youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    category: 'סוכני AI', duration_minutes: 10, order_index: 3,
  },
  {
    id: 'fb-4', title: 'חיבור אינטגרציות — Meta, Google, TikTok',
    description: 'הוראות חיבור לפלטפורמות הפרסום המובילות וצפייה בנתוני קמפיין בזמן אמת.',
    youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    category: 'אינטגרציות', duration_minutes: 8, order_index: 4,
  },
  {
    id: 'fb-5', title: 'ניהול לידים — CRM בסיסי',
    description: 'כיצד לנהל לידים, לעדכן סטטוס, להוסיף הערות ולעקוב אחרי תהליך המכירה.',
    youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    category: 'CRM', duration_minutes: 6, order_index: 5,
  },
  {
    id: 'fb-6', title: 'תובנות ואנליטיקס — קריאת הנתונים',
    description: 'הסבר מפורט על גרפי הביצועים, KPIs ואיך לפרש את הנתונים לטובת החלטות שיווק.',
    youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    category: 'אנליטיקס', duration_minutes: 9, order_index: 6,
  },
]

function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

const CAT_COLORS: Record<string, string> = {
  'התחלה':       'bg-emerald-500/20 text-emerald-400',
  'קמפיינים':    'bg-violet-500/20 text-violet-400',
  'סוכני AI':    'bg-cyan-500/20 text-cyan-400',
  'אינטגרציות':  'bg-blue-500/20 text-blue-400',
  'CRM':         'bg-pink-500/20 text-pink-400',
  'אנליטיקס':   'bg-amber-500/20 text-amber-400',
  'כללי':        'bg-slate-500/20 text-slate-400',
}

export function Tutorials() {
  const [tutorials, setTutorials] = useState<Tutorial[]>(FALLBACK_TUTORIALS)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [category, setCategory] = useState<string>('all')

  useEffect(() => {
    loadTutorials()
  }, [])

  const loadTutorials = async () => {
    setLoading(true)
    try {
      const { data, error } = await sb
        .from('tutorials')
        .select('*')
        .eq('published', true)
        .order('order_index', { ascending: true })
      if (!error && data && data.length > 0) {
        setTutorials(data as Tutorial[])
      }
      // If error or empty — keep fallback tutorials
    } catch {
      // Keep fallback
    } finally {
      setLoading(false)
    }
  }

  const categories = ['all', ...Array.from(new Set(tutorials.map(t => t.category || 'כללי')))]

  const filtered = tutorials.filter(t => {
    if (category !== 'all' && (t.category || 'כללי') !== category) return false
    if (search) {
      const s = search.toLowerCase()
      return t.title.toLowerCase().includes(s) || (t.description || '').toLowerCase().includes(s)
    }
    return true
  })

  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shadow-lg">
          <BookOpen className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">הדרכות</h1>
          <p className="text-slate-400 text-sm">למד להשתמש במערכת בצורה מיטבית</p>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute top-2.5 right-3 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="חפש הדרכה..."
            className="w-full bg-slate-900/60 border border-white/10 rounded-xl pr-9 px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {categories.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                category === cat
                  ? 'bg-orange-500 text-white'
                  : 'bg-slate-900/60 border border-white/10 text-slate-400 hover:text-white'
              }`}>
              {cat === 'all' ? 'הכל' : cat}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-orange-400 animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t, i) => {
            const ytId = getYouTubeId(t.youtube_url)
            const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : null
            const isActive = active === t.id
            const catLabel = t.category || 'כללי'
            const catCls = CAT_COLORS[catLabel] ?? CAT_COLORS['כללי']

            return (
              <motion.div key={t.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden hover:border-orange-500/40 transition-colors">
                {/* Thumbnail / Player */}
                <div className="relative aspect-video bg-slate-800 cursor-pointer"
                  onClick={() => setActive(isActive ? null : t.id)}>
                  {isActive && ytId ? (
                    <iframe src={`https://www.youtube.com/embed/${ytId}?autoplay=1`}
                      allow="autoplay; fullscreen" className="absolute inset-0 w-full h-full" title={t.title} />
                  ) : (
                    <>
                      {thumb
                        ? <img src={thumb} alt={t.title} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center bg-slate-800">
                            <BookOpen className="w-10 h-10 text-slate-600" />
                          </div>
                      }
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center hover:bg-white/30 transition-colors">
                          <Play className="w-5 h-5 text-white fill-white mr-[-2px]" />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Info */}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="text-white font-semibold text-sm leading-snug">{t.title}</h3>
                    <a href={t.youtube_url} target="_blank" rel="noopener noreferrer"
                      className="text-slate-500 hover:text-orange-400 flex-shrink-0 transition-colors"
                      onClick={e => e.stopPropagation()}>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  {t.description && (
                    <p className="text-slate-500 text-xs leading-relaxed line-clamp-2">{t.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${catCls}`}>{catLabel}</span>
                    {t.duration_minutes && (
                      <span className="text-[10px] text-slate-500">{t.duration_minutes} דק׳</span>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
