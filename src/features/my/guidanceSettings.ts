// 안내 설정(08 SETTINGS / Guidance)의 값과 저장 형식 (순수 함수).
// 이 값은 화면의 설정으로만 저장한다. 러닝 중 음성·박자·자동 일시정지 동작에는 아직 연결하지 않는다.
// 저장 키는 다른 저장소(러닝 기록·프로필·온보딩·측정)와 분리한다.

export const GUIDANCE_STORAGE_KEY = 'pacebeat:guidance-settings:v1'
export const GUIDANCE_STORAGE_VERSION = 1

// Figma 선택지: 1km마다 / 벗어날 때만 / 둘 다
export type GuidanceFrequency = 'perKm' | 'offPace' | 'both'
export const GUIDANCE_FREQUENCIES: readonly GuidanceFrequency[] = ['perKm', 'offPace', 'both']

export interface GuidanceSettings {
  // 음악 박자 안내
  readonly beatGuide: boolean
  // 음성 안내
  readonly voiceGuide: boolean
  readonly frequency: GuidanceFrequency
  // 자동 일시정지
  readonly autoPause: boolean
}

// Figma 기본 상태: 음악 박자 안내·음성 안내·자동 일시정지 켜짐, 안내 빈도 "벗어날 때만".
// 박자 자동 조절(준비 중)과 진동(미지원)은 값이 아니라 고정된 꺼짐 표시라서 저장하지 않는다.
export const DEFAULT_GUIDANCE_SETTINGS: GuidanceSettings = Object.freeze({
  beatGuide: true,
  voiceGuide: true,
  frequency: 'offPace',
  autoPause: true,
})

export interface GuidanceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 저장된 문자열을 설정으로 읽는다. 없거나 깨졌거나 버전이 다르면 기본값이다.
// 알 수 없는 항목이 있으면 그 항목만 기본값으로 되돌린다.
export function parseGuidanceSettings(raw: string | null): GuidanceSettings {
  if (raw === null) return DEFAULT_GUIDANCE_SETTINGS
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return DEFAULT_GUIDANCE_SETTINGS
  }
  if (!isRecord(json) || json.version !== GUIDANCE_STORAGE_VERSION || !isRecord(json.data)) return DEFAULT_GUIDANCE_SETTINGS
  const { data } = json
  const d = DEFAULT_GUIDANCE_SETTINGS
  return {
    beatGuide: typeof data.beatGuide === 'boolean' ? data.beatGuide : d.beatGuide,
    voiceGuide: typeof data.voiceGuide === 'boolean' ? data.voiceGuide : d.voiceGuide,
    frequency: GUIDANCE_FREQUENCIES.includes(data.frequency as GuidanceFrequency) ? (data.frequency as GuidanceFrequency) : d.frequency,
    autoPause: typeof data.autoPause === 'boolean' ? data.autoPause : d.autoPause,
  }
}

export function serializeGuidanceSettings(settings: GuidanceSettings): string {
  return JSON.stringify({ version: GUIDANCE_STORAGE_VERSION, data: settings })
}

// 저장소에서 읽는다. 저장소에 접근할 수 없어도 기본값을 돌려준다.
export function loadGuidanceSettings(storage: GuidanceStorage | null): GuidanceSettings {
  if (storage === null) return DEFAULT_GUIDANCE_SETTINGS
  try {
    return parseGuidanceSettings(storage.getItem(GUIDANCE_STORAGE_KEY))
  } catch {
    return DEFAULT_GUIDANCE_SETTINGS
  }
}

// 저장에 성공했는가. 실패해도 예외를 던지지 않는다.
export function saveGuidanceSettings(storage: GuidanceStorage | null, settings: GuidanceSettings): boolean {
  if (storage === null) return false
  try {
    storage.setItem(GUIDANCE_STORAGE_KEY, serializeGuidanceSettings(settings))
    return true
  } catch {
    return false
  }
}

export const FREQUENCY_LABEL: Record<GuidanceFrequency, string> = {
  perKm: '1 km마다',
  offPace: '벗어날 때만',
  both: '둘 다',
}
