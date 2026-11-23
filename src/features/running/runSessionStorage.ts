import { isGoalDistance } from './goal.ts'
import { isValidReflection } from './reflection.ts'
import { RunStorageError } from './runStorage.ts'
import type { RunKeyValueStorage, RunSessionSnapshot } from './runStorage.ts'
import type { RunReflection } from './types.ts'

// 진행 중·끝난(저장 전) 러닝 세션의 저장소. 새로고침·재진입 뒤 복원에 쓴다(#48).
// - 완료한 기록(records)과 draft는 runStorage가 맡는다. 이 모듈은 전용 키 두 개만 읽고 쓴다.
// - 읽기는 예외를 던지지 않는다: 없음 / 손상 / 사용 불가를 구분해 돌려준다(사용 불가일 때 호출자는 아무것도 지우지 않는다).
// - 쓰기·삭제 실패는 RunStorageError로 알린다. 쓰기에 실패하면 저장소의 이전 값이 그대로 남으므로 updatedAt도 옛 값이다.
// - updatedAt은 "마지막으로 세션 저장에 성공한 시각"이다(만료 기준). 세션 시작·종료 시각은 쓰지 않는다.

export const RUN_SESSION_KEYS = Object.freeze({
  session: 'pacebeat:run:session:v1',
  // 결과에 반영(적용)한 회고. 시트에서 입력만 하고 적용하지 않은 값은 저장하지 않는다.
  reflection: 'pacebeat:run:reflection:v1',
  // 진행 중에 마지막으로 화면이 살아 있던 시각. 새로고침 때 일시정지 시각으로만 쓰고 만료(updatedAt)에는 영향을 주지 않는다.
  seen: 'pacebeat:run:seen:v1',
})

const VERSION = 1

export interface StoredRunSession {
  readonly updatedAt: number
  readonly snapshot: RunSessionSnapshot
}

export interface StoredRunReflection {
  readonly sessionId: string
  readonly applied: RunReflection
}

export interface StoredRunSeen {
  readonly sessionId: string
  readonly at: number
}

export type SessionReadResult =
  | { readonly status: 'none' }
  // 저장소를 읽을 수 없다(접근 차단). 값이 있는지 알 수 없으므로 지우지 않는다.
  | { readonly status: 'unavailable' }
  | { readonly status: 'corrupt' }
  | { readonly status: 'ok'; readonly value: StoredRunSession }

