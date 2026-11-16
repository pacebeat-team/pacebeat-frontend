import { haversineMeters, isValidCoordinate } from './geo.ts'
import type {
  GpsAnchor,
  GpsConfig,
  GpsErrorReason,
  GpsProcessResult,
  GpsSignal,
  GpsTrackerState,
  RawFix,
  RejectReason,
} from './types.ts'

// GPS 좌표 검증과 신호 상태 추적 (순수 함수).
// - 브라우저 위치 수집(watchPosition)은 이 파일의 책임이 아니다. 좌표와 오류를 받아서 판단만 한다.
// - 거리 누적과 페이스 계산도 하지 않는다. 검증을 통과한 좌표와 "이어서 계산해도 되는가(connected)"만 넘긴다.
// - 시간 기준: 세션 시간은 수신 시각(receivedAt)이다. 좌표의 기기 시각(deviceTime)은
//   순서·중복·오래된 좌표 판정과 속도 계산에만 쓴다.
// - 타이머를 쓰지 않는다. 신호 상태는 현재 시각(now)을 받아서 판정한다.

// ⚠️ 제안값이며 확정된 정책이 아니다. 실기기 확인과 기획 확정 후 조정한다.
export const DEFAULT_GPS_CONFIG: GpsConfig = Object.freeze({
  maxAccuracyM: 30,
  maxSpeedMps: 12,
  connectGapMs: 10_000,
  maxFixAgeMs: 10_000,
  reanchorAfter: 3,
  reanchorMinDurationMs: 3_000,
})

export interface ProcessedFix {
  readonly state: GpsTrackerState
  readonly result: GpsProcessResult
}

export function createGpsTracker(): GpsTrackerState {
  return { anchor: null, pendingJumps: [], acceptedCount: 0, unavailableReason: null }
}

// 위치 수집 단계의 오류를 반영한다.
// 권한 거부, 비보안, 미지원은 위치를 쓸 수 없는 상태로 기록하고, 일시적인 오류(position-unavailable,
// timeout)는 상태를 바꾸지 않는다(좌표가 끊긴 시간으로 lost를 판정한다).
export function applyGpsError(state: GpsTrackerState, reason: GpsErrorReason): GpsTrackerState {
  if (reason === 'permission-denied' || reason === 'insecure-context' || reason === 'unsupported') {
    return state.unavailableReason === reason ? state : { ...state, unavailableReason: reason }
  }
  return state
}

// from에서 to까지 이동이 속도 한도 안에서 설명되는가.
// 한도: 최대 속도 × 시간 + 두 좌표의 오차 반경 (흔들림 때문에 정상 좌표가 버려지지 않게 오차를 더한다)
function isReachable(from: GpsAnchor, to: GpsAnchor, config: GpsConfig): boolean {
  const seconds = Math.max(0, to.time - from.time) / 1000
  const allowedMeters = config.maxSpeedMps * seconds + from.accuracyM + to.accuracyM
  return haversineMeters(from.lat, from.lng, to.lat, to.lng) <= allowedMeters
}

function accept(
  state: GpsTrackerState,
  candidate: GpsAnchor,
  deviceTime: number,
  connected: boolean,
): ProcessedFix {
  return {
    state: {
      anchor: candidate,
      pendingJumps: [],
      acceptedCount: state.acceptedCount + 1,
      // 유효 좌표가 들어오면 위치를 쓸 수 있다는 뜻이므로 사용 불가 상태를 해제한다.
      unavailableReason: null,
    },
    result: {
      accepted: true,
      fix: {
        lat: candidate.lat,
        lng: candidate.lng,
        accuracyM: candidate.accuracyM,
        deviceTime,
        at: candidate.at,
        connected,
      },
    },
  }
}

function reject(state: GpsTrackerState, reason: RejectReason): ProcessedFix {
  return { state, result: { accepted: false, reason } }
}

