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

// 목표 거리: 소수 첫째 자리까지 ("3.0")
export function formatDistanceKm(distanceKm: number): string {
  return distanceKm.toFixed(1)
}

// 경과 시간(ms) → "09:51", 1시간 이상이면 "1:02:03". 진행 화면의 큰 시계에 쓴다.
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

// 거리(m) → km 소수 둘째 자리 버림 ("1.42"). 반올림하지 않아 목표 도달 전에 목표 값으로 보이지 않는다.
export function formatDistanceKm2(distanceM: number): string {
  const hundredths = Math.floor(Math.max(0, Number.isFinite(distanceM) ? distanceM : 0) / 10)
  return (hundredths / 100).toFixed(2)
}

// 페이스(초/km) → "6:56", 없으면 "—"
export function formatPaceOrDash(secPerKm: number | null): string {
  return secPerKm === null ? '—' : formatPace(secPerKm)
}

// 남은 거리(m) → km 소수 둘째 자리 올림. 목표에 아직 못 미쳤는데 "0.00 km 남았어요"로 보이지 않는다.
export function formatRemainingKm2(remainingM: number): string {
  const safe = Math.max(0, Number.isFinite(remainingM) ? remainingM : 0)
  return (Math.ceil(safe / 10 - 1e-9) / 100).toFixed(2)
}
