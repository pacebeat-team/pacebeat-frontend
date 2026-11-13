// 측정 화면 표시용 포맷 함수. 값이 없으면(null) 0이 아니라 PLACEHOLDER를 돌려준다.

export const PLACEHOLDER = '—'

const pad2 = (value: number) => String(value).padStart(2, '0')

const isValid = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value >= 0

// 06:12 (분을 두 자리로 맞춘 시계 형식, Guide·Active)
export function formatClock(totalSec: number | null): string {
  if (!isValid(totalSec)) return PLACEHOLDER
  const sec = Math.round(totalSec)
  return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`
}

// 9:48 (분을 줄여 쓰는 형식, Result)
export function formatDuration(totalSec: number | null): string {
  if (!isValid(totalSec)) return PLACEHOLDER
  const sec = Math.round(totalSec)
  return `${Math.floor(sec / 60)}:${pad2(sec % 60)}`
}

// 7′20″ (sec/km 정수 → 분′초″)
export function formatPace(secPerKm: number | null): string {
  if (!isValid(secPerKm) || secPerKm === 0) return PLACEHOLDER
  const sec = Math.round(secPerKm)
  return `${Math.floor(sec / 60)}′${pad2(sec % 60)}″`
}

// 0.84 (m → km, 소수 둘째 자리)
export function formatDistanceKm(distanceM: number | null): string {
  if (!isValid(distanceM)) return PLACEHOLDER
  return (distanceM / 1000).toFixed(2)
}

// 0.83 (m, 소수 둘째 자리)
export function formatMeters(meters: number | null): string {
  if (!isValid(meters)) return PLACEHOLDER
  return meters.toFixed(2)
}

// 156 (정수)
export function formatInteger(value: number | null): string {
  if (!isValid(value)) return PLACEHOLDER
  return String(Math.round(value))
}

// 10분 (정확히 분 단위일 때만, 아니면 null)
export function formatWholeMinutes(totalSec: number | null): string | null {
  if (!isValid(totalSec) || totalSec === 0 || totalSec % 60 !== 0) return null
  return `${totalSec / 60}분`
}

// 진행률(0~1). 계산할 수 없으면 0
export function getProgressRatio(elapsedSec: number | null, targetSec: number | null): number {
  if (!isValid(elapsedSec) || !isValid(targetSec) || targetSec === 0) return 0
  return Math.min(1, elapsedSec / targetSec)
}
