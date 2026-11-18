import { DEFAULT_METRICS_CONFIG } from '../measurement/metrics.ts'

// 평균 페이스(초/km) = 러닝 시간 ÷ 거리. 진행 화면과 결과·기록이 같은 기준을 쓰도록 한 곳에 둔다.
// 거리가 너무 짧거나 시간이 없으면 null이다(0이 아니다).
export function computeAvgPaceSecPerKm(elapsedMs: number, distanceM: number): number | null {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(distanceM)) return null
  if (distanceM < DEFAULT_METRICS_CONFIG.avgPaceMinDistanceM || elapsedMs <= 0) return null
  return Math.round(elapsedMs / 1000 / (distanceM / 1000))
}
