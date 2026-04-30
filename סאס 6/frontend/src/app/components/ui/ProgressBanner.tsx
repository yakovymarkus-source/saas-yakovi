import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'

interface Stage {
  icon: string
  label: string
  pct: number
  delay: number
}

const STAGES: Stage[] = [
  { icon: '🔌', label: 'מתחבר לפלטפורמה...',   pct: 10, delay: 0     },
  { icon: '📊', label: 'מאחזר נתונים חיים...',  pct: 30, delay: 6000  },
  { icon: '🤖', label: 'מנתח עם AI...',          pct: 55, delay: 18000 },
  { icon: '💡', label: 'מייצר המלצות...',        pct: 78, delay: 35000 },
  { icon: '✍️', label: 'מסיים ומארגן...',        pct: 92, delay: 52000 },
]

interface Props {
  campaignName: string | null
  onDismiss: () => void
}

export function ProgressBanner({ campaignName, onDismiss }: Props) {
  const [stageIdx, setStageIdx] = useState(0)
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!campaignName) return
    setStageIdx(0); setDone(false); setFailed(false)
    const timers = STAGES.slice(1).map((s, i) =>
      setTimeout(() => setStageIdx(i + 1), s.delay)
    )
    return () => timers.forEach(clearTimeout)
  }, [campaignName])

  const stage = STAGES[stageIdx]

  return (
    <AnimatePresence>
      {campaignName && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9997] bg-white rounded-2xl shadow-2xl border-2 border-indigo-400 p-4 min-w-[320px] max-w-[90vw]"
          style={{ direction: 'rtl' }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="font-bold text-slate-800 text-sm">
              {done ? '✅' : failed ? '❌' : '🔍'} מנתח: {campaignName}
            </div>
            <button onClick={onDismiss} className="text-slate-400 hover:text-slate-600 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="text-indigo-600 text-xs font-semibold mb-2">
            {done ? 'הניתוח הסתיים בהצלחה!' : failed ? 'הניתוח נכשל' : `${stage.icon} ${stage.label}`}
          </div>
          <div className="bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-l from-indigo-500 to-purple-500 rounded-full"
              animate={{ width: done ? '100%' : failed ? '30%' : `${stage.pct}%` }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
