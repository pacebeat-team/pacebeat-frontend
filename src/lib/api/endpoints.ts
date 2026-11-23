import type { ApiClient } from './client.ts'
import type {
  BaselineResponse,
  BaselineUpsertRequest,
  GrowthPeriodType,
  GuidanceSettingsPayload,
  HomeSummaryResponse,
  InsoleDeviceResponse,
  InsolePairSummaryResponse,
  InsoleRegisterRequest,
  InsoleSideType,
  InsoleStatusUpdateRequest,
  PostureGrowthResponse,
  RunCreateRequest,
  RunDetailResponse,
  RunReflectionPayload,
  RunningGrowthResponse,
  TargetValidateRequest,
  TargetValidateResponse,
  UserProfileResponse,
  UserProfileUpdateRequest,
} from './types.ts'

// 백엔드 OpenAPI(1.0.0)에 있는 엔드포인트의 얇은 호출 함수. 화면·Store와 연결하지 않았다(연결은 기능별 Issue에서 한다).
// 응답 스키마가 문서에 없는 엔드포인트(러닝 목록, 음악 프리셋, 데이터 내보내기)는 unknown으로 두었다. 백엔드 확인 후 타입을 정한다.
export function createApi(client: ApiClient) {
  return {
    health: () => client.request<{ status: string; database: string }>('GET', '/health', { auth: false }),

    users: {
      getMe: () => client.request<UserProfileResponse>('GET', '/api/v1/users/me'),
      updateMe: (body: UserProfileUpdateRequest) => client.request<UserProfileResponse>('PATCH', '/api/v1/users/me', { body }),
      deleteMe: () => client.request<null>('DELETE', '/api/v1/users/me'),
      getBaseline: () => client.request<BaselineResponse>('GET', '/api/v1/users/me/baseline'),
      putBaseline: (body: BaselineUpsertRequest) => client.request<BaselineResponse>('PUT', '/api/v1/users/me/baseline', { body }),
      updateGuidance: (body: GuidanceSettingsPayload) => client.request<GuidanceSettingsPayload>('PATCH', '/api/v1/users/me/guidance', { body }),
      exportData: () => client.request<unknown>('POST', '/api/v1/users/me/data-export'),
    },

    devices: {
      getInsoles: () => client.request<InsolePairSummaryResponse>('GET', '/api/v1/devices/insoles'),
      registerInsole: (body: InsoleRegisterRequest) => client.request<InsoleDeviceResponse>('POST', '/api/v1/devices/insoles', { body }),
      updateInsole: (side: InsoleSideType, body: InsoleStatusUpdateRequest) =>
        client.request<InsoleDeviceResponse>('PATCH', `/api/v1/devices/insoles/${side}`, { body }),
      unregisterInsole: (side: InsoleSideType) => client.request<null>('DELETE', `/api/v1/devices/insoles/${side}`),
    },

    home: {
      getSummary: () => client.request<HomeSummaryResponse>('GET', '/api/v1/home/summary'),
    },

    runs: {
      validateTarget: (body: TargetValidateRequest) => client.request<TargetValidateResponse>('POST', '/api/v1/runs/targets/validate', { body }),
      musicPresets: () => client.request<unknown>('GET', '/api/v1/music/presets'),
      create: (body: RunCreateRequest) => client.request<RunDetailResponse>('POST', '/api/v1/runs', { body }),
      list: (range: { from?: string; to?: string } = {}) => client.request<unknown>('GET', '/api/v1/runs', { query: { from: range.from, to: range.to } }),
      get: (runId: string) => client.request<RunDetailResponse>('GET', `/api/v1/runs/${encodeURIComponent(runId)}`),
      updateReflection: (runId: string, body: RunReflectionPayload) =>
        client.request<RunDetailResponse>('PATCH', `/api/v1/runs/${encodeURIComponent(runId)}/reflection`, { body }),
    },

    growth: {
      running: (period: GrowthPeriodType = 'weekly') => client.request<RunningGrowthResponse>('GET', '/api/v1/growth/running', { query: { period } }),
      posture: (period: GrowthPeriodType = 'weekly') => client.request<PostureGrowthResponse>('GET', '/api/v1/growth/posture', { query: { period } }),
    },
  }
}

export type Api = ReturnType<typeof createApi>
