// 러닝 준비 화면용 표시 문자열. 값은 바꾸지 않고 문자열만 만든다.

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

// 초 → m:ss (예: 1260 → "21:00")
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}

// 초/km → m:ss (예: 420 → "7:00")
export function formatPace(secPerKm: number): string {
  return formatDuration(secPerKm)
}

// 초 → "21분", "7분 30초"
export function formatDurationKorean(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return seconds === 0 ? `${minutes}분` : `${minutes}분 ${seconds}초`
}

// "3 km · 22:00"
export function formatGoalChip(distanceKm: number, durationSec: number): string {
  return `${distanceKm} km · ${formatDuration(durationSec)}`
}
