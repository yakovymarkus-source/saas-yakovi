export interface User {
  id: string
  email: string
}

export interface Profile {
  id: string
  name: string | null
  full_name: string | null
  email: string | null
  avatar_url: string | null
  is_admin: boolean
  marketing_consent: boolean
}

export interface Subscription {
  plan: 'free' | 'early_bird' | 'starter' | 'pro' | 'agency'
  payment_status: 'none' | 'pending' | 'active'
}

export interface Campaign {
  id: string
  name: string
  created_at: string
}

export interface Integration {
  provider: 'google_ads' | 'ga4' | 'meta' | 'tiktok'
  connection_status: 'active' | 'revoked' | 'error'
  last_sync_at: string | null
  account_name: string | null
}

export interface BusinessProfile {
  business_name: string | null
  offer: string | null
  target_audience: string | null
  problem_solved: string | null
  price_amount: number | null
  pricing_model: string | null
  monthly_budget: number | null
  primary_goal: string | null
}

export interface ProviderStats {
  metrics: Record<string, number>[]
  fetchedAt: string
  cached: boolean
  error?: string
}

export interface LiveStats {
  [provider: string]: ProviderStats
}

export interface LocalNotification {
  id: number
  read: boolean
  createdAt: string
  icon: string
  title: string
  body: string
  page?: string
  campaignId?: string
}

export interface AppState {
  user: User | null
  profile: Profile | null
  subscription: Subscription | null
  campaigns: Campaign[]
  integrations: Integration[]
  liveStats: LiveStats
  liveStatsLoading: boolean
  currentPage: string
  currentCampaignId: string | null
  accessToken: string | null
  businessProfile: BusinessProfile | null
  updatesCount: number
  localNotifCount: number
  supportCount: number
  theme: 'dark' | 'light'
}

export const PLAN_LIMITS: Record<string, { assetsLimit: number | null; campaignLimit: number | null; label: string }> = {
  free:       { assetsLimit: 5,    campaignLimit: 0,    label: 'חינמי'     },
  early_bird: { assetsLimit: 50,   campaignLimit: 1,    label: 'Early Bird' },
  starter:    { assetsLimit: 30,   campaignLimit: 3,    label: 'Starter'   },
  pro:        { assetsLimit: 500,  campaignLimit: 20,   label: 'Pro'       },
  agency:     { assetsLimit: null, campaignLimit: null, label: 'Agency'    },
}

export function getPlanLabel(plan: string) {
  return PLAN_LIMITS[plan]?.label ?? plan.toUpperCase()
}

export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}
