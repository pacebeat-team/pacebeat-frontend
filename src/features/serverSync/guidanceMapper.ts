import type { GuidanceSettingsPayload } from '../../lib/api/types.ts'

// 로컬 안내 설정 ↔ 서버 GuidanceSettingsPayload (순수 함수).
// 서버에 대응이 분명한 것은 음성 안내(voiceGuide ↔ voice_guidance_enabled) 하나뿐이다.
// 박자 안내·안내 빈도(perKm/offPace/both)·자동 일시정지는 서버 필드가 없거나(guidance_frequency_km는 숫자 km라 선택지와 맞지 않는다) 의미가 달라,
// 억지로 매핑하지 않고 로컬 값을 그대로 둔다. 서버의 진동 필드는 로컬에 대응 설정이 없어 읽지도 쓰지도 않는다.
export const UNMAPPED_GUIDANCE_FIELDS = ['beatGuide', 'frequency', 'autoPause'] as const

export function toGuidancePayload(settings: { readonly voiceGuide: boolean }): GuidanceSettingsPayload {
  return { voice_guidance_enabled: settings.voiceGuide }
}

// 서버 값을 로컬 설정에 반영한다. 서버가 불리언을 주지 않으면 로컬 값을 유지한다.
// 로컬 설정의 나머지 필드(박자 안내·빈도·자동 일시정지)는 형태를 가정하지 않고 그대로 돌려준다.
export function mergeServerGuidance<T extends { readonly voiceGuide: boolean }>(local: T, server: GuidanceSettingsPayload | null | undefined): T {
  if (server === null || server === undefined || typeof server.voice_guidance_enabled !== 'boolean') return local
  return server.voice_guidance_enabled === local.voiceGuide ? local : { ...local, voiceGuide: server.voice_guidance_enabled }
}
