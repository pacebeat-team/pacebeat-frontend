import { formatClock } from './format.ts'
import type { GpsSignal } from '../measurement/types.ts'
import type { GpsGap } from './types.ts'

// 진행 화면의 GPS 상태 문구(순수 함수). ⚠️ 문구는 임시이다(디자인 확인 필요).
// 웹 앱은 화면이 꺼지면 위치가 끊길 수 있다. 백그라운드 위치 수집은 보장하지 않으며 그렇게 안내하지도 않는다.

// 복구 안내를 보여 주는 시간(러닝 시간 기준, ms)
export const RECOVERY_NOTICE_MS = 10_000

export function describeGpsStatus(signal: GpsSignal | null, gaps: readonly GpsGap[], elapsedMs: number): string {
  if (signal === 'unavailable') return '위치를 사용할 수 없어요'
  if (signal === 'good') {
    const last = gaps[gaps.length - 1]
    if (last !== undefined && last.recoveredAtMs !== null && elapsedMs - last.recoveredAtMs < RECOVERY_NOTICE_MS) {
      return `${formatClock(last.recoveredAtMs)}에 신호가 복구됐어요`
    }
    return 'GPS 신호 정상'
  }
  return '신호를 찾고 있어요'
}
