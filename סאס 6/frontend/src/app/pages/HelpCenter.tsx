import { useState } from 'react'
import { LifeBuoy, BookOpen, HeadphonesIcon } from 'lucide-react'
import { Tutorials } from './Tutorials'
import { Support } from './Support'

const TABS = [
  { id: 'tutorials', label: 'הדרכות', icon: BookOpen },
  { id: 'support',   label: 'תמיכה',  icon: HeadphonesIcon },
]

export function HelpCenter() {
  const [tab, setTab] = useState('tutorials')

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <div className="px-6 pt-6 pb-0">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center shadow-lg">
            <LifeBuoy className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">מרכז עזרה</h1>
            <p className="text-slate-400 text-sm">הדרכות, שאלות נפוצות ותמיכה</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-white/10">
          {TABS.map(t => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border-b-2 transition-all -mb-px ${
                  active
                    ? 'border-teal-500 text-teal-400'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'tutorials' && <Tutorials />}
        {tab === 'support'   && <Support />}
      </div>
    </div>
  )
}
