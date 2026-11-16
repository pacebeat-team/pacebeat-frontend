// 측정 엔진 타입.
// - 시각은 모두 epoch ms(Date.now()와 같은 기준)이고, JSON으로 저장하고 복원해도 그대로 유지된다.

// 세션이 없으면(대기) 세션 값은 null이다.
export type SessionStatus = 'running' | 'paused' | 'finished'

// user: 사용자가 직접 종료 / auto: 측정 시간에 도달해 자동 종료
export type SessionEndReason = 'user' | 'auto'

// 사용자가 직접 일시정지한 구간. resumedAt이 null이면 아직 일시정지 중이다.
export interface ManualPause {
  readonly pausedAt: number
  readonly resumedAt: number | null
}

export interface MeasurementSession {
  readonly id: string
  readonly status: SessionStatus
  readonly startedAt: number
  readonly endedAt: number | null
  readonly endReason: SessionEndReason | null
  // 경과 시간에서 빼는 구간은 사용자가 직접 일시정지한 시간뿐이다.
  // GPS 끊김, 새로고침 후 GPS 재확인 대기 시간은 여기에 기록하지 않는다(경과 시간에 포함).
  readonly pauses: readonly ManualPause[]
}

// ---------------------------------------------------------------------------
// GPS (좌표 검증과 신호 상태)
// 이 영역은 "좌표를 믿을 수 있는가"와 "GPS 신호 상태"만 다룬다.
// 거리·페이스 계산은 다음 단계의 책임이다.
// ---------------------------------------------------------------------------

// 브라우저가 알려 준 좌표 하나(검증 전).
export interface RawFix {
  readonly lat: number
  readonly lng: number
  // 위치 오차 반경(m). 알 수 없으면 null
  readonly accuracyM: number | null
  // 좌표의 기기 시각(position.timestamp, epoch ms).
  // 순서·중복·오래된 좌표 판정과 속도 계산에만 쓰고, 세션 시간으로는 쓰지 않는다.
  readonly deviceTime: number
  // 앱이 좌표를 받은 시각(epoch ms). 세션 사건(시작, 일시정지 등)과 같은 시계여야 한다.
  readonly receivedAt: number
}

// 검증을 통과한 좌표.
export interface ValidFix {
  readonly lat: number
  readonly lng: number
  readonly accuracyM: number
  readonly deviceTime: number
  // 세션 시간 기준의 시각(= 수신 시각). 이전 유효 좌표보다 줄어들지 않는다.
  readonly at: number
  // true이면 직전 유효 좌표와 이어서 거리·시간을 계산해도 된다.
  // 첫 좌표, 신호가 끊겼다 복구된 뒤, 재앵커한 좌표는 false이다.
  readonly connected: boolean
}

export type RejectReason =
  | 'invalid-time'
  | 'invalid-coordinates'
  | 'poor-accuracy'
  | 'stale'
  | 'duplicate'
  | 'out-of-order'
  | 'jump'

// 위치 수집 단계가 알려 주는 오류.
export type GpsErrorReason =
  | 'permission-denied'
  | 'insecure-context'
  | 'unsupported'
  | 'position-unavailable'
  | 'timeout'

// 위치를 아예 쓸 수 없는 오류. (position-unavailable, timeout은 일시적일 수 있어 여기에 넣지 않는다.)
export type GpsUnavailableReason = 'permission-denied' | 'insecure-context' | 'unsupported'

// 확인된 사실만 표현한다. 'weak'(약함)는 판정 기준이 정해지지 않았으므로 만들지 않는다.
// (상태 값이 없는 null은 "사용할 수 있지만 아직 유효 좌표를 받지 못함", 즉 검색 중이다.)
export type GpsSignal = 'good' | 'lost' | 'unavailable'

// ⚠️ 모든 값은 확정된 정책이 아니라 제안값이다. 실기기 확인과 기획 확정 후 조정한다.
export interface GpsConfig {
  // 이 값을 넘는 정확도(오차 반경, m)의 좌표는 버린다.
  readonly maxAccuracyM: number
  // 이 속도(m/s)를 넘는 이동은 튐으로 본다. (정확도 오차를 더해서 판단)
  readonly maxSpeedMps: number
  // 유효 좌표 사이 간격(수신 시각 기준, ms)이 이 값 이하면 이어서 계산하고, 넘으면 신호가 끊긴 것으로 본다.
  readonly connectGapMs: number
  // 수신 시각 − 기기 시각이 이 값(ms)을 넘으면 오래된 좌표로 버린다.
  // 기기 시각이 수신 시각보다 이 값 넘게 앞서면 기기 시계를 믿지 않고 수신 시각을 쓴다.
  readonly maxFixAgeMs: number
  // 튐이 이 횟수만큼 연속으로, 서로 일치하게 이어지면 새 구간의 시작점으로 받아들인다(재앵커).
  readonly reanchorAfter: number
  // 재앵커하려면 위 횟수를 채운 튐 후보가 이 시간(ms, 수신 시각 기준) 이상 지속되어야 한다.
  // (짧은 순간의 위치 튐이 새 기준점이 되는 것을 막는다. 0이면 시간 조건을 쓰지 않는다.)
  readonly reanchorMinDurationMs: number
}

// 직전에 받아들인 좌표(또는 튐 후보)의 기준 정보.
export interface GpsAnchor {
  readonly lat: number
  readonly lng: number
  readonly accuracyM: number
  // 기준 시각: 기기 시각. 기기 시각이 수신 시각보다 크게 앞서면 수신 시각으로 대체한다.
  readonly time: number
  // 세션 시간 기준의 시각(수신 시각)
  readonly at: number
}

export interface GpsTrackerState {
  readonly anchor: GpsAnchor | null
  // 연속으로 튐 판정을 받은 좌표들(서로 일치할 때만 쌓임). 재앵커 판단에 쓴다.
  readonly pendingJumps: readonly GpsAnchor[]
  readonly acceptedCount: number
  readonly unavailableReason: GpsUnavailableReason | null
}

export type GpsProcessResult =
  | { readonly accepted: true; readonly fix: ValidFix }
  | { readonly accepted: false; readonly reason: RejectReason }
