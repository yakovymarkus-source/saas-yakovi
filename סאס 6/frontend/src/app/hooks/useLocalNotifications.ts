import { useCallback } from 'react'
import { useAppState, setState } from '../state/store'
import type { LocalNotification } from '../state/types'

const KEY = 'cb_notifications_v1'

function load(): LocalNotification[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

function save(list: LocalNotification[]) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)))
}

export function useLocalNotifications() {
  const { state, dispatch } = useAppState()

  const add = useCallback((notif: Omit<LocalNotification, 'id' | 'read' | 'createdAt'>) => {
    const list = load()
    const newItem: LocalNotification = {
      id: Date.now(),
      read: false,
      createdAt: new Date().toISOString(),
      ...notif,
    }
    list.unshift(newItem)
    save(list)
    setState(dispatch, { localNotifCount: list.filter(n => !n.read).length })
  }, [dispatch])

  const markAllRead = useCallback(() => {
    const list = load().map(n => ({ ...n, read: true }))
    save(list)
    setState(dispatch, { localNotifCount: 0 })
  }, [dispatch])

  const getAll = useCallback(() => load(), [])

  const initCount = useCallback(() => {
    const unread = load().filter(n => !n.read).length
    setState(dispatch, { localNotifCount: unread })
  }, [dispatch])

  return { add, markAllRead, getAll, initCount, count: state.localNotifCount }
}
