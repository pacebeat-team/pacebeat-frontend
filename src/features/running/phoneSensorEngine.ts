// 핸드폰 멀티 센서(GPS Geolocation 속도/위치 + 가속도계 DeviceMotion 보행 피크 감지) 기반 실시간 속도·페이스·BPM(케이던스) 엔진 (순수 함수 + 센서 구독기).
// - boundary.test.ts 규칙을 준수하기 위해 features/running 외부 모듈을 가져오지 않는다.
// - 가속도계(accelerationIncludingGravity / acceleration)의 3축 합성 크기(magnitude)에서 중력 성분을 저역 통과 필터로 분리하고,
//   동적 가속도 피크 간격(250ms ~ 1200ms, 즉 50 ~ 240 SPM/BPM)으로 실시간 걸음 수와 케이던스(BPM)를 계산한다.
// - GPS 유효 속도(m/s)가 없을 때도 보행 케이던스(BPM)와 보폭 추정(약 0.72m ~ 1.05m)으로 보조 속도·페이스를 산출해 실내/도심 음영 지역에서도 실시간 반응을 제공한다.

export interface AccelSample {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly atMs: number
}

export interface StepSensorConfig {
  // 피크로 인정할 최소 동적 가속도 크기(m/s^2). 손 흔들림 노이즈를 걸러내고 발걸음 충격을 감지한다.
  readonly peakThresholdMps2: number
  // 두 걸음 사이의 최소 간격(ms). 250ms = 최대 240 BPM
  readonly minStepIntervalMs: number
  // 연속 보행으로 인정할 최대 간격(ms). 1500ms = 최소 40 BPM
  readonly maxStepIntervalMs: number
  // 실시간 BPM을 계산할 최근 걸음 시각 창(ms)
  readonly bpmWindowMs: number
  // 최근 걸음이 이 시간(ms) 이상 없으면 정지로 보고 실시간 BPM을 null로 둔다.
  readonly idleTimeoutMs: number
}

export const DEFAULT_STEP_SENSOR_CONFIG: StepSensorConfig = Object.freeze({
  peakThresholdMps2: 1.85,
  minStepIntervalMs: 250,
  maxStepIntervalMs: 1500,
  bpmWindowMs: 8000,
  idleTimeoutMs: 4000,
})

export interface StepDetectorState {
  // 저역 통과 필터로 추정한 중력 가속도 크기(초기값 9.81)
  readonly gravityMps2: number
  // 직전 샘플의 동적 가속도 크기(상승 → 하강 피크 판정용)
  readonly prevDynamicMps2: number
  readonly rising: boolean
  readonly lastStepAtMs: number | null
  readonly stepCount: number
  // 최근 걸음 시각 목록(bpmWindowMs 안의 시각만 유지)
  readonly recentStepTimesMs: readonly number[]
}

export function createStepDetectorState(): StepDetectorState {
  return {
    gravityMps2: 9.81,
    prevDynamicMps2: 0,
    rising: false,
    lastStepAtMs: null,
    stepCount: 0,
    recentStepTimesMs: [],
  }
}

export interface StepFeedResult {
  readonly state: StepDetectorState
  readonly stepDetected: boolean
}

// 가속도 샘플 1개를 입력받아 걸음 피크 여부를 판정하고 상태를 갱신한다(순수 함수).
export function feedAccelSample(
  state: StepDetectorState,
  sample: AccelSample,
  config: StepSensorConfig = DEFAULT_STEP_SENSOR_CONFIG,
): StepFeedResult {
  const { x, y, z, atMs } = sample
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(atMs)) {
    return { state, stepDetected: false }
  }

  const magnitude = Math.hypot(x, y, z)
  // 중력 성분을 완만하게 추적(alpha = 0.85)하고 순수 충격 성분(dynamic)만 분리한다.
  const gravity = state.gravityMps2 * 0.85 + magnitude * 0.15
  const dynamic = Math.max(0, magnitude - gravity)

  const wasRising = state.rising
  const isNowFalling = dynamic < state.prevDynamicMps2
  const peakValue = state.prevDynamicMps2
  const sinceLastStep = state.lastStepAtMs === null ? Infinity : atMs - state.lastStepAtMs

  const isPeak =
    wasRising &&
    isNowFalling &&
    peakValue >= config.peakThresholdMps2 &&
    sinceLastStep >= config.minStepIntervalMs

  const windowStart = atMs - config.bpmWindowMs
  if (!isPeak) {
    return {
      state: {
        ...state,
        gravityMps2: gravity,
        prevDynamicMps2: dynamic,
        rising: dynamic > state.prevDynamicMps2,
        recentStepTimesMs: state.recentStepTimesMs.filter((t) => t >= windowStart),
      },
      stepDetected: false,
    }
  }

  // 이전 걸음과의 간격이 maxStepIntervalMs보다 벌어졌으면 새 보행 구간의 첫 걸음으로 시작한다.
  const kept =
    sinceLastStep <= config.maxStepIntervalMs
      ? state.recentStepTimesMs.filter((t) => t >= windowStart)
      : []

  return {
    state: {
      gravityMps2: gravity,
      prevDynamicMps2: dynamic,
      rising: false,
      lastStepAtMs: atMs,
      stepCount: state.stepCount + 1,
      recentStepTimesMs: [...kept, atMs],
    },
    stepDetected: true,
  }
}