// 좌표 하나를 검증한다. 버려진 좌표는 직전 유효 좌표(기준)를 바꾸지 않는다.
export function processFix(
  state: GpsTrackerState,
  fix: RawFix,
  config: GpsConfig = DEFAULT_GPS_CONFIG,
): ProcessedFix {
  if (!Number.isFinite(fix.deviceTime) || !Number.isFinite(fix.receivedAt)) {
    return reject(state, 'invalid-time')
  }
  if (!isValidCoordinate(fix.lat, fix.lng)) {
    return reject(state, 'invalid-coordinates')
  }

  const accuracyM = fix.accuracyM
  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM <= 0 || accuracyM > config.maxAccuracyM) {
    return reject(state, 'poor-accuracy')
  }

  // 수신 − 기기 시각. 너무 크면 캐시된 좌표나 한꺼번에 밀려온 좌표이므로 채워 넣지 않고 버린다.
  const age = fix.receivedAt - fix.deviceTime
  if (age > config.maxFixAgeMs) {
    return reject(state, 'stale')
  }
  // 기기 시각이 수신 시각보다 크게 앞서면 기기 시계를 믿을 수 없으므로 수신 시각을 기준 시각으로 쓴다.
  // (그대로 두면 이후 정상 좌표가 모두 "순서 오류"로 막힌다.)
  const time = age < -config.maxFixAgeMs ? fix.receivedAt : fix.deviceTime

  const anchor = state.anchor
  if (anchor !== null) {
    if (time < anchor.time) {
      return reject(state, 'out-of-order')
    }
    // 같은 시각에는 위치가 하나뿐이므로 좌표가 달라도 먼저 받은 것을 유지한다.
    if (time === anchor.time) {
      return reject(state, 'duplicate')
    }
  }

  // 세션 시간 기준의 시각은 줄어들지 않게 한다.
  const at = anchor === null ? fix.receivedAt : Math.max(fix.receivedAt, anchor.at)
  const candidate: GpsAnchor = { lat: fix.lat, lng: fix.lng, accuracyM, time, at }

  // 첫 좌표이거나 직전 유효 좌표와 간격이 벌어졌다면(신호 끊김 뒤) 새 구간의 시작이다.
  // 이어지지 않으므로 속도 판단도 하지 않는다.
  if (anchor === null || candidate.at - anchor.at > config.connectGapMs) {
    return accept(state, candidate, fix.deviceTime, false)
  }

  if (isReachable(anchor, candidate, config)) {
    return accept(state, candidate, fix.deviceTime, true)
  }

  // 튐: 속도 한도로 설명되지 않는 이동. 직전 유효 좌표는 유지한다.
  // 다만 서로 일치하는 좌표가 연속으로, 일정 시간 이상 계속 들어오면(직전 기준 좌표가 잘못된 경우)
  // 영구히 막히지 않도록 새 구간의 시작점으로 받아들인다(재앵커).
  // 후보끼리 시간 간격을 따로 검사하지 않는다: 후보는 모두 직전 유효 좌표에서 connectGapMs 이내일 때만
  // 쌓이고(그보다 늦으면 위에서 새 구간으로 받아들여짐), 후보가 있는 동안 기준 좌표는 바뀌지 않기 때문이다.
  const lastPending = state.pendingJumps[state.pendingJumps.length - 1]
  const continuesCluster = lastPending !== undefined && isReachable(lastPending, candidate, config)
  const cluster = continuesCluster ? [...state.pendingJumps, candidate] : [candidate]

  const sustained = candidate.at - cluster[0].at >= config.reanchorMinDurationMs
  if (cluster.length >= config.reanchorAfter && sustained) {
    return accept(state, candidate, fix.deviceTime, false)
  }
  return { state: { ...state, pendingJumps: cluster }, result: { accepted: false, reason: 'jump' } }
}

// 현재 GPS 신호 상태. 확인된 사실만 돌려준다.
// - 'unavailable': 권한 거부, 비보안, 미지원
// - null: 사용할 수 있지만 아직 유효 좌표를 받지 못함(검색 중)
// - 'good': 마지막 유효 좌표를 connectGapMs 이내에 받음
// - 'lost': 유효 좌표를 받은 적이 있지만 connectGapMs를 넘겨 받지 못함
// 유효하지 않은 now는 마지막 유효 좌표 시각과 같다고 본다.
export function getGpsStatus(
  state: GpsTrackerState,
  now: number,
  config: GpsConfig = DEFAULT_GPS_CONFIG,
): GpsSignal | null {
  if (state.unavailableReason !== null) {
    return 'unavailable'
  }
  if (state.anchor === null) {
    return null
  }
  const elapsedMs = Number.isFinite(now) ? now - state.anchor.at : 0
  return elapsedMs <= config.connectGapMs ? 'good' : 'lost'
}

// 위치 수집을 새로 시작한 뒤 유효 좌표를 하나 이상 받았는가. (새로고침 후 GPS 재확인에 쓴다.)
export function isGpsVerified(state: GpsTrackerState): boolean {
  return state.acceptedCount > 0
}
