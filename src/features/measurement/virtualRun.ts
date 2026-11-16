import { isValidCoordinate } from './geo.ts'

// 가상 러닝 시나리오 → 시간순 좌표·오류 목록 (순수 함수).
// - "어떻게 움직이고 어떤 문제가 생기는가"만 표현한다. 시간이 흐르는 것(타이머)은 virtualGeolocation.ts의 일이다.
// - 좌표 검증과 거리·페이스 계산은 하지 않는다. 가상 데이터도 실제 GPS와 같은 경로
//   (RawFix → gpsTracker → ValidFix → metrics)를 지난다.
// - 같은 시나리오는 항상 같은 결과를 낸다. 좌표 흔들림도 시드가 같으면 같다.
// - 이동과 문제 상황(GPS 끊김, 튐 등)을 따로 적는다. 실제 러닝처럼 GPS가 끊겨도 사람은 계속 움직인다.
// - ⚠️ 이 파일의 기본값은 발표용 예시 값이며 확정된 정책이 아니다.

// ---------------------------------------------------------------------------
// 시나리오 타입
// ---------------------------------------------------------------------------

export type VirtualMotion =
  // 일정한 속도로 이동. headingDeg: 진행 방향(0 = 북쪽, 90 = 동쪽). 생략하면 북쪽
  | { readonly kind: 'move'; readonly durationSec: number; readonly speedMps: number; readonly headingDeg?: number }
  // 정지(위치 고정)
  | { readonly kind: 'stop'; readonly durationSec: number }

// 시간 범위(초)에 겹쳐 쓰는 문제 상황. 범위는 [fromSec, toSec)이다.
export type VirtualCondition =
  // 좌표가 오지 않는다. emitError가 true이면 구간이 시작할 때 위치 확인 불가(코드 2) 오류도 한 번 보낸다.
  | { readonly kind: 'gps-lost'; readonly fromSec: number; readonly toSec: number; readonly emitError?: boolean }
  // 좌표가 실제 위치에서 동쪽으로 offsetM만큼 어긋난다(튐).
  | { readonly kind: 'glitch'; readonly fromSec: number; readonly toSec: number; readonly offsetM: number }
  // 정확도가 나빠진다(오차 반경이 accuracyM).
  | { readonly kind: 'poor-accuracy'; readonly fromSec: number; readonly toSec: number; readonly accuracyM: number }
  // 오류를 한 번 보낸다. 코드: 1 권한 거부, 2 위치 확인 불가, 3 시간 초과
  | { readonly kind: 'error'; readonly atSec: number; readonly code: 1 | 2 | 3 }

export interface VirtualScenario {
  // 시작 좌표. 기본: 서울시청 부근
  readonly start?: { readonly lat: number; readonly lng: number }
  // 좌표 간격(ms). 기본 1000
  readonly intervalMs?: number
  // 기본 정확도(오차 반경, m). 기본 5
  readonly accuracyM?: number
  // 첫 좌표가 늦게 오는 정도(ms). "GPS 검색 중" 연출. 기본 0
  readonly firstFixDelayMs?: number
  // 좌표의 기기 시각보다 수신이 늦는 정도(ms). 기본 0
  readonly deliveryLagMs?: number
  // 좌표 흔들림 반경(m). 기본 0(흔들림 없음). 0보다 크면 시드로 재현되는 흔들림을 더한다.
  readonly noiseM?: number
  readonly seed?: number
  readonly motion: readonly VirtualMotion[]
  readonly conditions?: readonly VirtualCondition[]
}

// 시나리오 시작 시각(0)에서 잰 시각(ms)으로 적은 사건.
export interface VirtualFixEvent {
  readonly kind: 'fix'
  // 좌표의 기기 시각(시작 시각 + offsetMs)
  readonly offsetMs: number
  // 앱이 좌표를 받는 시각(시작 시각 + deliverAtMs). offsetMs + deliveryLagMs
  readonly deliverAtMs: number
  readonly lat: number
  readonly lng: number
  readonly accuracyM: number
}

export interface VirtualErrorEvent {
  readonly kind: 'error'
  readonly deliverAtMs: number
  readonly code: number
}

export type VirtualEvent = VirtualFixEvent | VirtualErrorEvent

// ---------------------------------------------------------------------------
// 기본값과 검증
// ---------------------------------------------------------------------------

const DEFAULT_START = { lat: 37.5665, lng: 126.978 }
const DEFAULT_INTERVAL_MS = 1000
const DEFAULT_ACCURACY_M = 5

