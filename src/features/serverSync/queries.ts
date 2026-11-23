import { queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Api } from '../../lib/api/endpoints.ts'
import { queryKeys } from '../../lib/api/queryKeys.ts'
import type { FullGuidancePayload, GrowthPeriodType, RunCreateRequest, RunReflectionPayload, UserProfileUpdateRequest } from '../../lib/api/types.ts'
import { parseMusicPresets } from './musicMapper.ts'
import { parseRunList } from './runMapper.ts'

// 서버 데이터용 Query·Mutation 옵션(순수 팩토리). 컴포넌트가 fetch를 직접 부르지 않고 이 옵션을 useQuery/useMutation에 넘긴다.
// 아직 화면에 연결하지 않았다(화면 PR 병합 후 연결).
export const apiQueries = {
  profile: (api: Api) => queryOptions({ queryKey: queryKeys.profile(), queryFn: () => api.users.getMe() }),
  // 응답은 parseMusicPresets로 걸러 쓴다(누락·잘못된 항목에 안전).
  musicPresets: (api: Api) => queryOptions({ queryKey: queryKeys.musicPresets(), queryFn: async () => parseMusicPresets(await api.runs.musicPresets()) }),
  baseline: (api: Api) => queryOptions({ queryKey: queryKeys.baseline(), queryFn: () => api.users.getBaseline() }),
  // 날짜 범위(from/to)는 그대로 전달한다(형식은 백엔드 확인 필요). 응답 형식이 확인된 모양(최상위 배열)이 아니면 null이다.
  runs: (api: Api, range: { from?: string; to?: string } = {}) =>
    queryOptions({ queryKey: queryKeys.runs(range), queryFn: async () => parseRunList(await api.runs.list(range)) }),
  growthRunning: (api: Api, period: GrowthPeriodType) => queryOptions({ queryKey: queryKeys.growthRunning(period), queryFn: () => api.growth.running(period) }),
  growthPosture: (api: Api, period: GrowthPeriodType) => queryOptions({ queryKey: queryKeys.growthPosture(period), queryFn: () => api.growth.posture(period) }),
  insoles: (api: Api) => queryOptions({ queryKey: queryKeys.insoles(), queryFn: () => api.devices.getInsoles() }),
  run: (api: Api, runId: string) => queryOptions({ queryKey: queryKeys.run(runId), queryFn: () => api.runs.get(runId) }),
}

// 변경 후 관련 캐시를 무효화한다. 서버가 돌려준 값은 그대로 캐시에 넣지 않고 다시 조회하게 한다.
export const apiMutations = {
  // 안내 설정은 서버가 4개 필드를 전부 교체하므로 전체 payload로만 보낸다(guidanceMapper.toFullGuidancePayload).
  updateGuidance: (api: Api, client: QueryClient) => ({
    mutationFn: (body: FullGuidancePayload) => api.users.updateGuidance(body),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.profile() }),
  }),
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
