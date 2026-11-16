// 기초 측정 화면(Guide / Active / Result)이 읽는 데이터 모양.
// 측정 엔진(#31)이 완성되면 엔진 값을 이 모양으로 변환해서 useMeasurementView가 돌려준다.
// - 측정하지 못한 값은 0이 아니라 null이다. (ADR-004)
// - 페이스는 sec/km 정수이다. (ADR-003) 예) 440 → 7′20″/km

export type GpsStatus = 'good' | 'weak' | 'lost' | 'unavailable'

export type MeasurementQuality = 'good' | 'fair' | 'poor'

export interface GuideView {
  // 측정 시간(초). 값은 엔진/기획 설정에서 받는다. (10분은 기획 확인 필요)
  targetDurationSec: number | null
}

export interface ActiveView {
  elapsedSec: number | null
  targetDurationSec: number | null
  // 이 시간 이상 기록해야 저장된다. (2분은 기획 확인 필요)
  minSaveSec: number | null
  distanceM: number | null
  currentPaceSecPerKm: number | null
  gpsStatus: GpsStatus | null
  cadenceSpm: number | null
}

export interface FirstGoal {
  distanceKm: number
  durationSec: number
}

export interface ResultView {
  elapsedSec: number | null
  distanceM: number | null
  baselinePaceSecPerKm: number | null
  cadenceSpm: number | null
  strideM: number | null
  quality: MeasurementQuality | null
  gpsStatus: GpsStatus | null
  firstGoal: FirstGoal | null
}

export interface MeasurementView {
  // true이면 예시(Mock) 데이터이다. 화면은 "예시" 문구를 함께 보여준다.
  isSample: boolean
  guide: GuideView
  active: ActiveView
  result: ResultView
}

// 화면이 호출하는 동작. 화면 이동은 화면이 직접 처리한다.
// 새로고침으로 복원된 세션을 이어 달릴 수 있는 상태. 복원된 세션이 아니면 화면에 주어지지 않는다(null).
export interface RestoreView {
  // GPS가 다시 확인되어 지금 이어서 측정할 수 있는가
  canResume: boolean
}

export interface MeasurementActions {
  start: () => void
  stop: () => void
  // 복원된 세션을 이어서 측정한다. 복원된 세션이 아니거나 GPS가 확인되지 않았으면 아무 일도 없다.
  resume: () => void
}
