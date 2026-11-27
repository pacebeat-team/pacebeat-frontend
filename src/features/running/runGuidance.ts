// 러닝 세션이 시작할 때 고정하는 안내 설정(스냅샷).
// - 안내 설정 화면의 저장값(features/my)을 러닝 시작 시점에 한 번 복사해 세션에 붙인다. 진행 중 설정 화면에서 값을 바꿔도 이 세션은 바뀌지 않고, 다음 러닝부터 새 값이 적용된다.
// - features/my는 이 모듈이 가져올 수 없어(경계 규칙) 같은 모양의 타입과 기본값을 여기에 둔다. 두 기본값이 같은지는 테스트가 확인한다.
// - 지금 이 스냅샷을 읽어 동작하는 기능은 없다. 음악 박자·음성(TTS) 안내·안내 빈도는 아직 구현되지 않았고, 자동 일시정지는 발동 조건이 확정되지 않아 연결하지 않았다.
//   (스냅샷은 나중에 각 기능이 "시작 시점의 설정"을 읽을 자리이다.)

export type RunGuidanceFrequency = 'perKm' | 'offPace' | 'both'

export interface RunGuidance {
  readonly beatGuide: boolean
  readonly voiceGuide: boolean
  readonly frequency: RunGuidanceFrequency
  readonly autoPause: boolean
}

export const DEFAULT_RUN_GUIDANCE: RunGuidance = Object.freeze({
  beatGuide: true,
  voiceGuide: false,
  frequency: 'offPace',
  autoPause: true,
})

const FREQUENCIES: readonly RunGuidanceFrequency[] = ['perKm', 'offPace', 'both']

// 값을 스냅샷으로 정규화한다. 객체가 아니면 기본값이고, 항목이 없거나 알 수 없는 값이면 그 항목만 기본값이다. 허용하지 않은 필드는 버린다.
export function normalizeRunGuidance(value: unknown): RunGuidance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_RUN_GUIDANCE
  const data = value as Record<string, unknown>
  const d = DEFAULT_RUN_GUIDANCE
  return {
    beatGuide: typeof data.beatGuide === 'boolean' ? data.beatGuide : d.beatGuide,
    voiceGuide: typeof data.voiceGuide === 'boolean' ? data.voiceGuide : d.voiceGuide,
    frequency: FREQUENCIES.includes(data.frequency as RunGuidanceFrequency) ? (data.frequency as RunGuidanceFrequency) : d.frequency,
    autoPause: typeof data.autoPause === 'boolean' ? data.autoPause : d.autoPause,
  }
}

// 세션에 고정된 안내 설정. 스냅샷이 없는 세션(이 기능 이전에 시작·저장된 세션)은 기본값이다.
export function getSessionGuidance(session: { readonly guidance?: RunGuidance } | null): RunGuidance {
  return normalizeRunGuidance(session?.guidance)
}
