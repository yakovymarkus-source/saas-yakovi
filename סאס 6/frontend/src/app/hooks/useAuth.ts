import { useEffect, useCallback } from 'react'
import { sb, api, setAccessToken } from '../api/client'
import { useAppState, setState } from '../state/store'
import type { Profile, Subscription, Campaign, Integration, BusinessProfile } from '../state/types'

export function useAuth() {
  const { state, dispatch } = useAppState()

  const loadAppData = useCallback(async (userId: string) => {
    try {
      const cached = localStorage.getItem('cb_cache_' + userId)
      if (cached) {
        const c = JSON.parse(cached)
        setState(dispatch, {
          profile:         c.profile         || null,
          subscription:    c.subscription    || null,
          campaigns:       c.campaigns       || [],
          integrations:    c.integrations    || [],
          businessProfile: c.businessProfile || null,
        })
      }
    } catch {}

    try {
      const [profileRes, subsRes, campsRes, integRes, bizRes] = await Promise.all([
        sb.from('profiles').select('*').eq('id', userId).maybeSingle(),
        sb.from('subscriptions').select('*').eq('user_id', userId).maybeSingle(),
        api<Campaign[]>('GET', 'create-campaign').catch(() => []),
        sb.from('integrations').select('*').eq('user_id', userId),
        sb.from('business_profiles').select('*').eq('user_id', userId).maybeSingle(),
      ])

      // Load campaigns from Supabase directly (create-campaign is POST only)
      const { data: campaigns } = await sb
        .from('campaigns')
        .select('id,name,created_at')
        .eq('owner_user_id', userId)
        .order('created_at', { ascending: false })

      const profile = profileRes.data as Profile | null
      const subscription = subsRes.data as Subscription | null
      const integrations = (integRes.data || []) as Integration[]
      const businessProfile = bizRes.data as BusinessProfile | null
      const campList = (campaigns || []) as Campaign[]

      // Check unread updates
      const { count: updatesCount } = await sb
        .from('system_updates')
        .select('id', { count: 'exact', head: true })
        .eq('published', true)

      const seenKey = 'seen_updates_' + userId
      const seen: string[] = JSON.parse(localStorage.getItem(seenKey) || '[]')
      const { data: allUpdates } = await sb.from('system_updates').select('id').eq('published', true)
      const unseen = (allUpdates || []).filter(u => !seen.includes(u.id)).length

      setState(dispatch, {
        profile,
        subscription,
        campaigns: campList,
        integrations,
        businessProfile,
        updatesCount: unseen,
      })

      localStorage.setItem('cb_cache_' + userId, JSON.stringify({
        profile, subscription, campaigns: campList, integrations, businessProfile,
      }))
    } catch (err) {
      console.error('[useAuth] loadAppData error:', err)
    }
  }, [dispatch])

  useEffect(() => {
    const { data: { subscription } } = sb.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setAccessToken(session.access_token)
        setState(dispatch, {
          user: { id: session.user.id, email: session.user.email || '' },
          accessToken: session.access_token,
          currentPage: window.location.hash.replace('#', '') || 'dashboard',
        })
        await loadAppData(session.user.id)
      } else {
        setAccessToken('')
        setState(dispatch, {
          user: null, profile: null, subscription: null,
          campaigns: [], integrations: [], businessProfile: null,
          accessToken: null, currentPage: 'dashboard',
        })
      }
    })

    return () => subscription.unsubscribe()
  }, [dispatch, loadAppData])

  const signOut = useCallback(async () => {
    await sb.auth.signOut()
    localStorage.clear()
  }, [])

  return { user: state.user, signOut, loadAppData }
}
