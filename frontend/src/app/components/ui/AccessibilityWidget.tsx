import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'

const STORAGE_KEY = 'a11y_prefs_v1'

interface A11yPrefs {
  largeText: boolean
  contrast: boolean
  spacing: boolean
  links: boolean
  dyslexia: boolean
  noAnim: boolean
}

const DEFAULTS: A11yPrefs = {
  largeText: false,
  contrast: false,
  spacing: false,
  links: false,
  dyslexia: false,
  noAnim: false,
}

const CLASS_MAP: Record<keyof A11yPrefs, string> = {
  largeText: 'a11y-large-text',
  contrast:  'a11y-contrast',
  spacing:   'a11y-spacing',
  links:     'a11y-links',
  dyslexia:  'a11y-dyslexia',
  noAnim:    'a11y-no-anim',
}

const OPTIONS: { key: keyof A11yPrefs; label: string; icon: string }[] = [
  { key: 'largeText', label: 'טקסט גדול',         icon: 'A' },
  { key: 'contrast',  label: 'ניגודיות גבוהה',    icon: '◑' },
  { key: 'spacing',   label: 'ריווח מוגבר',        icon: '↕' },
  { key: 'links',     label: 'הדגשת קישורים',      icon: '🔗' },
  { key: 'dyslexia',  label: 'גופן דיסלקציה',      icon: 'D' },
  { key: 'noAnim',    label: 'ללא אנימציות',        icon: '⏸' },
]

function loadPrefs(): A11yPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

function applyPrefs(prefs: A11yPrefs) {
  const body = document.body
  for (const [key, cls] of Object.entries(CLASS_MAP)) {
    body.classList.toggle(cls, prefs[key as keyof A11yPrefs])
  }
}

export function AccessibilityWidget() {
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<A11yPrefs>(loadPrefs)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef  = useRef<HTMLDivElement>(null)

  // Apply on mount and whenever prefs change
  useEffect(() => {
    applyPrefs(prefs)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  }, [prefs])

  const toggle = useCallback((key: keyof A11yPrefs) => {
    setPrefs(p => ({ ...p, [key]: !p[key] }))
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    buttonRef.current?.focus()
  }, [])

  // Keyboard: Escape closes
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, close])

  // Focus first item when panel opens
  useEffect(() => {
    if (open) {
      const first = panelRef.current?.querySelector<HTMLElement>('[role="switch"]')
      first?.focus()
    }
  }, [open])

  // Focus trap inside panel
  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
      'button, [role="switch"]'
    )
    if (!focusables?.length) return
    const first = focusables[0]
    const last  = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus()
    }
  }

  const activeCount = Object.values(prefs).filter(Boolean).length

  return (
    <div className="fixed bottom-20 left-4 z-50" dir="rtl">
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-label="כלי נגישות"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            onKeyDown={handlePanelKeyDown}
            className="absolute bottom-14 left-0 w-64 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white">נגישות</span>
              <button
                onClick={close}
                aria-label="סגור תפריט נגישות"
                className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-purple-400"
              >
                ✕
              </button>
            </div>
            <div className="p-3 space-y-1">
              {OPTIONS.map(opt => {
                const active = prefs[opt.key]
                return (
                  <button
                    key={opt.key}
                    role="switch"
                    aria-checked={active}
                    aria-label={opt.label}
                    onClick={() => toggle(opt.key)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all text-sm font-medium focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-inset ${
                      active
                        ? 'bg-purple-600/30 text-purple-300 border border-purple-500/40'
                        : 'text-slate-300 hover:bg-white/8 hover:text-white border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-6 text-center text-base leading-none select-none" aria-hidden="true">
                        {opt.icon}
                      </span>
                      <span>{opt.label}</span>
                    </div>
                    <div
                      className={`w-9 h-5 rounded-full relative transition-colors ${
                        active ? 'bg-purple-500' : 'bg-slate-600'
                      }`}
                      aria-hidden="true"
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${
                        active ? 'right-0.5' : 'left-0.5'
                      }`} />
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="px-4 py-2 border-t border-white/10">
              <button
                onClick={() => setPrefs(DEFAULTS)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-400 rounded"
                aria-label="אפס כל הגדרות נגישות"
              >
                איפוס הכל
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`כלי נגישות${activeCount > 0 ? `, ${activeCount} אפשרויות פעילות` : ''}`}
        className="w-12 h-12 rounded-full bg-slate-800 border border-white/20 shadow-xl flex items-center justify-center text-xl hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2 focus:ring-offset-slate-950 relative"
      >
        ♿
        {activeCount > 0 && (
          <span
            className="absolute -top-1 -right-1 w-4 h-4 bg-purple-500 rounded-full text-[9px] text-white font-bold flex items-center justify-center"
            aria-hidden="true"
          >
            {activeCount}
          </span>
        )}
      </motion.button>
    </div>
  )
}
