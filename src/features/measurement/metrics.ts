import { haversineMeters } from './geo.ts'
import { DEFAULT_GPS_CONFIG } from './gpsTracker.ts'
import { getElapsedMs, getRunningMsBetween } from './session.ts'
import type {
  MeasurementMetrics,
  MeasurementSession,
  MetricsConfig,
  MetricsPair,
  MetricsState,
  ValidFix,
} from './types.ts'

// 러닝 지표 계산 (순수 함수): 누적 거리, 유효 측정 시간, 평균·현재 속도와 페이스.
// - 입력은 gpsTracker가 검증한 ValidFix뿐이다. 실제 GPS(geolocationSource)와 가상 데이터는 모두 RawFix로 들어와
//   같은 검증을 거치므로, 이 파일은 데이터가 어디서 왔는지 모른다.
// - 거리 = "이어진 좌표 쌍"(ValidFix.connected)의 직선 거리 합. 이어지지 않은 좌표(첫 좌표, 신호 끊김 뒤 복구,
//   재앵커)와 수동 일시정지를 가로지르는 쌍은 거리와 시간에 넣지 않고 새 구간의 시작점으로만 쓴다.
// - 유효 측정 시간 = 이어진 좌표 쌍의 시간 합. 평균 페이스는 이 시간으로 계산한다.
// - 타이머나 Date.now()를 쓰지 않는다. 현재 시각(now)은 호출하는 쪽이 넘긴다.
// - 좌표의 시각(at)과 세션 사건의 시각은 같은 시계여야 한다.

// ⚠️ 제안값이며 확정된 정책이 아니다. 실기기 확인과 기획 확정 후 조정한다.
export const DEFAULT_METRICS_CONFIG: MetricsConfig = Object.freeze({
  currentPaceWindowMs: 15_000,
  currentPaceMinValidMs: 5_000,
  avgPaceMinDistanceM: 20,
  avgPaceMinValidMs: 10_000,
  minPaceSpeedMps: 0.5,
  gpsLostAfterMs: DEFAULT_GPS_CONFIG.connectGapMs,
})

export function createMetrics(): MetricsState {
  return { lastFix: null, distanceM: 0, validMs: 0, recent: [] }
}

// 시각 at이 사용자가 직접 일시정지한 구간 안인가. (재개하는 시각 자체는 일시정지가 아니다.)
function isPausedAt(session: MeasurementSession, at: number): boolean {
  return session.pauses.some(
    (pause) => at >= pause.pausedAt && (pause.resumedAt === null || at < pause.resumedAt),
  )
}

// 검증을 통과한 좌표 하나를 반영한다. 반영하지 않을 좌표는 같은 상태 객체를 그대로 돌려준다.
export function addFix(
  state: MetricsState,
  fix: ValidFix,
  session: MeasurementSession,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): MetricsState {
  const at = fix.at
  if (!Number.isFinite(at) || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) {
    return state
  }
  // 세션이 시작하기 전이나 끝난 뒤의 좌표는 반영하지 않는다.
  if (at < session.startedAt || (session.endedAt !== null && at > session.endedAt)) {
    return state
  }
  // 일시정지 중에 도착한 좌표는 반영하지 않고, 직전 좌표도 비워서 재개 후 첫 좌표가 새 구간이 되게 한다.
  if (isPausedAt(session, at)) {
    return state.lastFix === null ? state : { ...state, lastFix: null, recent: [] }
  }

  const last = state.lastFix
  // 직전 좌표와 같거나 더 이른 시각의 좌표는 무시한다(방어용. 보통은 gpsTracker가 이미 걸러낸다).
  if (last !== null && at <= last.at) {
    return state
  }

  const point = { lat: fix.lat, lng: fix.lng, at }

  // 새 구간의 시작점이 되는 경우: 첫 좌표, 이어지지 않은 좌표, 두 좌표 사이에 수동 일시정지가 겹치는 경우.
  // gpsTracker는 일시정지를 모르므로(10초 이내의 일시정지는 connected=true로 들어온다) 여기서 걸러야 한다.
  const spansPause = last !== null && getRunningMsBetween(session, last.at, at, at) < at - last.at
  if (last === null || !fix.connected || spansPause) {
    return { ...state, lastFix: point, recent: [] }
  }

  const pair: MetricsPair = {
    from: last.at,
    to: at,
    distanceM: haversineMeters(last.lat, last.lng, fix.lat, fix.lng),
  }
  const windowStart = at - config.currentPaceWindowMs
  return {
    lastFix: point,
    distanceM: state.distanceM + pair.distanceM,
    validMs: state.validMs + (at - last.at),
    recent: [...state.recent.filter((old) => old.to > windowStart), pair],
  }
}

