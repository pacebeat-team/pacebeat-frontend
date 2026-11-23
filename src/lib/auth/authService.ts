import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import type { SupabaseConfig } from './config.ts'
import { isAuthSession } from './storage.ts'
import type { AuthSession, AuthStorage } from './storage.ts'

// Supabase Auth 세션 관리(토큰 공급·갱신·복구·상태 알림). 백엔드에는 로그인·갱신 API가 없고 Supabase Auth가 JWT를 발급한다.
//
// 이 모듈이 하는 것(로그인 방식과 무관한 부분): 세션 복구, 만료 전 갱신, 갱신 중복 방지, 로그아웃, 401 처리, 상태 알림.
// 로그인: 이메일·비밀번호(signInWithPassword)만 지원한다. 소셜(OAuth)은 Provider·Redirect URL 설정이 확인되지 않아 켜지 않았다. 로그인 수단이 얻은 결과(access/refresh 토큰·만료)를 setSession에 넘긴다.
// 갱신·로그아웃은 Supabase Auth(GoTrue) REST(`/auth/v1/token?grant_type=refresh_token`, `/auth/v1/logout`)를 쓴다. 실제 Supabase 프로젝트로는 아직 검증하지 못했다.
//
// 상태 Store에는 토큰을 넣지 않는다(화면에서 실수로 로그에 남기지 않도록 토큰은 이 모듈 안에만 있다). 토큰·키를 로그에 출력하지 않는다.
export type AuthStatus =
  | 'disabled' // Supabase 설정이 없다 → 인증 기능 꺼짐(게스트 흐름만)
  | 'initializing' // 저장된 세션을 확인하는 중
  | 'signedOut' // 세션 없음(게스트)
  | 'signedIn'
  | 'expired' // 세션이 만료·거부되어 지워졌다(다시 로그인 필요)

export interface AuthState {
  readonly status: AuthStatus
  // 토큰의 sub 값(있을 때). 사용자별 캐시 구분에 쓴다. 검증하지 않은 값이므로 권한 판단에 쓰지 않는다.
  readonly userId: string | null
}

export interface AuthDeps {
  readonly config: SupabaseConfig | null
  readonly storage: AuthStorage
  readonly fetch?: typeof fetch
  readonly now?: () => number
  // 만료 이만큼 전부터 갱신한다.
  readonly refreshMarginMs?: number
  readonly timeoutMs?: number
}

// 이메일·비밀번호 로그인 결과. 실패 사유만 알리고, 입력값·토큰·서버 응답 본문은 담지 않는다(로그에 남기지 않는다).
export type SignInFailure =
  | 'disabled' // Supabase 설정이 없다(인증 꺼짐)
  | 'invalid-input' // 이메일 또는 비밀번호가 비어 있다
  | 'invalid-credentials' // 이메일 또는 비밀번호가 맞지 않는다(400/401/422)
  | 'rate-limited' // 429
  | 'network' // 네트워크 오류·시간 초과·5xx
  | 'bad-response' // 성공 응답인데 세션 형식이 올바르지 않다
  | 'superseded' // 응답을 기다리는 동안 다른 로그인·로그아웃이 있었다(이 응답은 버렸다)
export type SignInResult = { readonly ok: true } | { readonly ok: false; readonly reason: SignInFailure }

