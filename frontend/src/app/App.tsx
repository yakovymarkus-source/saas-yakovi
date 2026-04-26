import { lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AppProvider, useAppState } from './state/store'
import { ToastProvider } from './hooks/useToast'
import { UpgradeModalProvider } from './hooks/useUpgradeModal'
import { useAuth } from './hooks/useAuth'
import { Sidebar } from './components/shell/Sidebar'
import { Auth } from './pages/Auth'
import { Dashboard } from './pages/Dashboard'

const Agents       = lazy(() => import('./pages/Agents').then(m => ({ default: m.Agents })))
const Chat         = lazy(() => import('./pages/Chat').then(m => ({ default: m.Chat })))
const Research     = lazy(() => import('./pages/Research').then(m => ({ default: m.Research })))
const Analytics    = lazy(() => import('./pages/Analytics').then(m => ({ default: m.Analytics })))
const Leads        = lazy(() => import('./pages/Leads').then(m => ({ default: m.Leads })))
const Assets       = lazy(() => import('./pages/Assets').then(m => ({ default: m.Assets })))
const Integrations = lazy(() => import('./pages/Integrations').then(m => ({ default: m.Integrations })))
const Settings     = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })))
const Support      = lazy(() => import('./pages/Support').then(m => ({ default: m.Support })))
const Tutorials    = lazy(() => import('./pages/Tutorials').then(m => ({ default: m.Tutorials })))
const Updates      = lazy(() => import('./pages/Updates').then(m => ({ default: m.Updates })))

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

  if (!state.user) return <Auth />

  const page = state.currentPage

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden" dir="rtl">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
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
              {page === 'dashboard'    && <Dashboard />}
              {page === 'agents'       && <Agents />}
              {page === 'chat'         && <Chat />}
              {page === 'research'     && <Research />}
              {page === 'analytics'    && <Analytics />}
              {page === 'leads'        && <Leads />}
              {page === 'assets'       && <Assets />}
              {page === 'integrations' && <Integrations />}
              {page === 'settings'     && <Settings />}
              {page === 'support'      && <Support />}
              {page === 'tutorials'    && <Tutorials />}
              {page === 'updates'      && <Updates />}
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
        </UpgradeModalProvider>
      </ToastProvider>
    </AppProvider>
  )
}
