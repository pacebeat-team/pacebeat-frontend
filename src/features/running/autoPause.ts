// 자동 일시정지 판정(순수 함수).
// 확정 정책(D14):
// - GPS 거리 러닝에서만 쓴다(TIME 모드 제외). 세션에 고정된 안내 설정의 autoPause가 켜져 있을 때만 판정한다.
// - 정지 기준: 속도 0.5 km/h 미만(정확히 0.5 km/h는 정지가 아니다). 이 상태가 10초 연속 유지되면 한 번 일시정지한다.
// - 속도는 연속한 두 유효 좌표(connected) 사이의 거리 ÷ 시간으로 구한다. 한 번의 좌표·속도 값만으로는 멈추지 않는다(정지 구간이 2개 이상 이어져야 한다).
// - 판정은 GPS 신호가 정상이고 유효 좌표가 도착하는 동안에만 한다. 신호 끊김·정확도 저하(좌표 거절)·오류·일시정지·재개·종료는 타이머를 지운다.
// - 자동 재개는 없다. 재개는 사용자가 누르는 재개 버튼뿐이다.

export const AUTO_PAUSE_SPEED_KMH = 0.5
export const AUTO_PAUSE_HOLD_MS = 10_000
// 정지로 판정한 구간이 이만큼은 이어져야 한다(좌표 한 개의 값으로는 멈추지 않는다).
export const AUTO_PAUSE_MIN_STILL_STEPS = 2

export interface AutoPauseState {
  // 연속 정지가 시작된 시각(세션 시간 기준 ms). 정지가 아니면 null
  readonly stillSince: number | null
  readonly stillSteps: number
  // 직전에 판정에 쓴 유효 좌표 시각. 이어지는 좌표가 아니면 null
  readonly lastAt: number | null
}

export const INITIAL_AUTO_PAUSE: AutoPauseState = Object.freeze({ stillSince: null, stillSteps: 0, lastAt: null })

// 거리(m)와 시간(ms)으로 정지(< 0.5 km/h)인지 판단한다. 0.5 km/h = 1/7.2 m/s → d/dt < 1/7200 m/ms
export function isStill(distanceM: number, dtMs: number): boolean {
  if (!Number.isFinite(distanceM) || !Number.isFinite(dtMs) || dtMs <= 0 || distanceM < 0) return false
  return distanceM * 7200 < dtMs
}

export interface AutoPauseStep {
  readonly state: AutoPauseState
  readonly pause: boolean
}

// 유효 좌표 한 개를 반영한다. distanceM은 직전 판정 좌표와의 거리(connected 좌표가 아니면 null)
export function feedAutoPause(
  state: AutoPauseState,
  at: number,
  distanceM: number | null,
  connected: boolean,
): AutoPauseStep {
  // 이어지지 않는 좌표(첫 좌표·끊김 복구·재앵커)는 기준만 새로 잡는다.
  if (!connected || distanceM === null || state.lastAt === null || at <= state.lastAt) {
    return { state: { stillSince: null, stillSteps: 0, lastAt: at }, pause: false }
  }
  const dt = at - state.lastAt
  if (!isStill(distanceM, dt)) {
    return { state: { stillSince: null, stillSteps: 0, lastAt: at }, pause: false }
  }
  const stillSince = state.stillSince ?? state.lastAt
  const stillSteps = state.stillSteps + 1
  const pause = stillSteps >= AUTO_PAUSE_MIN_STILL_STEPS && at - stillSince >= AUTO_PAUSE_HOLD_MS
  return { state: { stillSince, stillSteps, lastAt: at }, pause }
}
