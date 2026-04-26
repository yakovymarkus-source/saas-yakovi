import { motion } from 'motion/react'
import { Bell } from 'lucide-react'
import { useAppState, setState } from '../../state/store'

export function NotificationBell() {
  const { state, dispatch } = useAppState()
  const badge = (state.updatesCount || 0) + (state.localNotifCount || 0)
  const isActive = state.currentPage === 'updates'

  const open = () => {
    window.location.hash = 'updates'
    setState(dispatch, { currentPage: 'updates', updatesCount: 0 })
  }

  return (
    <motion.button
      onClick={open}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      className={`relative flex flex-col items-center gap-1 p-2.5 rounded-2xl transition-all duration-200 w-16 ${
        isActive ? 'bg-white/20 text-white shadow-lg' : 'text-white/50 hover:text-white hover:bg-white/10'
      }`}
      title="עדכונים"
    >
      {isActive && (
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-purple-500 rounded-2xl opacity-20 blur-xl pointer-events-none" />
      )}
      <div className="relative">
        <Bell className="w-5 h-5 relative z-10" />
        {badge > 0 && (
          <span className="absolute -top-1.5 -left-1.5 bg-red-500 text-white text-[9px] font-bold min-w-[14px] h-[14px] rounded-full flex items-center justify-center px-0.5 leading-none z-20">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </div>
    </motion.button>
  )
}