export interface LiveSensorReading {
  // 실시간 보행 케이던스(BPM / SPM, 정수). 최근 걸음이 부족하거나 정지 상태면 null
  readonly cadenceBpm: number | null
  // 세션 누적 걸음 수
  readonly stepCount: number
  // 센서 융합 실시간 속도(m/s). GPS 속도가 있으면 우선하고, 없을 때는 케이던스 기반 추정 속도를 제공
  readonly speedMps: number | null
  // 센서 융합 실시간 속도(km/h, 소수 첫째 자리 반올림 전 원본)
  readonly speedKmh: number | null
  // 센서 융합 실시간 페이스(sec/km, 정수)
  readonly paceSecPerKm: number | null
  // 속도·페이스의 데이터 출처: 'gps'(GPS 실측), 'motion'(모션 센서 추정), null(정지/데이터 없음)
  readonly source: 'gps' | 'motion' | null
}

// 현재 시각(nowMs)과 GPS 페이스(초/km, 있으면 우선)를 결합해 실시간 속도(km/h)·페이스·BPM을 계산한다.
export function getLiveSensorReading(
  state: StepDetectorState,
  nowMs: number,
  gpsPaceSecPerKm: number | null,
  config: StepSensorConfig = DEFAULT_STEP_SENSOR_CONFIG,
): LiveSensorReading {
  let cadenceBpm: number | null = null
  if (
    state.lastStepAtMs !== null &&
    Number.isFinite(nowMs) &&
    nowMs - state.lastStepAtMs <= config.idleTimeoutMs
  ) {
    const validSteps = state.recentStepTimesMs.filter((t) => nowMs - t <= config.bpmWindowMs)
    if (validSteps.length >= 2) {
      const first = validSteps[0]!
      const last = validSteps[validSteps.length - 1]!
      const spanMs = last - first
      if (spanMs > 0) {
        const rawBpm = Math.round(((validSteps.length - 1) * 60_000) / spanMs)
        if (rawBpm >= 45 && rawBpm <= 240) {
          cadenceBpm = rawBpm
        }
      }
    }
  }

  // 1) GPS 실시간 페이스가 유효하면 GPS 속도/페이스를 우선 사용한다.
  if (gpsPaceSecPerKm !== null && Number.isFinite(gpsPaceSecPerKm) && gpsPaceSecPerKm > 0) {
    const speedMps = 1000 / gpsPaceSecPerKm
    // GPS는 유효하지만 모션 센서가 없는 기기(PC/미지원 브라우저)에서는 현재 러닝 속도에 대응하는 표준 러닝 케이던스(BPM)를 산출한다.
    const effectiveBpm = cadenceBpm ?? estimateBpmFromPace(gpsPaceSecPerKm)
    return {
      cadenceBpm: effectiveBpm,
      stepCount: state.stepCount,
      speedMps,
      speedKmh: speedMps * 3.6,
      paceSecPerKm: Math.round(gpsPaceSecPerKm),
      source: 'gps',
    }
  }

  // 2) GPS 페이스가 아직 없거나 음영 지역일 때 모션 센서 보행 BPM이 있으면 보폭 모델로 실시간 속도·페이스를 추정한다.
  if (cadenceBpm !== null) {
    // 케이던스(BPM)에 따른 동적 보폭(m): 120 BPM → 0.72m, 160 BPM → 0.90m, 180 BPM → 1.00m
    const estimatedStrideM = Math.min(1.15, Math.max(0.65, 0.7 + ((cadenceBpm - 120) / 60) * 0.3))
    const speedMps = (cadenceBpm / 60) * estimatedStrideM
    if (speedMps >= 0.5) {
      const paceSecPerKm = Math.round(1000 / speedMps)
      return {
        cadenceBpm,
        stepCount: state.stepCount,
        speedMps,
        speedKmh: speedMps * 3.6,
        paceSecPerKm,
        source: 'motion',
      }
    }
  }

  return {
    cadenceBpm,
    stepCount: state.stepCount,
    speedMps: null,
    speedKmh: null,
    paceSecPerKm: null,
    source: null,
  }
}

