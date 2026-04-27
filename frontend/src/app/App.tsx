import { lazy, Suspense, useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AppProvider, useAppState } from './state/store'
import { ToastProvider } from './hooks/useToast'
import { UpgradeModalProvider } from './hooks/useUpgradeModal'
import { useAuth } from './hooks/useAuth'
import { Sidebar } from './components/shell/Sidebar'
import { Auth } from './pages/Auth'
import { ResetPassword } from './pages/ResetPassword'
import { Dashboard } from './pages/Dashboard'
import { CookieConsent } from './components/ui/CookieConsent'
import { AccessibilityWidget } from './components/ui/AccessibilityWidget'

const Agents        = lazy(() => import('./pages/Agents').then(m => ({ default: m.Agents })))
const Chat          = lazy(() => import('./pages/Chat').then(m => ({ default: m.Chat })))
const Campaigns     = lazy(() => import('./pages/Campaigns').then(m => ({ default: m.Campaigns })))
const Research      = lazy(() => import('./pages/Research').then(m => ({ default: m.Research })))
const Analytics     = lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })))
const Leads         = lazy(() => import('./pages/Leads').then(m => ({ default: m.Leads })))
const Assets        = lazy(() => import('./pages/Assets').then(m => ({ default: m.Assets })))
const Integrations  = lazy(() => import('./pages/Integrations').then(m => ({ default: m.Integrations })))
const Settings      = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })))
const HelpCenter    = lazy(() => import('./pages/HelpCenter').then(m => ({ default: m.HelpCenter })))
const Updates       = lazy(() => import('./pages/Updates').then(m => ({ default: m.Updates })))

function PageFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function AppShell() {
  const { state } = useAppState()
  useAuth()

  // Sync theme class to <html>
  useEffect(() => {
    const html = document.documentElement
    if (state.theme === 'light') {
      html.classList.add('theme-light')
      html.classList.remove('theme-dark')
    } else {
      html.classList.add('theme-dark')
      html.classList.remove('theme-light')
    }
  }, [state.theme])

  // Supabase recovery link lands with #type=recovery in the hash
  const hash = window.location.hash
  if (hash.includes('type=recovery') || hash.includes('type%3Drecovery')) {
    return <ResetPassword />
  }

  if (!state.user) return <Auth />

  const page = state.currentPage
  const isLight = state.theme === 'light'
  const mainBg = isLight
    ? 'bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50'
    : 'bg-slate-950'

  return (
    <div className={`flex h-screen overflow-hidden ${isLight ? 'bg-slate-200' : 'bg-slate-950'}`} dir="rtl">
      <Sidebar />
      <main className={`flex-1 overflow-y-auto ${mainBg}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.18 }}
            className="h-full"
          >
            <Suspense fallback={<PageFallback />}>
              {page === 'dashboard'     && <Dashboard />}
              {page === 'agents'        && <Agents />}
              {page === 'chat'          && <Chat />}
              {page === 'campaigns'     && <Campaigns />}
              {page === 'research'      && <Research />}
              {page === 'analytics'     && <Analytics />}
              {page === 'leads'         && <Leads />}
              {page === 'assets'        && <Assets />}
              {page === 'integrations'  && <Integrations />}
              {page === 'settings'      && <Settings />}
              {page === 'help-center'   && <HelpCenter />}
              {page === 'updates'       && <Updates />}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}

export function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <UpgradeModalProvider>
          <AppShell />
          <CookieConsent />
          <AccessibilityWidget />
        </UpgradeModalProvider>
      </ToastProvider>
    </AppProvider>
  )
}