// 위도 1°의 길이(m). geo.ts의 지구 반지름(6,371,000m)과 같은 값을 써서 거리 계산과 맞춘다.
const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180

function requireNumber(name: string, value: number, min: number, inclusive: boolean): void {
  const ok = Number.isFinite(value) && (inclusive ? value >= min : value > min)
  if (!ok) {
    throw new RangeError(`가상 시나리오의 ${name} 값이 올바르지 않습니다: ${value}`)
  }
}

const requireFinite = (name: string, value: number) =>
  requireNumber(name, value, Number.NEGATIVE_INFINITY, false)
const requireNonNegative = (name: string, value: number) => requireNumber(name, value, 0, true)
const requirePositive = (name: string, value: number) => requireNumber(name, value, 0, false)

function validateScenario(scenario: VirtualScenario): void {
  if (scenario.start !== undefined && !isValidCoordinate(scenario.start.lat, scenario.start.lng)) {
    throw new RangeError('가상 시나리오의 시작 좌표가 올바르지 않습니다.')
  }
  if (scenario.intervalMs !== undefined) requirePositive('intervalMs', scenario.intervalMs)
  if (scenario.accuracyM !== undefined) requirePositive('accuracyM', scenario.accuracyM)
  if (scenario.firstFixDelayMs !== undefined) requireNonNegative('firstFixDelayMs', scenario.firstFixDelayMs)
  if (scenario.deliveryLagMs !== undefined) requireNonNegative('deliveryLagMs', scenario.deliveryLagMs)
  if (scenario.noiseM !== undefined) requireNonNegative('noiseM', scenario.noiseM)
  if (scenario.seed !== undefined) requireFinite('seed', scenario.seed)

  for (const motion of scenario.motion) {
    requireNonNegative('motion.durationSec', motion.durationSec)
    if (motion.kind === 'move') {
      requireNonNegative('motion.speedMps', motion.speedMps)
      if (motion.headingDeg !== undefined) requireFinite('motion.headingDeg', motion.headingDeg)
    }
  }

  for (const condition of scenario.conditions ?? []) {
    if (condition.kind === 'error') {
      requireNonNegative('error.atSec', condition.atSec)
      continue
    }
    requireNonNegative(`${condition.kind}.fromSec`, condition.fromSec)
    requireNonNegative(`${condition.kind}.toSec`, condition.toSec)
    if (condition.toSec < condition.fromSec) {
      throw new RangeError(`가상 시나리오의 ${condition.kind} 구간이 올바르지 않습니다: ${condition.fromSec}~${condition.toSec}`)
    }
    if (condition.kind === 'glitch') requireFinite('glitch.offsetM', condition.offsetM)
    if (condition.kind === 'poor-accuracy') requirePositive('poor-accuracy.accuracyM', condition.accuracyM)
  }
}

// ---------------------------------------------------------------------------
// 생성
// ---------------------------------------------------------------------------

// 시드로 재현되는 의사난수(mulberry32). 0 이상 1 미만
function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

// 이동 구간 하나. 시작·끝 시각(ms)과 북쪽·동쪽 방향 속도(m/s)
interface Leg {
  readonly startMs: number
  readonly endMs: number
  readonly northMps: number
  readonly eastMps: number
}

function buildLegs(motion: readonly VirtualMotion[]): { legs: Leg[]; totalMs: number } {
  const legs: Leg[] = []
  let cursor = 0
  for (const segment of motion) {
    const durationMs = segment.durationSec * 1000
    let northMps = 0
    let eastMps = 0
    if (segment.kind === 'move') {
      const heading = ((segment.headingDeg ?? 0) * Math.PI) / 180
      northMps = segment.speedMps * Math.cos(heading)
      eastMps = segment.speedMps * Math.sin(heading)
    }
    legs.push({ startMs: cursor, endMs: cursor + durationMs, northMps, eastMps })
    cursor += durationMs
  }
  return { legs, totalMs: cursor }
}

// 시각 atMs까지 시작점에서 북쪽·동쪽으로 이동한 거리(m)
function displacementAt(legs: readonly Leg[], atMs: number): { north: number; east: number } {
  let north = 0
  let east = 0
  for (const leg of legs) {
    if (atMs <= leg.startMs) break
    const insideSec = (Math.min(atMs, leg.endMs) - leg.startMs) / 1000
    north += leg.northMps * insideSec
    east += leg.eastMps * insideSec
  }
  return { north, east }
}

