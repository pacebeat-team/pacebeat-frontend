import type { BaselineResponse, BaselineUpsertRequest, MetricStatusType } from '../../lib/api/types.ts'
import { computeBaselinePace } from '../measurement/baseline.ts'
import type { MeasurementMetrics } from '../measurement/types.ts'
import { finiteOrNull, fromIso, toIso } from './time.ts'

// 기초 측정 ↔ 서버 Baseline 변환(순수 함수). 기준 페이스는 기존 computeBaselinePace를 그대로 쓴다(새 계산식 없음).
// 로컬에는 케이던스·보폭이 없으므로 null로 보내고, quality_status는 판정 기준이 확정되지 않아 만들지 않는다(생략).
export function baselineRequestFromMetrics(
  metrics: Pick<MeasurementMetrics, 'validMs' | 'avgPaceSecPerKm' | 'distanceM'>,
  measuredAtMs: number | null,
  qualityStatus?: MetricStatusType,
): BaselineUpsertRequest {
  return {
    skipped: false,
    ...(qualityStatus === undefined ? {} : { quality_status: qualityStatus }),
    baseline_pace_sec_per_km: computeBaselinePace(metrics),
    cadence_spm: null,
    stride_length_cm: null,
    valid_duration_ms: metrics.validMs,
    distance_m: metrics.distanceM,
    measured_at: toIso(measuredAtMs),
  }
}

// 건너뛴 기초 측정. 측정값은 모두 null이다.
export function baselineSkippedRequest(): BaselineUpsertRequest {
  return { skipped: true, baseline_pace_sec_per_km: null, cadence_spm: null, stride_length_cm: null, valid_duration_ms: null, distance_m: null, measured_at: null }
}

export interface RemoteBaselineView {
  readonly skipped: boolean
  readonly qualityStatus: MetricStatusType
  readonly paceSecPerKm: number | null
  readonly cadenceSpm: number | null
  readonly strideLengthCm: number | null
  readonly validDurationMs: number | null
  readonly distanceM: number | null
  readonly measuredAt: number | null
}

export function fromBaselineResponse(response: BaselineResponse): RemoteBaselineView {
  return {
    skipped: response.skipped,
    qualityStatus: response.quality_status,
    paceSecPerKm: finiteOrNull(response.baseline_pace_sec_per_km),
    cadenceSpm: finiteOrNull(response.cadence_spm),
    strideLengthCm: finiteOrNull(response.stride_length_cm),
    validDurationMs: finiteOrNull(response.valid_duration_ms),
    distanceM: finiteOrNull(response.distance_m),
    measuredAt: fromIso(response.measured_at),
  }
}
