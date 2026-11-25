import type { FullGuidancePayload, GuidanceFrequencyModeType, GuidanceSettingsPayload } from '../../lib/api/types.ts'

// 로컬 안내 설정 ↔ 서버 GuidanceSettingsPayload (순수 함수).
// 기본 OpenAPI 스냅샷 4개 필드(voice_guidance_enabled, vibration_guidance_enabled, guidance_frequency_km, vibration_intensity)를 보존하면서,
// 백엔드 확장 필드(beat_guidance_enabled, guidance_frequency_mode, auto_pause_enabled)가 전달되거나 서버 응답에 있을 때 함께 동기화한다.
export const UNMAPPED_GUIDANCE_FIELDS = ['beatGuide', 'frequency', 'autoPause'] as const

export interface LocalGuidanceSyncInput {
  readonly voiceGuide: boolean
  readonly beatGuide?: boolean
  readonly frequency?: GuidanceFrequencyModeType
  readonly autoPause?: boolean
}

export const SERVER_GUIDANCE_DEFAULTS: FullGuidancePayload = Object.freeze({
  voice_guidance_enabled: true,
  vibration_guidance_enabled: true,
  guidance_frequency_km: 1,
  vibration_intensity: 'medium',
})
const INTENSITIES: readonly string[] = ['low', 'medium', 'high']
const FREQUENCY_MODES: readonly string[] = ['perKm', 'offPace', 'both']

// 서버 응답의 안내 설정 기본 4개가 모두 유효한가(타입·범위). 유효하면 확장 필드(있을 때만)와 함께 돌려주고, 아니면 null.
export function readServerGuidance(server: unknown): FullGuidancePayload | null {
  if (typeof server !== 'object' || server === null || Array.isArray(server)) return null
  const s = server as Record<string, unknown>
  const km = s.guidance_frequency_km
  if (typeof s.voice_guidance_enabled !== 'boolean' || typeof s.vibration_guidance_enabled !== 'boolean') return null
  if (typeof km !== 'number' || !Number.isFinite(km) || km < 0.5 || km > 10) return null
  if (typeof s.vibration_intensity !== 'string' || !INTENSITIES.includes(s.vibration_intensity)) return null
  const base: FullGuidancePayload = {
    voice_guidance_enabled: s.voice_guidance_enabled,
    vibration_guidance_enabled: s.vibration_guidance_enabled,
    guidance_frequency_km: km,
    vibration_intensity: s.vibration_intensity as FullGuidancePayload['vibration_intensity'],
    ...(typeof s.beat_guidance_enabled === 'boolean' ? { beat_guidance_enabled: s.beat_guidance_enabled } : {}),
    ...(typeof s.guidance_frequency_mode === 'string' && FREQUENCY_MODES.includes(s.guidance_frequency_mode)
      ? { guidance_frequency_mode: s.guidance_frequency_mode as GuidanceFrequencyModeType }
      : {}),
    ...(typeof s.auto_pause_enabled === 'boolean' ? { auto_pause_enabled: s.auto_pause_enabled } : {}),
  }
  return base
}

export function toFullGuidancePayload(settings: LocalGuidanceSyncInput, server: unknown): FullGuidancePayload | null {
  const base = readServerGuidance(server)
  if (base === null) return null
  return {
    ...base,
    voice_guidance_enabled: settings.voiceGuide,
    ...(typeof settings.beatGuide === 'boolean' ? { beat_guidance_enabled: settings.beatGuide } : {}),
    ...(typeof settings.frequency === 'string' && FREQUENCY_MODES.includes(settings.frequency)
      ? { guidance_frequency_mode: settings.frequency }
      : {}),
    ...(typeof settings.autoPause === 'boolean' ? { auto_pause_enabled: settings.autoPause } : {}),
  }
}

// 서버 값을 로컬 설정에 반영한다. 서버가 유효한 값을 준 필드만 덮어쓰고 나머지는 로컬 값을 그대로 유지한다.
export function mergeServerGuidance<
  T extends {
    readonly voiceGuide: boolean
    readonly beatGuide?: boolean
    readonly frequency?: GuidanceFrequencyModeType
    readonly autoPause?: boolean
  },
>(local: T, server: GuidanceSettingsPayload | null | undefined): T {
  if (server === null || server === undefined) return local
  let next = local
  if (typeof server.voice_guidance_enabled === 'boolean' && server.voice_guidance_enabled !== next.voiceGuide) {
    next = { ...next, voiceGuide: server.voice_guidance_enabled }
  }
  if ('beatGuide' in local && typeof server.beat_guidance_enabled === 'boolean' && server.beat_guidance_enabled !== next.beatGuide) {
    next = { ...next, beatGuide: server.beat_guidance_enabled }
  }
  if (
    'frequency' in local &&
    typeof server.guidance_frequency_mode === 'string' &&
    FREQUENCY_MODES.includes(server.guidance_frequency_mode) &&
    server.guidance_frequency_mode !== next.frequency
  ) {
    next = { ...next, frequency: server.guidance_frequency_mode }
  }
  if ('autoPause' in local && typeof server.auto_pause_enabled === 'boolean' && server.auto_pause_enabled !== next.autoPause) {
    next = { ...next, autoPause: server.auto_pause_enabled }
  }
  return next
}
