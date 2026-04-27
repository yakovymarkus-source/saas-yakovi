import { motion } from 'motion/react'
import {
  Home, Sparkles, MessageSquare, BarChart3,
  Users, Image, Settings, Shield, Plug,
  Megaphone, LifeBuoy, UserCircle,
} from 'lucide-react'
import { useAppState, setState } from '../../state/store'
import { useAuth } from '../../hooks/useAuth'
import { NotificationBell } from '../ui/NotificationPanel'

interface NavItem {
  id: string
  icon: React.ElementType
  label: string
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard',   icon: Home,          label: 'לוח בקרה'  },
  { id: 'agents',      icon: Sparkles,      label: 'סוכנים'     },
  { id: 'chat',        icon: MessageSquare, label: 'צ\'אט AI'   },
  { id: 'campaigns',   icon: Megaphone,     label: 'קמפיינים'   },
  { id: 'analytics',   icon: BarChart3,     label: 'תובנות'      },
  { id: 'leads',       icon: Users,         label: 'לידים'       },
  { id: 'assets',      icon: Image,         label: 'נכסים'       },
  { id: 'integrations',icon: Plug,          label: 'אינטגרציות'  },
  { id: 'help-center', icon: LifeBuoy,      label: 'מרכז עזרה'  },
  { id: 'settings',    icon: Settings,      label: 'הגדרות'      },
  { id: 'admin',       icon: Shield,        label: 'Admin', adminOnly: true },
]

export function Sidebar() {
  const { state, dispatch } = useAppState()
  const { signOut } = useAuth()
  const isAdmin = state.profile?.is_admin

  const navigate = (page: string) => {
    if (page === 'admin') { window.location.href = '/admin/'; return }
    window.location.hash = page
    setState(dispatch, { currentPage: page })
  }

  const visible = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin)

  return (
    <div className="w-20 bg-gradient-to-b from-slate-900 via-purple-900 to-indigo-900 flex flex-col items-center py-6 gap-2 shadow-2xl flex-shrink-0 h-screen sticky top-0 overflow-y-auto">
      {/* Logo */}
      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center mb-2 shadow-lg">
        <Sparkles className="w-5 h-5 text-white" />
      </div>

      {/* Notification Bell — top of nav */}
      <NotificationBell />

      <div className="w-10 h-px bg-white/10 my-1" />

      {visible.map(item => {
        const Icon = item.icon
        const isActive = state.currentPage === item.id

        return (
          <motion.button
            key={item.id}
            onClick={() => navigate(item.id)}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.95 }}
            className={`group relative flex flex-col items-center gap-1 p-2.5 rounded-2xl transition-all duration-200 w-16 ${
              isActive
                ? 'bg-white/20 text-white shadow-lg'
                : 'text-white/50 hover:text-white hover:bg-white/10'
            }`}
            title={item.label}
          >
            {isActive && (
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-purple-500 rounded-2xl opacity-20 blur-xl pointer-events-none" />
            )}
            <Icon className="w-5 h-5 relative z-10" />
            <span className="text-[9px] font-semibold tracking-wide relative z-10 text-center leading-tight">
              {item.label}
            </span>
          </motion.button>
        )
      })}

      {/* Avatar + Sign out */}
      <div className="mt-auto flex flex-col items-center gap-2">
        <button
          onClick={() => navigate('settings')}
          title={state.profile?.name || state.profile?.email || 'פרופיל'}
          className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center ring-2 ring-white/10 hover:ring-white/30 transition-all"
        >
          {state.profile?.avatar_url ? (
            <img src={state.profile.avatar_url} alt="פרופיל" className="w-full h-full object-cover" />
          ) : (
            <UserCircle className="w-5 h-5 text-white/70" />
          )}
        </button>
        <button
          onClick={signOut}
          className="text-white/30 hover:text-white/70 transition-colors p-2 rounded-xl hover:bg-white/10"
          title="התנתק"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </div>
  )
}
