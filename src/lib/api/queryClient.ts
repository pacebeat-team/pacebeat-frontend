import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './errors.ts'

// 서버 데이터 캐시 설정. 서버가 응답한 4xx(검증·인증·권한·없음)는 다시 시도해도 같으므로 재시도하지 않는다.
// 네트워크 오류와 5xx만 한 번 더 시도한다. 쓰기(mutation)는 자동 재시도하지 않는다.
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false
  return failureCount < 1
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery, refetchOnWindowFocus: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  })
}