// 모션 센서가 없는 환경에서 GPS 페이스(초/km)로부터 러닝 리듬(BPM)을 역산한다 (예: 7:00/km → 152 BPM, 6:00/km → 162 BPM, 5:00/km → 174 BPM).
export function estimateBpmFromPace(paceSecPerKm: number): number | null {
  if (!Number.isFinite(paceSecPerKm) || paceSecPerKm <= 0) return null
  const clamped = Math.min(600, Math.max(240, paceSecPerKm))
  // 420초(7:00/km) 기준 154 BPM, 60초 빨라질 때마다 약 +9 BPM
  const bpm = Math.round(154 + ((420 - clamped) / 60) * 9)
  return Math.min(200, Math.max(120, bpm))
}

// 현재 페이스와 구간 안내 목표 페이스를 비교해 코칭 상태와 추천 리듬(BPM)을 돌려준다.
export type StagePaceMatchStatus = 'on_pace' | 'slow_down' | 'speed_up' | 'waiting'

export interface LiveStageCoaching {
  readonly status: StagePaceMatchStatus
  readonly targetBpm: number | null
  // 목표 페이스 대비 차이(초/km). 음수면 목표보다 빠름, 양수면 목표보다 느림
  readonly paceDeltaSec: number | null
}

// 허용 오차(±12초/km 안이면 목표 페이스 유지 중으로 판정)
export const STAGE_PACE_TOLERANCE_SEC = 12

export function evaluateStageCoaching(
  currentPaceSecPerKm: number | null,
  targetStagePaceSecPerKm: number | null,
  selectedTrackBpm: number | null,
): LiveStageCoaching {
  const targetBpm =
    selectedTrackBpm ?? (targetStagePaceSecPerKm !== null ? estimateBpmFromPace(targetStagePaceSecPerKm) : null)

  if (
    currentPaceSecPerKm === null ||
    targetStagePaceSecPerKm === null ||
    !Number.isFinite(currentPaceSecPerKm) ||
    !Number.isFinite(targetStagePaceSecPerKm)
  ) {
    return { status: 'waiting', targetBpm, paceDeltaSec: null }
  }

  const delta = Math.round(currentPaceSecPerKm - targetStagePaceSecPerKm)
  if (Math.abs(delta) <= STAGE_PACE_TOLERANCE_SEC) {
    return { status: 'on_pace', targetBpm, paceDeltaSec: delta }
  }
  return {
    status: delta > 0 ? 'speed_up' : 'slow_down',
    targetBpm,
    paceDeltaSec: delta,
  }
}

// ---------------------------------------------------------------------------
// TTS 음성 코칭 판정 및 Web Speech API 출력 (오차 범위 ±12초 초과 시 + 쿨타임 25초)
// ---------------------------------------------------------------------------
export const VOICE_COACHING_COOLDOWN_MS = 25_000

export const VOICE_COACHING_MESSAGES: Readonly<Record<'speed_up' | 'slow_down', string>> = Object.freeze({
  speed_up: '목표보다 조금 느려요. 박자에 맞춰 보폭을 높여요.',
  slow_down: '목표보다 빨라요. 리듬을 조금 늦춰도 좋아요.',
})

export interface VoiceCoachingTrackerState {
  readonly lastSpokenAtMs: number | null
  readonly lastSpokenStatus: StagePaceMatchStatus | null
}

export function createVoiceCoachingTracker(): VoiceCoachingTrackerState {
  return { lastSpokenAtMs: null, lastSpokenStatus: null }
}

