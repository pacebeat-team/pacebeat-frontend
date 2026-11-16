import { computeBaselinePace } from '../measurement/baseline.ts'
import { getGpsStatus } from '../measurement/gpsTracker.ts'
import { getMetrics } from '../measurement/metrics.ts'
import type { GpsTrackerState, MeasurementSession, MetricsState } from '../measurement/types.ts'
import type { MeasurementView } from './types.ts'

// 측정 Store의 값을 화면이 읽는 MeasurementView로 바꾼다 (순수 함수).
// - 계산은 하지 않는다. 엔진의 getMetrics / getGpsStatus 결과를 화면 모양에 맞출 뿐이다.
// - 측정하지 못한 값은 0이 아니라 null이다. (ADR-004)
// - 기준 페이스는 computeBaselinePace(엔진의 평균 페이스, 유효 측정 시간 2분 이상일 때만)로 채운다.
// - 최소 저장 시간, 케이던스, 보폭, 품질, 첫 목표는 이 단계에서 다루지 않으므로 null이다.
//   (첫 목표는 목표 산정 규칙이 확정될 때까지 계산하지 않는다.)
// - 목표 시간은 측정 Store가 정한 값(실제 GPS 측정 10분, 가상은 null)을 그대로 초 단위로 보여 준다.

export interface MeasurementSnapshot {
  readonly session: MeasurementSession | null
  readonly tracker: GpsTrackerState
  readonly metrics: MetricsState
  // 화면 갱신용 현재 시각(epoch ms)
  readonly now: number
  // 목표 시간(ms). 목표가 없으면 null
  readonly targetDurationMs: number | null
}

export function toMeasurementView(snapshot: MeasurementSnapshot): MeasurementView {
  const { session, tracker, metrics, now, targetDurationMs } = snapshot
  const targetDurationSec = targetDurationMs === null ? null : Math.floor(targetDurationMs / 1000)

  let elapsedSec: number | null = null
  let distanceM: number | null = null
  let currentPaceSecPerKm: number | null = null
  let gpsStatus: MeasurementView['active']['gpsStatus'] = null
  let baselinePaceSecPerKm: number | null = null

  if (session !== null) {
    const measured = getMetrics(metrics, session, now)
    elapsedSec = Math.floor(measured.elapsedMs / 1000)
    // 이어진 좌표 쌍이 하나도 없으면 거리는 "0 km"가 아니라 아직 측정하지 못한 것이다.
    distanceM = measured.validMs > 0 ? measured.distanceM : null
    currentPaceSecPerKm = measured.currentPaceSecPerKm
    baselinePaceSecPerKm = computeBaselinePace(measured)
    // 종료된 세션의 GPS 상태는 종료 시각 기준이다. (종료 후 시간이 지나도 '끊김'으로 바뀌지 않게)
    gpsStatus = getGpsStatus(tracker, session.endedAt ?? now)
  }

  return {
    isSample: false,
    guide: { targetDurationSec },
    active: {
      elapsedSec,
      targetDurationSec,
      minSaveSec: null,
      distanceM,
      currentPaceSecPerKm,
      gpsStatus,
      cadenceSpm: null,
    },
    result: {
      elapsedSec,
      distanceM,
      baselinePaceSecPerKm,
      cadenceSpm: null,
      strideM: null,
      quality: null,
      // 결과의 GPS 상태는 측정 전체의 품질을 뜻하는데, 엔진의 GPS 상태는 "지금(종료 시점)"의 신호뿐이다.
      // 중간에 끊겼다 복구된 측정이 'GPS 안정'으로 보이지 않도록, 품질 기준이 정해질 때까지 null(표시 안 함)로 둔다.
      gpsStatus: null,
      firstGoal: null,
    },
  }
}
