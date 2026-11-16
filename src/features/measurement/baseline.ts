import type { MeasurementMetrics } from './types.ts'

// 기준 페이스 (순수 함수).
// - 계산식을 새로 만들지 않는다. 엔진의 getMetrics가 구한 평균 페이스(avgPaceSecPerKm = 유효 시간 ÷ 유효 거리, sec/km 정수)를 그대로 쓴다.
//   그래서 거리 부족, GPS 데이터 부족, 최저 속도 미만처럼 엔진이 null로 둔 경우는 여기서도 null이다.
// - 여기서 더하는 조건은 하나뿐이다: 유효 측정 시간(GPS가 유효했던 구간의 시간)이 2분 미만이면 기준으로 삼지 않는다.
//   전체 경과 시간이 아니라 validMs로 판단한다. (끊긴 구간이 많은 측정을 기준으로 삼지 않기 위해)
// - 이 2분은 "기준 페이스를 보여 주는 최소 유효 시간"이다. 최소 저장 시간(minSaveSec) 정책과는 별개이다.
export const BASELINE_MIN_VALID_MS = 120_000

export function computeBaselinePace(measured: Pick<MeasurementMetrics, 'validMs' | 'avgPaceSecPerKm'>): number | null {
  if (!(measured.validMs >= BASELINE_MIN_VALID_MS)) {
    return null
  }
  return measured.avgPaceSecPerKm
}