export interface VoiceCoachingDecisionInput {
  readonly voiceGuideEnabled: boolean
  readonly soundOn: boolean
  readonly isRunning: boolean
  readonly coachingStatus: StagePaceMatchStatus
  readonly nowMs: number
  readonly cooldownMs?: number
}

export interface VoiceCoachingDecision {
  readonly shouldSpeak: boolean
  readonly text: string | null
  readonly nextState: VoiceCoachingTrackerState
}

// 유저가 설정에서 음성 안내를 켰고(voiceGuideEnabled === true), 진행 화면 오디오 토글이 켜져 있으며(soundOn === true),
// 오차 범위 ±12초/km를 벗어나 speed_up 또는 slow_down 상태일 때만 쿨타임(기본 25초) 간격으로 음성 멘트를 출력한다.
export function decideVoiceCoaching(
  tracker: VoiceCoachingTrackerState,
  input: VoiceCoachingDecisionInput,
): VoiceCoachingDecision {
  const cooldownMs = input.cooldownMs ?? VOICE_COACHING_COOLDOWN_MS
  if (!input.isRunning || !input.voiceGuideEnabled || !input.soundOn) {
    return { shouldSpeak: false, text: null, nextState: tracker }
  }
  if (input.coachingStatus !== 'speed_up' && input.coachingStatus !== 'slow_down') {
    return {
      shouldSpeak: false,
      text: null,
      nextState:
        tracker.lastSpokenStatus === input.coachingStatus
          ? tracker
          : { ...tracker, lastSpokenStatus: input.coachingStatus },
    }
  }

  const sinceLast =
    tracker.lastSpokenAtMs === null || !Number.isFinite(input.nowMs)
      ? Infinity
      : input.nowMs - tracker.lastSpokenAtMs
  const statusChanged = tracker.lastSpokenStatus !== input.coachingStatus

  // 상태가 새로 벗어났고 최소 8초 이상 지났거나, 같은 벗어남 상태가 쿨타임(25초) 이상 지속되면 안내
  const readyByTime = statusChanged ? sinceLast >= 8_000 : sinceLast >= cooldownMs
  if (!readyByTime) {
    return { shouldSpeak: false, text: null, nextState: tracker }
  }

  return {
    shouldSpeak: true,
    text: VOICE_COACHING_MESSAGES[input.coachingStatus],
    nextState: {
      lastSpokenAtMs: input.nowMs,
      lastSpokenStatus: input.coachingStatus,
    },
  }
}

export function speakKoreanCoaching(text: string): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ko-KR'
    utterance.rate = 1.02
    window.speechSynthesis.speak(utterance)
  } catch {
    // 브라우저 TTS 미지원 또는 권한 차단 시 무시
  }
}

// 브라우저 DeviceMotionEvent 구독기. 지원하지 않는 환경에서도 예외 없이 동작한다.
export interface MotionSource {
  start(): void
  stop(): void
  readonly isRunning: boolean
}

export function createDeviceMotionSource(
  onSample: (sample: AccelSample) => void,
  now: () => number = Date.now,
): MotionSource {
  let active = false
  let listener: ((event: Event) => void) | null = null

  function requestIosPermissionIfNeeded(): void {
    try {
      const DeviceMotion = (globalThis as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } })
        .DeviceMotionEvent
      if (typeof DeviceMotion?.requestPermission === 'function') {
        void DeviceMotion.requestPermission().catch(() => undefined)
      }
    } catch {
      // 권한 요청 실패 무시
    }
  }

  return {
    start() {
      if (active || typeof window === 'undefined') return
      requestIosPermissionIfNeeded()
      active = true
      listener = (rawEvent: Event) => {
        if (!active) return
        const event = rawEvent as {
          accelerationIncludingGravity?: { x?: number | null; y?: number | null; z?: number | null } | null
          acceleration?: { x?: number | null; y?: number | null; z?: number | null } | null
        }
        const acc = event.accelerationIncludingGravity ?? event.acceleration
        if (!acc) return
        const x = acc.x ?? 0
        const y = acc.y ?? 0
        const z = acc.z ?? 0
        onSample({ x, y, z, atMs: now() })
      }
      window.addEventListener('devicemotion', listener)
    },
    stop() {
      if (!active) return
      active = false
      if (listener !== null && typeof window !== 'undefined') {
        window.removeEventListener('devicemotion', listener)
      }
      listener = null
    },
    get isRunning() {
      return active
    },
  }
}
