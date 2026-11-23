import { auth } from '../auth/index.ts'
import { createApiClient } from './client.ts'
import { readApiConfig } from './config.ts'
import { createApi } from './endpoints.ts'
import { createOwnerBoundApi } from './ownerBound.ts'
import { readUserId } from '../auth/authService.ts'

export { ApiError, NetworkError, OwnerChangedError } from './errors.ts'
export { queryKeys } from './queryKeys.ts'
export type * from './types.ts'

// 앱에서 쓰는 API 진입점. VITE_API_BASE_URL이 없으면 null이다(서버 연동 꺼짐 → 기존 로컬 저장만 쓴다).
// 토큰은 Supabase Auth 세션(auth)이 공급하고, 401이면 한 번 갱신해 다시 보낸 뒤에도 401이면 세션을 만료로 처리한다.
// Supabase 설정이 없으면 토큰 없이 나가며, 인증이 필요한 요청은 서버가 401(AUTH_MISSING_TOKEN)로 거절한다. 현재 어떤 화면도 이 API를 호출하지 않는다.
const config = readApiConfig()
export const api =
  config === null
    ? null
    : createApi(
        createApiClient({
          baseUrl: config.baseUrl,
          getAccessToken: () => auth.getAccessToken(),
          refreshAccessToken: () => auth.forceRefresh(),
          onUnauthorized: () => auth.handleUnauthorized(),
        }),
      )

// 요청을 만든 계정에 묶인 API(동기화 전송·가져오기용). 서버 연동이 꺼져 있으면 null.
export function getOwnerBoundApi(userId: string) {
  return config === null ? null : createOwnerBoundApi({ baseUrl: config.baseUrl, auth: { ...auth, getState: auth.getState, readUserId }, expectedUserId: userId })
}