export interface RunSessionStorage {
  loadSession: () => SessionReadResult
  saveSession: (snapshot: RunSessionSnapshot, now: number) => void
  removeSession: () => void
  loadReflection: () => StoredRunReflection | null
  saveReflection: (value: StoredRunReflection) => void
  removeReflection: () => void
  loadSeen: () => StoredRunSeen | null
  saveSeen: (value: StoredRunSeen) => void
  removeSeen: () => void
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNumOrNull(value: unknown): value is number | null {
  return value === null || isNum(value)
}

// 저장된 값이 복원해도 안전한 세션 스냅샷인지 확인한다. 하나라도 어긋나면 손상으로 본다.
export function isValidSnapshot(value: unknown): value is RunSessionSnapshot {
  if (!isObject(value)) return false
  if (value.mode !== 'gps' && value.mode !== 'time') return false
  if (!isObject(value.goal)) return false
  const { targetDistanceKm, targetDurationSec } = value.goal
  if (targetDistanceKm !== null && !isGoalDistance(targetDistanceKm)) return false
  if (targetDurationSec !== null && !(isNum(targetDurationSec) && targetDurationSec > 0)) return false
  if (value.musicTrackId !== null && typeof value.musicTrackId !== 'string') return false

  const session = value.session
  if (!isObject(session)) return false
  if (typeof session.id !== 'string' || session.id === '') return false
  if (session.status !== 'running' && session.status !== 'paused' && session.status !== 'finished') return false
  if (!isNum(session.startedAt)) return false
  if (!isNumOrNull(session.endedAt)) return false
  if (session.endReason !== null && session.endReason !== 'user' && session.endReason !== 'auto') return false
  // 끝난 세션은 종료 시각과 원인이 있어야 한다. 진행 중인 세션에는 없어야 한다.
  const finished = session.status === 'finished'
  if (finished !== (session.endedAt !== null) || finished !== (session.endReason !== null)) return false
  if (!Array.isArray(session.pauses)) return false
  if (!session.pauses.every((pause) => isObject(pause) && isNum(pause.pausedAt) && isNumOrNull(pause.resumedAt))) return false

  if (!Array.isArray(value.distanceSamples)) return false
  let last = -Infinity
  let lastDistance = -Infinity
  for (const sample of value.distanceSamples) {
    if (!isObject(sample) || !isNum(sample.elapsedMs) || !isNum(sample.distanceM)) return false
    if (sample.elapsedMs < 0 || sample.distanceM < 0) return false
    if (sample.elapsedMs < last || sample.distanceM < lastDistance) return false
    last = sample.elapsedMs
    lastDistance = sample.distanceM
  }
  // TIME 모드는 거리·GPS 데이터가 없다.
  if (value.mode === 'time' && value.distanceSamples.length > 0) return false

  if (!Array.isArray(value.gpsGaps)) return false
  if (!value.gpsGaps.every((gap) => isObject(gap) && isNum(gap.lostAtMs) && isNumOrNull(gap.recoveredAtMs))) return false
  return true
}

export function createRunSessionStorage(storage: RunKeyValueStorage | null): RunSessionStorage {
  function readRaw(key: string): { readonly kind: 'none' | 'unavailable' | 'corrupt' } | { readonly kind: 'ok'; readonly data: unknown } {
    if (storage === null) return { kind: 'unavailable' }
    let raw: string | null
    try {
      raw = storage.getItem(key)
    } catch {
      return { kind: 'unavailable' }
    }
    if (raw === null) return { kind: 'none' }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isObject(parsed) || parsed.version !== VERSION || parsed.data === undefined) return { kind: 'corrupt' }
      return { kind: 'ok', data: parsed.data }
    } catch {
      return { kind: 'corrupt' }
    }
  }

  function write(key: string, data: unknown): void {
    if (storage === null) throw new RunStorageError('unavailable')
    try {
      storage.setItem(key, JSON.stringify({ version: VERSION, data }))
    } catch (error) {
      throw new RunStorageError('write-failed', error)
    }
  }

  function remove(key: string): void {
    if (storage === null) throw new RunStorageError('unavailable')
    try {
      storage.removeItem(key)
    } catch (error) {
      throw new RunStorageError('write-failed', error)
    }
  }

  return {
    loadSession: () => {
      const read = readRaw(RUN_SESSION_KEYS.session)
      if (read.kind !== 'ok') return { status: read.kind }
      const data = read.data
      if (!isObject(data) || !isNum(data.updatedAt) || !isValidSnapshot(data.snapshot)) return { status: 'corrupt' }
      return { status: 'ok', value: { updatedAt: data.updatedAt, snapshot: data.snapshot } }
    },
    saveSession: (snapshot, now) => write(RUN_SESSION_KEYS.session, { updatedAt: now, snapshot }),
    removeSession: () => remove(RUN_SESSION_KEYS.session),
    loadReflection: () => {
      const read = readRaw(RUN_SESSION_KEYS.reflection)
      if (read.kind !== 'ok') return null
      const data = read.data
      if (!isObject(data) || typeof data.sessionId !== 'string' || !isValidReflection(data.applied)) return null
      return { sessionId: data.sessionId, applied: data.applied }
    },
    saveReflection: (value) => write(RUN_SESSION_KEYS.reflection, value),
    removeReflection: () => remove(RUN_SESSION_KEYS.reflection),
    loadSeen: () => {
      const read = readRaw(RUN_SESSION_KEYS.seen)
      if (read.kind !== 'ok') return null
      const data = read.data
      if (!isObject(data) || typeof data.sessionId !== 'string' || !isNum(data.at)) return null
      return { sessionId: data.sessionId, at: data.at }
    },
    saveSeen: (value) => write(RUN_SESSION_KEYS.seen, value),
    removeSeen: () => remove(RUN_SESSION_KEYS.seen),
  }
}
