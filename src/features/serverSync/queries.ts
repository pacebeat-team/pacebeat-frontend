import { queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Api } from '../../lib/api/endpoints.ts'
import { queryKeys } from '../../lib/api/queryKeys.ts'
import type { RunCreateRequest, RunReflectionPayload, UserProfileUpdateRequest } from '../../lib/api/types.ts'
import { parseRunList } from './runMapper.ts'

// 서버 데이터용 Query·Mutation 옵션(순수 팩토리). 컴포넌트가 fetch를 직접 부르지 않고 이 옵션을 useQuery/useMutation에 넘긴다.
// 아직 화면에 연결하지 않았다(화면 PR 병합 후 연결).
export const apiQueries = {
  profile: (api: Api) => queryOptions({ queryKey: queryKeys.profile(), queryFn: () => api.users.getMe() }),
  baseline: (api: Api) => queryOptions({ queryKey: queryKeys.baseline(), queryFn: () => api.users.getBaseline() }),
  // 날짜 범위(from/to)는 그대로 전달한다(형식은 백엔드 확인 필요). 응답 형식이 확인된 모양(최상위 배열)이 아니면 null이다.
  runs: (api: Api, range: { from?: string; to?: string } = {}) =>
    queryOptions({ queryKey: queryKeys.runs(range), queryFn: async () => parseRunList(await api.runs.list(range)) }),
  run: (api: Api, runId: string) => queryOptions({ queryKey: queryKeys.run(runId), queryFn: () => api.runs.get(runId) }),
}

// 변경 후 관련 캐시를 무효화한다. 서버가 돌려준 값은 그대로 캐시에 넣지 않고 다시 조회하게 한다.
export const apiMutations = {
  updateProfile: (api: Api, client: QueryClient) => ({
    mutationFn: (body: UserProfileUpdateRequest) => api.users.updateMe(body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.profile() }),
  }),
  createRun: (api: Api, client: QueryClient) => ({
    mutationFn: (body: RunCreateRequest) => api.runs.create(body),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['runs'] }),
        client.invalidateQueries({ queryKey: ['growth'] }),
        client.invalidateQueries({ queryKey: queryKeys.home() }),
      ]),
  }),
  updateReflection: (api: Api, client: QueryClient) => ({
    mutationFn: (v: { runId: string; reflection: RunReflectionPayload }) => api.runs.updateReflection(v.runId, v.reflection),
    onSuccess: (_data: unknown, v: { runId: string }) => client.invalidateQueries({ queryKey: queryKeys.run(v.runId) }),
  }),
}
