// 로컬(epoch ms) ↔ 서버(ISO 8601 문자열) 시각 변환. 해석할 수 없으면 null이다(현재 시각 등으로 채우지 않는다).
export function toIso(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function fromIso(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value === '') return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

export function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
