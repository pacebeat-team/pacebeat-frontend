import type { ManualPause, MeasurementSession, MetricsPair, MetricsPoint, MetricsState, SessionEndReason, SessionStatus } from './types.ts'

// 측정 세션의 저장과 읽기 (localStorage 등). 순수 함수에 가깝고, 어떤 경우에도 예외를 던지지 않는다.
// - storage가 없거나, 막혀 있거나, 가득 찼거나, 데이터가 손상됐어도 앱(측정)이 멈추면 안 된다.
//   실패는 반환값(false, null)으로만 알린다.
// - 저장하는 것은 session과 metrics뿐이다. GPS tracker는 저장하지 않는다(복원 뒤에 GPS를 다시 확인한다).
// - 읽을 때 형식을 하나씩 검사한다. 모양이 맞지 않는 데이터는 없는 것으로 보고 지운다.

export const STORAGE_KEY = 'pacebeat:measurement:v1'
export const STORAGE_VERSION = 1
// 마지막 저장으로부터 이 시간이 지난 데이터는 폐기한다.
export const MAX_AGE_MS = 30 * 60 * 1000

// Web Storage 중 쓰는 부분만. 테스트는 가짜를 넣는다.
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface PersistedMeasurement {
  readonly version: typeof STORAGE_VERSION
  readonly savedAt: number
  readonly session: MeasurementSession
  readonly metrics: MetricsState
}

// 브라우저의 localStorage. 접근 자체가 예외를 던질 수 있어(차단된 사이트 데이터 등) 안전하게 꺼낸다.
export function getBrowserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') {
      return null
    }
    return window.localStorage
  } catch {
    return null
  }
}

export function saveMeasurement(
  storage: StorageLike | null | undefined,
  data: { readonly session: MeasurementSession; readonly metrics: MetricsState },
  now: number,
): boolean {
  if (!storage) {
    return false
  }
  try {
    const payload: PersistedMeasurement = {
      version: STORAGE_VERSION,
      savedAt: now,
      session: data.session,
      metrics: data.metrics,
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    // 용량 초과, 저장 차단, 직렬화 실패 모두 저장만 포기한다.
    return false
  }
}

export function clearMeasurement(storage: StorageLike | null | undefined): boolean {
  if (!storage) {
    return false
  }
  try {
    storage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

// 저장된 측정을 읽는다. 없거나, 손상됐거나, 형식·버전이 다르거나, 30분이 지났으면 null이다.
// (없는 경우를 뺀 나머지는 쓸모없는 데이터이므로 지운다.)
export function loadMeasurement(storage: StorageLike | null | undefined, now: number): PersistedMeasurement | null {
  if (!storage) {
    return null
  }
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (raw === null) {
    return null
  }

  const parsed = parsePersisted(raw)
  // 저장 시각이 미래이면(시계가 바뀐 경우) 얼마나 오래됐는지 알 수 없으므로 믿지 않는다.
  if (parsed === null || !(parsed.savedAt <= now) || now - parsed.savedAt > MAX_AGE_MS) {
    clearMeasurement(storage)
    return null
  }
  return parsed
}

// --- 형식 검사 (as 없이 하나씩 좁힌다) ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isStatus(value: unknown): value is SessionStatus {
  return value === 'running' || value === 'paused' || value === 'finished'
}

function isEndReason(value: unknown): value is SessionEndReason {
  return value === 'user' || value === 'auto'
}

function parsePause(value: unknown): ManualPause | null {
  if (!isRecord(value) || !isFiniteNumber(value.pausedAt)) {
    return null
  }
  const { resumedAt } = value
  if (resumedAt !== null && !isFiniteNumber(resumedAt)) {
    return null
  }
  return { pausedAt: value.pausedAt, resumedAt }
}

function parseSession(value: unknown): MeasurementSession | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !isStatus(value.status)) {
    return null
  }
  const { id, status, startedAt, endedAt, endReason, pauses } = value
  if (!isFiniteNumber(startedAt) || !Array.isArray(pauses)) {
    return null
  }
  if (endedAt !== null && !isFiniteNumber(endedAt)) {
    return null
  }
  if (endReason !== null && !isEndReason(endReason)) {
    return null
  }
  // 종료 여부와 종료 시각·이유가 서로 맞아야 한다.
  if ((status === 'finished') !== (endedAt !== null) || (status === 'finished') !== (endReason !== null)) {
    return null
  }
  const parsedPauses: ManualPause[] = []
  for (const item of pauses) {
    const pause = parsePause(item)
    if (pause === null) {
      return null
    }
    parsedPauses.push(pause)
  }
  // 일시정지 중이면 마지막 구간이 열려 있어야 한다.
  if (status === 'paused' && parsedPauses[parsedPauses.length - 1]?.resumedAt !== null) {
    return null
  }
  return { id, status, startedAt, endedAt, endReason, pauses: parsedPauses }
}

function parsePoint(value: unknown): MetricsPoint | null {
  if (!isRecord(value) || !isFiniteNumber(value.lat) || !isFiniteNumber(value.lng) || !isFiniteNumber(value.at)) {
    return null
  }
  return { lat: value.lat, lng: value.lng, at: value.at }
}

function parsePair(value: unknown): MetricsPair | null {
  if (!isRecord(value) || !isFiniteNumber(value.from) || !isFiniteNumber(value.to) || !isNonNegative(value.distanceM)) {
    return null
  }
  return { from: value.from, to: value.to, distanceM: value.distanceM }
}

function parseMetrics(value: unknown): MetricsState | null {
  if (!isRecord(value) || !isNonNegative(value.distanceM) || !isNonNegative(value.validMs) || !Array.isArray(value.recent)) {
    return null
  }
  let lastFix: MetricsPoint | null = null
  if (value.lastFix !== null) {
    lastFix = parsePoint(value.lastFix)
    if (lastFix === null) {
      return null
    }
  }
  const recent: MetricsPair[] = []
  for (const item of value.recent) {
    const pair = parsePair(item)
    if (pair === null) {
      return null
    }
    recent.push(pair)
  }
  return { lastFix, distanceM: value.distanceM, validMs: value.validMs, recent }
}

function parsePersisted(raw: string): PersistedMeasurement | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(json) || json.version !== STORAGE_VERSION || !isFiniteNumber(json.savedAt)) {
    return null
  }
  const session = parseSession(json.session)
  const metrics = parseMetrics(json.metrics)
  if (session === null || metrics === null) {
    return null
  }
  return { version: STORAGE_VERSION, savedAt: json.savedAt, session, metrics }
}
