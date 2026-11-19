import { getGpsStatus, isGpsVerified } from './gpsTracker.ts'
import type { GpsTrackerState } from './types.ts'

// 새로고침 뒤 복원된 세션을 이어서 측정해도 되는가 (순수 함수).
// - 위치 수집을 새로 시작한 뒤 유효 좌표를 받은 적이 있고(isGpsVerified), 지금도 신호가 정상(good)일 때만 true이다.
//   (한 번 받고 끊긴 상태에서는 이어갈 수 없다.)
// - 엔진의 gpsTracker 함수를 그대로 쓴다. 새 판단 기준을 만들지 않는다.
export function isGpsReadyToResume(tracker: GpsTrackerState, now: number): boolean {
  return isGpsVerified(tracker) && getGpsStatus(tracker, now) === 'good'
}
