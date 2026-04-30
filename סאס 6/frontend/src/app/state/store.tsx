import React, { createContext, useContext, useReducer, Dispatch } from 'react'
import type { AppState } from './types'

const initialState: AppState = {
  user:              null,
  profile:           null,
  subscription:      null,
  campaigns:         [],
  integrations:      [],
  liveStats:         {},
  liveStatsLoading:  false,
  currentPage:       'dashboard',
  currentCampaignId: null,
  accessToken:       null,
  businessProfile:   null,
  updatesCount:      0,
  localNotifCount:   0,
  supportCount:      0,
  theme:             (localStorage.getItem('cb_theme') as 'dark' | 'light') || 'dark',
}

type Action =
  | { type: 'SET'; payload: Partial<AppState> }
  | { type: 'RESET' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET':    return { ...state, ...action.payload }
    case 'RESET':  return { ...initialState }
    default:       return state
  }
}

const AppContext = createContext<{
  state: AppState
  dispatch: Dispatch<Action>
} | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppState() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppState must be used inside AppProvider')
  return ctx
}

export function setState(dispatch: Dispatch<Action>, payload: Partial<AppState>) {
  dispatch({ type: 'SET', payload })
}