export interface SessionInput {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

const DEFAULT_MARGIN_MS = 60_000
const DEFAULT_TIMEOUT_MS = 15_000

export function readUserId(accessToken: string): string | null {
  try {
    const part = accessToken.split('.')[1]
    if (part === undefined) return null
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const payload: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    const sub = typeof payload === 'object' && payload !== null ? (payload as { sub?: unknown }).sub : undefined
    return typeof sub === 'string' && sub !== '' ? sub : null
  } catch {
    return null
  }
}

// Supabase 토큰 응답 → 세션. access_token·refresh_token과 만료(expires_at 초 또는 expires_in 초)가 모두 올바를 때만 만든다.
export function parseTokenResponse(body: unknown, now: number): AuthSession | null {
  if (typeof body !== 'object' || body === null) return null
  const v = body as Record<string, unknown>
  const { access_token: access, refresh_token: refresh } = v
  if (typeof access !== 'string' || access === '' || typeof refresh !== 'string' || refresh === '') return null
  let expiresAt: number | null = null
  if (typeof v.expires_at === 'number' && Number.isFinite(v.expires_at)) expiresAt = v.expires_at * 1000
  else if (typeof v.expires_in === 'number' && Number.isFinite(v.expires_in)) expiresAt = now + v.expires_in * 1000
  return expiresAt === null ? null : { accessToken: access, refreshToken: refresh, expiresAt }
}

export function createAuthService(deps: AuthDeps) {
  const { config, storage } = deps
  const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  const now = deps.now ?? Date.now
  const margin = deps.refreshMarginMs ?? DEFAULT_MARGIN_MS
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const store: StoreApi<AuthState> = createStore<AuthState>()(() => ({ status: config === null ? 'disabled' : 'initializing', userId: null }))
  let session: AuthSession | null = null
  let inflight: Promise<boolean> | null = null
  let inflightFor: AuthSession | null = null
  let initPromise: Promise<void> | null = null
  // 세션이 바뀔 때마다 올라가는 번호: 로그인 응답을 기다리는 동안 로그아웃·다른 로그인이 있었는지 확인한다.
  let sessionSeq = 0

  function publish(status: AuthStatus): void {
    const userId = session === null ? null : readUserId(session.accessToken)
    const current = store.getState()
    if (current.status !== status || current.userId !== userId) store.setState({ status, userId })
  }

  function accept(next: AuthSession): void {
    sessionSeq += 1
    session = next
    storage.save(next)
    publish('signedIn')
  }

  function drop(status: 'signedOut' | 'expired'): void {
    sessionSeq += 1
    session = null
    storage.clear()
    publish(status)
  }

  const isFresh = (s: AuthSession): boolean => now() < s.expiresAt - margin
  const isUsable = (s: AuthSession): boolean => now() < s.expiresAt

  // 갱신 요청. 성공 true. 갱신 토큰이 거부되면(400/401/403) 세션을 지우고 expired, 네트워크·서버 오류는 세션을 그대로 둔다(false).
  async function doRefresh(): Promise<boolean> {
    const current = session
    if (config === null || current === null) return false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await doFetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: current.refreshToken }),
        signal: controller.signal,
      })
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        if (session === current) drop('expired')
        return false
      }
      if (!response.ok) return false
      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        return false
      }
      const next = parseTokenResponse(body, now())
      if (next === null) return false
      // 응답을 기다리는 동안 로그아웃되었거나 다른 계정으로 바뀌었다면 이 응답은 버린다(이전 계정의 토큰이 현재 세션을 덮어쓰거나 로그아웃한 세션을 되살리지 않게).
      if (session !== current) return false
      accept(next)
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  // 갱신은 동시에 한 번만 한다(여러 요청이 같은 갱신 토큰으로 중복 갱신하지 않게).
  // 진행 중인 갱신이 지금 세션의 것일 때만 공유한다(다른 계정으로 바뀐 뒤에는 이전 계정의 갱신을 기다려 쓰지 않는다).
  function refresh(): Promise<boolean> {
    if (inflight !== null && inflightFor === session) return inflight
    const mine = session
    const promise: Promise<boolean> = doRefresh().finally(() => {
      if (inflight === promise) {
        inflight = null
        inflightFor = null
      }
    })
    inflight = promise
    inflightFor = mine
    return promise
  }

  return {
    store,

    // 저장된 세션을 복구한다. 만료됐거나 임박했으면 갱신한다. 여러 번 불러도 한 번만 실행한다.
    init(): Promise<void> {
      initPromise ??= (async () => {
        if (config === null) return
        const saved = storage.load()
        if (saved === null) {
          publish('signedOut')
          return
        }
        session = saved
        if (isFresh(saved)) {
          publish('signedIn')
          return
        }
        publish('initializing')
        await refresh()
        // 갱신이 네트워크 문제로 실패했어도 토큰이 아직 유효하면 로그인 상태로 둔다. 쓸 수 없으면 세션을 유지하되 로그아웃 상태로 본다.
        if (session !== null && store.getState().status !== 'signedIn') publish(isUsable(session) ? 'signedIn' : 'signedOut')
      })()
      return initPromise
    },

    // API 요청에 붙일 액세스 토큰. 만료 임박이면 먼저 갱신한다. 없거나 쓸 수 없으면 null(요청은 토큰 없이 나간다).
    async getAccessToken(): Promise<string | null> {
      if (config === null) return null
      await initPromise
      if (session === null) return null
      if (!isFresh(session)) await refresh()
      return session !== null && isUsable(session) ? session.accessToken : null
    },

    // 서버가 401을 돌려준 뒤 한 번 호출한다: 즉시 갱신해 새 토큰을 돌려준다. 갱신할 수 없으면 null.
    async forceRefresh(): Promise<string | null> {
      if (config === null || session === null) return null
      const ok = await refresh()
      return ok && session !== null ? session.accessToken : null
    },

    // 이메일·비밀번호 로그인(Supabase GoTrue: POST /auth/v1/token?grant_type=password, anon 키만 사용). 실제 Supabase 프로젝트로는 아직 검증하지 못했다.
    // 성공하면 세션을 저장하고 signedIn으로 알린다(이미 다른 계정으로 로그인해 있었다면 계정이 전환된다: 상태 변경 알림이 올라간다).
    // 응답을 기다리는 동안 로그아웃·다른 로그인이 있었으면 이 응답은 버린다. 입력값·토큰은 어디에도 기록하거나 출력하지 않는다.
    async signInWithPassword(email: string, password: string): Promise<SignInResult> {
      if (config === null) return { ok: false, reason: 'disabled' }
      const cleanEmail = typeof email === 'string' ? email.trim() : ''
      if (cleanEmail === '' || typeof password !== 'string' || password === '') return { ok: false, reason: 'invalid-input' }
      const seq = sessionSeq
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await doFetch(`${config.url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, password }),
          signal: controller.signal,
        })
        if (response.status === 429) return { ok: false, reason: 'rate-limited' }
        if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 422) return { ok: false, reason: 'invalid-credentials' }
        if (!response.ok) return { ok: false, reason: 'network' }
        let body: unknown = null
        try {
          body = await response.json()
        } catch {
          return { ok: false, reason: 'bad-response' }
        }
        const next = parseTokenResponse(body, now())
        if (next === null || readUserId(next.accessToken) === null) return { ok: false, reason: 'bad-response' }
        if (sessionSeq !== seq) return { ok: false, reason: 'superseded' }
        accept(next)
        return { ok: true }
      } catch {
        return { ok: false, reason: 'network' }
      } finally {
        clearTimeout(timer)
      }
    },

    // 로그인 수단이 얻은 세션을 등록한다. 형식이 올바르지 않으면 false.
    setSession(input: SessionInput): boolean {
      if (config === null || !isAuthSession(input)) return false
      accept({ accessToken: input.accessToken, refreshToken: input.refreshToken, expiresAt: input.expiresAt })
      return true
    },

    // 로그아웃. 로컬 세션은 항상 먼저 지우고, 서버 로그아웃은 가능하면 시도한다(실패해도 로컬은 이미 로그아웃이다).
    async signOut(): Promise<void> {
      const token = session?.accessToken ?? null
      drop('signedOut')
      if (config === null || token === null) return
      try {
        await doFetch(`${config.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` } })
      } catch {
        // 무시: 서버가 닿지 않아도 이 기기에서는 로그아웃되었다.
      }
    },

    // API가 (갱신 뒤에도) 401을 돌려줬다: 로그인 상태였다면 세션을 지우고 expired로 알린다. 게스트(세션 없음)는 그대로 둔다.
    // expectedUserId를 주면 지금 로그인한 계정이 그 계정일 때만 처리한다(이전 계정 요청의 늦은 401이 현재 계정을 로그아웃시키지 않게).
    handleUnauthorized(expectedUserId?: string): void {
      if (session === null) return
      if (expectedUserId !== undefined && readUserId(session.accessToken) !== expectedUserId) return
      drop('expired')
    },

    // 다른 탭이 저장소를 바꿨을 때 이 탭의 상태를 맞춘다.
    syncFromStorage(): void {
      if (config === null) return
      const saved = storage.load()
      if (saved === null) {
        if (session !== null) {
          session = null
          publish('signedOut')
        }
        return
      }
      if (session === null || saved.accessToken !== session.accessToken) {
        session = saved
        publish(isUsable(saved) ? 'signedIn' : 'signedOut')
      }
    },

    // 인증 상태 변경 감지. 해제 함수를 돌려준다.
    onAuthStateChange(listener: (state: AuthState) => void): () => void {
      return store.subscribe((state) => listener(state))
    },

    getState: (): AuthState => store.getState(),
  }
}

export type AuthService = ReturnType<typeof createAuthService>
