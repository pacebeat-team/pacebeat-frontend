import type { BaselineResponse, BaselineUpsertRequest, MetricStatusType } from '../../lib/api/types.ts'
import { computeBaselinePace } from '../measurement/baseline.ts'
import type { MeasurementMetrics } from '../measurement/types.ts'
import { finiteOrNull, fromIso, toIso } from './time.ts'

// 기초 측정 ↔ 서버 Baseline 변환(순수 함수). 기준 페이스는 기존 computeBaselinePace를 그대로 쓴다(새 계산식 없음).
//
// quality_status: 서버는 값을 보내지 않으면 기본값 no_data로 보고 기준 페이스를 null로 강제한다(백엔드 코드 확인, 실서버 미검증). 그래서 기준 페이스가 있는 측정은 값을 보내야 저장된다.
// 앱에는 측정 품질(gps_poor 등)을 따로 판정하는 기준이 없다. 앱이 가진 판정은 하나뿐이다: 엔진의 평균 페이스가 null이 아니고 유효 측정 시간이 2분 이상일 때만 기준 페이스로 채택한다(computeBaselinePace).
// - 기준 페이스가 있다 = 앱이 이 측정을 기준으로 채택했다 → 'valid'
// - 기준 페이스가 없다(채택하지 못한 이유가 시간 부족인지 거리·GPS 부족인지 앱이 구분하지 않는다) → 값을 보내지 않는다(미확정). gps_poor·insufficient_data를 추측해서 보내지 않는다.
// 호출자가 qualityStatus를 직접 넘기면 그 값을 그대로 쓴다. 'valid'의 정확한 의미(GPS 품질 포함 여부)는 백엔드 확인이 필요하다.
export function baselineRequestFromMetrics(
  metrics: Pick<MeasurementMetrics, 'validMs' | 'avgPaceSecPerKm' | 'distanceM'>,
  measuredAtMs: number | null,
  qualityStatus?: MetricStatusType,
): BaselineUpsertRequest {
  const pace = computeBaselinePace(metrics)
  const status = qualityStatus ?? (pace === null ? undefined : 'valid')
  return {
    skipped: false,
    ...(status === undefined ? {} : { quality_status: status }),
    baseline_pace_sec_per_km: pace,
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
