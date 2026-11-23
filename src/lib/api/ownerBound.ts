import { createApiClient } from './client.ts'
import { OwnerChangedError } from './errors.ts'
import { createApi } from './endpoints.ts'

// 요청을 만든 계정(expectedUserId)에 묶인 API.
// 토큰은 요청 직전·갱신 직후에 비동기로 받아오므로, 그 사이에 로그아웃되거나 다른 계정으로 바뀌면 다른 계정의 토큰이 붙을 수 있다.
// 그래서 토큰을 받은 뒤 "토큰 자체의 사용자(sub)"와 현재 로그인 상태가 모두 expectedUserId인지 확인하고, 아니면 요청을 보내지 않는다(OwnerChangedError).
// 401 뒤 갱신으로 받은 토큰도 같은 검사를 거치며, 늦은 401이 현재(다른) 계정을 만료시키지도 않는다.
export interface OwnerAuth {
  getState(): { readonly status: string; readonly userId: string | null }
  getAccessToken(): Promise<string | null>
  forceRefresh(): Promise<string | null>
  handleUnauthorized(expectedUserId?: string): void
  readUserId(token: string): string | null
}

export function createOwnerBoundApi(deps: { readonly baseUrl: string; readonly auth: OwnerAuth; readonly expectedUserId: string; readonly fetch?: typeof fetch; readonly timeoutMs?: number }) {
  const { auth, expectedUserId } = deps
  const isSame = (): boolean => {
    const state = auth.getState()
    return state.status === 'signedIn' && state.userId === expectedUserId
  }
  const owns = (token: string | null): token is string => token !== null && isSame() && auth.readUserId(token) === expectedUserId
  return createApi(
    createApiClient({
      baseUrl: deps.baseUrl,
      fetch: deps.fetch,
      timeoutMs: deps.timeoutMs,
      getAccessToken: async () => {
        if (!isSame()) throw new OwnerChangedError()
        const token = await auth.getAccessToken()
        if (!owns(token)) throw new OwnerChangedError()
        return token
      },
      refreshAccessToken: async () => {
        if (!isSame()) return null
        const token = await auth.forceRefresh()
        return owns(token) ? token : null
      },
      onUnauthorized: () => auth.handleUnauthorized(expectedUserId),
    }),
  )
}