// 시나리오 전체 길이(ms): 이동 구간 길이의 합
export function getVirtualRunDurationMs(scenario: VirtualScenario): number {
  return scenario.motion.reduce((sum, segment) => sum + segment.durationSec * 1000, 0)
}

type GpsLost = Extract<VirtualCondition, { kind: 'gps-lost' }>
type Glitch = Extract<VirtualCondition, { kind: 'glitch' }>
type PoorAccuracy = Extract<VirtualCondition, { kind: 'poor-accuracy' }>
type ErrorCondition = Extract<VirtualCondition, { kind: 'error' }>

const isActive = (range: { readonly fromSec: number; readonly toSec: number }, atMs: number) =>
  atMs >= range.fromSec * 1000 && atMs < range.toSec * 1000

// 시나리오를 시간순 사건 목록으로 바꾼다. 이동이 하나도 없으면 빈 목록이다.
// - 좌표는 첫 좌표 시각부터 intervalMs마다, 시나리오 끝(포함)까지 만든다.
// - 겹치는 문제 상황: GPS 끊김이 우선(좌표 없음). 튐과 정확도 저하는 각각 먼저 적은 것을 쓰고 함께 적용된다.
// - 흔들림 난수는 끊김 등과 상관없이 좌표 시각마다 항상 뽑으므로, 문제 상황을 추가해도 다른 좌표는 그대로다.
// - 같은 시각의 사건은 좌표가 먼저, 오류가 나중이다.
export function generateVirtualRun(scenario: VirtualScenario): readonly VirtualEvent[] {
  validateScenario(scenario)
  if (scenario.motion.length === 0) {
    return []
  }

  const start = scenario.start ?? DEFAULT_START
  const intervalMs = scenario.intervalMs ?? DEFAULT_INTERVAL_MS
  const baseAccuracyM = scenario.accuracyM ?? DEFAULT_ACCURACY_M
  const firstFixDelayMs = scenario.firstFixDelayMs ?? 0
  const deliveryLagMs = scenario.deliveryLagMs ?? 0
  const noiseM = scenario.noiseM ?? 0
  const conditions = scenario.conditions ?? []
  const lostRanges = conditions.filter((condition): condition is GpsLost => condition.kind === 'gps-lost')
  const glitches = conditions.filter((condition): condition is Glitch => condition.kind === 'glitch')
  const poorRanges = conditions.filter((condition): condition is PoorAccuracy => condition.kind === 'poor-accuracy')
  const errorConditions = conditions.filter((condition): condition is ErrorCondition => condition.kind === 'error')

  const { legs, totalMs } = buildLegs(scenario.motion)
  const random = createRng(scenario.seed ?? 1)
  const metersPerDegreeLng = METERS_PER_DEGREE * Math.cos((start.lat * Math.PI) / 180)

  const events: VirtualEvent[] = []
  for (let index = 0; ; index += 1) {
    const atMs = firstFixDelayMs + index * intervalMs
    if (atMs > totalMs) break

    const noiseAngle = random() * 2 * Math.PI
    const noiseRadius = noiseM * Math.sqrt(random())

    if (lostRanges.some((range) => isActive(range, atMs))) {
      continue
    }

    const moved = displacementAt(legs, atMs)
    const north = moved.north + noiseRadius * Math.cos(noiseAngle)
    let east = moved.east + noiseRadius * Math.sin(noiseAngle)
    const glitch = glitches.find((range) => isActive(range, atMs))
    if (glitch !== undefined) {
      east += glitch.offsetM
    }
    const poor = poorRanges.find((range) => isActive(range, atMs))

    events.push({
      kind: 'fix',
      offsetMs: atMs,
      deliverAtMs: atMs + deliveryLagMs,
      lat: start.lat + north / METERS_PER_DEGREE,
      lng: start.lng + east / metersPerDegreeLng,
      accuracyM: poor !== undefined ? poor.accuracyM : baseAccuracyM,
    })
  }

  for (const range of lostRanges) {
    if (range.emitError === true) {
      events.push({ kind: 'error', deliverAtMs: range.fromSec * 1000, code: 2 })
    }
  }
  for (const condition of errorConditions) {
    events.push({ kind: 'error', deliverAtMs: condition.atSec * 1000, code: condition.code })
  }

  // 정렬은 안정적이므로 같은 시각에는 먼저 넣은 좌표가 앞에 온다.
  return events.sort((a, b) => a.deliverAtMs - b.deliverAtMs)
}
