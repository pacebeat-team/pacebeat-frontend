import { ApiError, NetworkError, parseApiError } from './errors.ts'

// 공통 HTTP 클라이언트(fetch 기반). 화면·Store를 알지 못한다.
// - 토큰은 getAccessToken으로만 받는다. 이 모듈은 토큰을 저장·갱신·로그에 남기지 않는다(인증 방식·갱신 정책은 미확정).
// - 401은 onUnauthorized로 알리기만 한다. 자동 재시도·갱신은 하지 않는다.
// - 재시도 정책은 두지 않는다(쓰기 요청의 멱등성은 서버 계약(client_session_id)에 맡긴다). 호출하는 쪽(Query)이 정한다.
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  readonly query?: Readonly<Record<string, string | number | boolean | null | undefined>>
  readonly body?: unknown
  readonly signal?: AbortSignal
  // 인증이 필요 없는 요청(/health)이면 false
  readonly auth?: boolean
}

export interface ApiClientDeps {
  readonly baseUrl: string
  readonly getAccessToken?: () => string | null | Promise<string | null>
  // 토큰을 붙여 보낸 요청이 401이면 한 번만 호출한다. 새 토큰을 돌려주면 같은 요청을 한 번 다시 보낸다(401은 서버가 처리하지 않은 요청이라 쓰기도 안전하다).
  // null이면 갱신할 수 없는 것이다.
  readonly refreshAccessToken?: () => Promise<string | null>
  readonly onUnauthorized?: (error: ApiError) => void
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

export interface ApiClient {
  request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>
}

const DEFAULT_TIMEOUT_MS = 15_000

function buildUrl(baseUrl: string, path: string, query: RequestOptions['query']): string {
  const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // 요청 한 번(토큰은 호출하는 쪽이 정한다). 응답 본문까지 읽어 성공 값 또는 던질 오류를 돌려준다.
  async function attempt(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
    token: string | null,
  ): Promise<{ ok: true; body: unknown } | { ok: false; error: ApiError }> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort)

    let response: Response
    try {
      response = await doFetch(buildUrl(deps.baseUrl, path, options.query), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      })
    } catch (cause) {
      if (options.signal?.aborted && !timedOut) throw cause // 호출한 쪽이 취소한 것
      throw new NetworkError(timedOut ? '서버 응답이 늦어요.' : '서버에 연결하지 못했어요.', timedOut)
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }

    const body = await readJson(response)
    return response.ok ? { ok: true, body } : { ok: false, error: parseApiError(response.status, body) }
  }

  return {
    async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
      const useAuth = options.auth !== false
      const token = useAuth && deps.getAccessToken !== undefined ? await deps.getAccessToken() : null
      let result = await attempt(method, path, options, token || null)

      if (!result.ok && result.error.isUnauthorized && useAuth && token && deps.refreshAccessToken !== undefined) {
        const fresh = await deps.refreshAccessToken()
        if (fresh && fresh !== token) result = await attempt(method, path, options, fresh)
      }

      if (!result.ok) {
        if (result.error.isUnauthorized && useAuth) deps.onUnauthorized?.(result.error)
        throw result.error
      }
      return result.body as T
    },
  }
}
