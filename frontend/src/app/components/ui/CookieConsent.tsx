import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Cookie } from 'lucide-react'

const KEY = 'cookie_consent_v1'

export function CookieConsent() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(KEY))

  const accept = () => {
    localStorage.setItem(KEY, '1')
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          role="region"
          aria-label="הסכמה לשימוש בעוגיות"
          className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border-t border-white/10 shadow-2xl"
          dir="rtl"
        >
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Cookie className="w-5 h-5 text-purple-400 flex-shrink-0" aria-hidden="true" />
              <p className="text-sm text-slate-300 leading-snug">
                אנו משתמשים בעוגיות לשיפור חוויית השימוש, ניתוח תעבורה ושיווק מותאם אישית.{' '}
                <a
                  href="/privacy"
                  className="text-purple-400 underline underline-offset-2 hover:text-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-slate-900 rounded"
                >
                  מדיניות פרטיות
                </a>
              </p>
            </div>
            <button
              onClick={accept}
              className="flex-shrink-0 px-5 py-2 bg-gradient-to-l from-purple-600 to-blue-600 text-white text-sm font-bold rounded-xl hover:shadow-lg hover:scale-105 transition-all focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-slate-900"
              aria-label="אשר שימוש בעוגיות"
            >
              הבנתי ✓
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
