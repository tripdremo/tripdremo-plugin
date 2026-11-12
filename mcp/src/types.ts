export type TripdremoLocale = "en" | "lt" | "de" | "pl"

export type TripdremoLogLevel = "silent" | "error" | "warn" | "info" | "debug"

export type TripdremoErrorCode =
  | "not_authenticated"
  | "login_pending"
  | "login_expired"
  | "quota_exceeded"
  | "invalid_request"
  | "generation_failed"
  | "generation_timeout"
  | "backend_ai_disabled"
  | "plan_not_found"
  | "rate_limited"
  | "backend_unreachable"
  | "internal"

export type TripdremoAuthKind = "none" | "guest" | "user"

export type TripdremoPlanStatus = "draft" | "generating" | "ready" | "failed"

export type TripdremoOwnerKind = "guest" | "user"

export interface TripdremoConfig {
  apiBaseUrl: string
  siteUrl: string
  locale: TripdremoLocale
  configDir: string
  credentialsPath: string
  plansPath: string
  devUser?: string
  timeoutMs: number
  submitTimeoutMs: number
  logLevel: TripdremoLogLevel
}

export interface TripdremoLoginState {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
  started_at: string
}

export interface TripdremoCredentials {
  device_id: string
  token: string
  kind: TripdremoAuthKind
  email?: string
  pending_login?: TripdremoLoginState | null
  updated_at: string
}

export interface TripdremoGuestPlanRecord {
  share_hash: string
  title: string
  created_at: string
}

export interface TripdremoAuthState {
  authenticated: boolean
  kind: TripdremoAuthKind
  email?: string
  device_id: string
  plans_used?: number
  plans_limit?: number
  api_base_url: string
}

export interface TripdremoDaySummary {
  index: number
  title: string
  stop_count: number
  drive_summary: string
}

export interface TripdremoPlanResult {
  share_hash: string
  share_url: string
  title: string
  subtitle: string
  destination: string
  dates: {
    start: string
    end: string
  }
  day_count: number
  status: TripdremoPlanStatus
  owner_kind: TripdremoOwnerKind
  days: TripdremoDaySummary[]
  trip_payload?: Record<string, unknown>
}

export interface TripdremoPlanGenerationHandle {
  status: "generating"
  job_id: number
  progress_url: string
  poll_after_seconds: number
}

export interface TripdremoTripRecord {
  id: number
  title: string
  subtitle: string
  destination: string
  dates: {
    start: string
    end: string
  }
  status: TripdremoPlanStatus
  share_hash: string
  share_url: string
  created_at?: string
  updated_at?: string
  request_payload?: Record<string, unknown> | null
  trip_payload?: {
    data?: TripdremoTripData
    [key: string]: unknown
  } | null
  source?: "local" | "generated" | string
}

export interface TripdremoTripData {
  trip?: {
    title?: string
    subtitle?: string
    dates?: {
      start?: string
      end?: string
      display?: string
    }
    travelers?: {
      adults?: number
      children?: { age: number }[]
      pace?: string
    }
    stats?: {
      days?: number
      nights?: number
      countries?: number
      planned_bases?: number
      anchor_experiences?: number
      approximate_total_drive_km?: number
    }
    planning_notes?: string[]
    hero?: {
      image?: string
      alt?: string
      credit?: string
    }
  }
  route?: {
    stops?: Array<{
      id?: string
      name?: string
      role?: string
      date_range?: string
      coordinates?: [number, number]
      icon?: string
    }>
  }
  days?: Array<{
    day?: number
    date?: string
    title?: string
    base?: string
    stay_area?: string
    drive?: {
      from?: string
      to?: string
      estimate?: string
      distance_km?: number
      time_hours?: number
    }
    focus?: string
    summary?: string
    route_note?: string
    places?: Array<Record<string, unknown>>
    activities?: string[]
    kid_fit?: string[]
    fallback?: string[]
  }>
  packing?: {
    essentials?: string[]
    car_day_setup?: string[]
  }
  [key: string]: unknown
}

export interface TripdremoTripListResponse {
  count?: number
  next?: string | null
  previous?: string | null
  results?: TripdremoTripRecord[]
  [key: string]: unknown
}
