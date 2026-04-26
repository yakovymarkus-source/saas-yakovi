import React, { createContext, useContext, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, X, Zap } from 'lucide-react'

interface UpgradeOptions {
  feature: string
  requiredPlan?: string
}

interface UpgradeCtx {
  showUpgrade: (opts: UpgradeOptions) => void
}

const UpgradeContext = createContext<UpgradeCtx | null>(null)

const PLANS = [
  {
    name: 'Early Bird',
    price: '₪10',
    period: 'לצמיתות',
    features: ['50 נכסים שיווקיים', '1 קמפיין פעיל', 'כל הכלים', 'עדכונים לצמיתות'],
    link: 'https://pay.grow.link/5970efd2adef5019d8f9e925211e1c48-MzI1Njk5Ng',
    plan: 'early_bird',
    gradient: 'from-blue-500 to-cyan-500',
  },
  {
    name: 'Pro',
    price: '₪249',
    period: '/חודש',
    features: ['500 נכסים שיווקיים', '20 קמפיינים פעילים', 'כל האינטגרציות', 'תמיכה עדיפות'],
    link: 'https://pay.grow.link/2297dbe8bb307b597007097ab69ac491-MzI1Njk5Nw',
    plan: 'pro',
    gradient: 'from-purple-500 to-pink-500',
    popular: true,
  },
]

export function UpgradeModalProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<UpgradeOptions | null>(null)

  const showUpgrade = useCallback((o: UpgradeOptions) => setOpts(o), [])
  const close = () => setOpts(null)

  return (
    <UpgradeContext.Provider value={{ showUpgrade }}>
      {children}
      <AnimatePresence>
        {opts && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={close}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="bg-gradient-to-l from-purple-600 via-blue-600 to-cyan-600 p-8 text-white relative">
                <button onClick={close} className="absolute top-4 left-4 opacity-70 hover:opacity-100 transition-opacity">
                  <X className="w-5 h-5" />
                </button>
                <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mb-4">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h2 className="text-2xl font-bold mb-1">שדרג את החשבון שלך</h2>
                <p className="text-white/80 text-sm">
                  הפיצ'ר <strong>{opts.feature}</strong> דורש תוכנית בתשלום
                </p>
              </div>

              {/* Plans */}
              <div className="p-6 grid grid-cols-2 gap-4">
                {PLANS.map(plan => (
                  <div
                    key={plan.plan}
                    className={`rounded-2xl border-2 p-5 relative ${plan.popular ? 'border-purple-400 bg-purple-50' : 'border-gray-100'}`}
                  >
                    {plan.popular && (
                      <div className="absolute -top-3 right-4 bg-gradient-to-l from-purple-600 to-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                        <Zap className="w-3 h-3" /> פופולרי
                      </div>
                    )}
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${plan.gradient} flex items-center justify-center mb-3`}>
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div className="font-bold text-gray-900 mb-0.5">{plan.name}</div>
                    <div className="text-2xl font-bold text-gray-900 mb-3">
                      {plan.price}<span className="text-sm font-normal text-gray-500">{plan.period}</span>
                    </div>
                    <ul className="space-y-1 mb-4">
                      {plan.features.map(f => (
                        <li key={f} className="text-xs text-gray-600 flex items-center gap-1">
                          <span className="text-green-500">✓</span> {f}
                        </li>
                      ))}
                    </ul>
                    <a
                      href={plan.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={close}
                      className={`block w-full py-2.5 rounded-xl text-center text-sm font-bold text-white bg-gradient-to-l ${plan.gradient} hover:shadow-lg transition-all hover:scale-105`}
                    >
                      בחר תוכנית
                    </a>
                  </div>
                ))}
              </div>

              <div className="px-6 pb-6 text-center">
                <button onClick={close} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                  אולי אחר כך
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </UpgradeContext.Provider>
  )
}

export function useUpgradeModal() {
  const ctx = useContext(UpgradeContext)
  if (!ctx) throw new Error('useUpgradeModal must be inside UpgradeModalProvider')
  return {
    ...ctx,
    open: (feature: string) => ctx.showUpgrade({ feature }),
  }
}