// 거리와 시간에서 페이스(sec/km, 정수)를 구한다. 속도가 minPaceSpeedMps 미만이면 null이다.
// (거리 ÷ 시간 대신 곱셈으로 비교해서 경계값에서 부동소수점 오차가 생기지 않게 한다.)
function toPaceSecPerKm(distanceM: number, ms: number, config: MetricsConfig): number | null {
  if (!(distanceM > 0) || !(ms > 0)) {
    return null
  }
  return distanceM * 1000 >= config.minPaceSpeedMps * ms ? Math.round(ms / distanceM) : null
}

interface CurrentPace {
  readonly speedMps: number | null
  readonly paceSecPerKm: number | null
}

const NO_CURRENT: CurrentPace = { speedMps: null, paceSecPerKm: null }

// 현재 속도·페이스: 마지막 좌표에서 거꾸로 currentPaceWindowMs 동안의 거리 ÷ 유효 측정 시간.
// 창이 좌표 쌍의 중간에서 시작하면 그 쌍은 겹치는 시간만큼 비례해서 반영한다(쌍 안에서 일정한 속도로 이동했다고 본다).
function getCurrentPace(
  state: MetricsState,
  session: MeasurementSession,
  now: number,
  config: MetricsConfig,
): CurrentPace {
  const last = state.lastFix
  // 진행 중이 아니거나(일시정지, 종료), 마지막 좌표가 없거나, 시각을 알 수 없으면 계산하지 않는다.
  if (session.status !== 'running' || last === null || !Number.isFinite(now)) {
    return NO_CURRENT
  }
  const sinceLastMs = now - last.at
  // GPS가 끊긴 경우: 마지막 좌표 이후 너무 오래 지났다.
  if (sinceLastMs > config.gpsLostAfterMs) {
    return NO_CURRENT
  }
  // 마지막 좌표 이후 일시정지가 있었다면(재개 직후) 새 좌표가 쌓이기 전까지는 이전 값을 보여 주지 않는다.
  if (getRunningMsBetween(session, last.at, now, now) < sinceLastMs) {
    return NO_CURRENT
  }

  const windowStart = last.at - config.currentPaceWindowMs
  let windowMs = 0
  let windowM = 0
  for (const pair of state.recent) {
    const overlap = Math.min(pair.to, last.at) - Math.max(pair.from, windowStart)
    if (overlap > 0) {
      windowMs += overlap
      windowM += pair.distanceM * (overlap / (pair.to - pair.from))
    }
  }
  if (windowMs < config.currentPaceMinValidMs) {
    return NO_CURRENT
  }
  return {
    speedMps: windowM / (windowMs / 1000),
    paceSecPerKm: toPaceSecPerKm(windowM, windowMs, config),
  }
}

// 지금까지의 지표. now는 경과 시간과 현재 페이스 판정에 쓴다.
export function getMetrics(
  state: MetricsState,
  session: MeasurementSession,
  now: number,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): MeasurementMetrics {
  const elapsedMs = getElapsedMs(session, now)
  const { distanceM, validMs } = state
  const current = getCurrentPace(state, session, now, config)

  const hasAvgPace = distanceM >= config.avgPaceMinDistanceM && validMs >= config.avgPaceMinValidMs

  return {
    elapsedMs,
    validMs,
    unmeasuredMs: Math.max(0, elapsedMs - validMs),
    distanceM,
    avgSpeedMps: validMs > 0 ? distanceM / (validMs / 1000) : null,
    avgPaceSecPerKm: hasAvgPace ? toPaceSecPerKm(distanceM, validMs, config) : null,
    currentSpeedMps: current.speedMps,
    currentPaceSecPerKm: current.paceSecPerKm,
  }
}
