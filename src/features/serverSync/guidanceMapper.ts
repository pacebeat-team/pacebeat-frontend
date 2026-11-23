import type { FullGuidancePayload, GuidanceSettingsPayload } from '../../lib/api/types.ts'

// 로컬 안내 설정 ↔ 서버 GuidanceSettingsPayload (순수 함수).
// 서버에 대응이 분명한 것은 음성 안내(voiceGuide ↔ voice_guidance_enabled) 하나뿐이다.
// 박자 안내·안내 빈도(perKm/offPace/both)·자동 일시정지는 서버 필드가 없거나(guidance_frequency_km는 숫자 km라 선택지와 맞지 않는다) 의미가 달라,
// 억지로 매핑하지 않고 로컬 값을 그대로 둔다. 서버의 진동 필드는 로컬에 대응 설정이 없어 읽지도 쓰지도 않는다.
export const UNMAPPED_GUIDANCE_FIELDS = ['beatGuide', 'frequency', 'autoPause'] as const

// 서버 PATCH /users/me/guidance는 4개 필드를 전부 교체한다(생략한 필드는 서버 기본값으로 초기화됨: 백엔드 update_my_guidance).
// 그래서 일부만 보내지 않고, 서버의 현재 값 위에 로컬이 소유한 필드(음성 안내)만 덮은 전체 payload를 만든다.
// 서버의 현재 값 4개가 모두 계약(OpenAPI)에 맞을 때만 만든다. 하나라도 없거나(누락·null) 타입·범위가 틀리면 null을 돌려준다:
// 그 필드를 기본값이나 추측값으로 채워 보내면 사용자의 다른 설정을 덮어쓰게 되기 때문이다(호출하는 쪽은 보내지 않고 대기를 유지한다).
// 서버 기본값은 시뮬레이션·문서용이며 전송 보정에는 쓰지 않는다.
export const SERVER_GUIDANCE_DEFAULTS: FullGuidancePayload = Object.freeze({
  voice_guidance_enabled: true,
  vibration_guidance_enabled: true,
  guidance_frequency_km: 1,
  vibration_intensity: 'medium',
})
const INTENSITIES: readonly string[] = ['low', 'medium', 'high']

// 서버 응답의 안내 설정 4개가 모두 유효한가(타입·범위). 유효하면 그대로 돌려주고, 아니면 null.
export function readServerGuidance(server: unknown): FullGuidancePayload | null {
  if (typeof server !== 'object' || server === null || Array.isArray(server)) return null
  const s = server as Record<string, unknown>
  const km = s.guidance_frequency_km
  if (typeof s.voice_guidance_enabled !== 'boolean' || typeof s.vibration_guidance_enabled !== 'boolean') return null
  if (typeof km !== 'number' || !Number.isFinite(km) || km < 0.5 || km > 10) return null
  if (typeof s.vibration_intensity !== 'string' || !INTENSITIES.includes(s.vibration_intensity)) return null
  return {
    voice_guidance_enabled: s.voice_guidance_enabled,
    vibration_guidance_enabled: s.vibration_guidance_enabled,
    guidance_frequency_km: km,
    vibration_intensity: s.vibration_intensity as FullGuidancePayload['vibration_intensity'],
  }
}

export function toFullGuidancePayload(settings: { readonly voiceGuide: boolean }, server: unknown): FullGuidancePayload | null {
  const base = readServerGuidance(server)
  return base === null ? null : { ...base, voice_guidance_enabled: settings.voiceGuide }
}

// 서버 값을 로컬 설정에 반영한다. 서버가 불리언을 주지 않으면 로컬 값을 유지한다.
// 로컬 설정의 나머지 필드(박자 안내·빈도·자동 일시정지)는 형태를 가정하지 않고 그대로 돌려준다.
export function mergeServerGuidance<T extends { readonly voiceGuide: boolean }>(local: T, server: GuidanceSettingsPayload | null | undefined): T {
  if (server === null || server === undefined || typeof server.voice_guidance_enabled !== 'boolean') return local
  return server.voice_guidance_enabled === local.voiceGuide ? local : { ...local, voiceGuide: server.voice_guidance_enabled }
}
