export function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatPace(minutes: number) {
  const whole = Math.floor(minutes)
  const seconds = Math.round((minutes - whole) * 60)
  return `${whole}:${String(seconds).padStart(2, '0')}`
}

