import { clampDurationSec, getDefaultDurationSec, isGoalDistance, isValidDurationSec } from './goal.ts'
import { isValidReflection } from './reflection.ts'
import type { RunSessionData } from './runSession.ts'
import type {
  DistanceSample,
  GoalDistanceKm,
  GpsGap,
  RunGoal,
  RunMode,
  RunRecord,
  RunSplit,
} from './types.ts'

// 일반 RUN 전용 저장소 (localStorage 호환 저장소를 주입해서 쓴다).
// - 저장 키는 모두 pacebeat:run: 으로 시작하며 기초 측정의 저장 키와 겹치지 않는다. 기초 측정 키를 읽거나 쓰지 않는다.
// - 읽기는 실패해도 예외를 던지지 않는다(없음·손상은 빈 값). 쓰기·삭제 실패는 RunStorageError로 알려, 호출자가 처리하게 한다.
// - 저장소 접근은 try/catch로 감싼다. 저장소를 못 쓰는 환경에서도 이 모듈을 불러오는 것만으로는 아무것도 하지 않는다.

export const RUN_STORAGE_KEYS = Object.freeze({
  draft: 'pacebeat:run:draft:v1',
  records: 'pacebeat:run:records:v1',
})

const STORAGE_VERSION = 1
const MAX_RECENT_GOALS = 2

export interface RunKeyValueStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

// unavailable: 저장소를 쓸 수 없음 / write-failed: 쓰기·삭제 실패(용량 초과 등)
export type RunStorageErrorCode = 'unavailable' | 'write-failed'

export class RunStorageError extends Error {
  readonly code: RunStorageErrorCode
  constructor(code: RunStorageErrorCode, cause?: unknown) {
    super(`러닝 저장소 오류: ${code}`)
    this.name = 'RunStorageError'
    this.code = code
    this.cause = cause
  }
}

// ---------------------------------------------------------------------------
// 저장 데이터 형태
// ---------------------------------------------------------------------------

export interface RecentGoal {
  readonly distanceKm: GoalDistanceKm
  readonly targetDurationSec: number
}

// 목표 draft. 다음 러닝을 준비할 때 이어서 쓰는 값이다.
export interface RunDraft {
  readonly distanceKm: GoalDistanceKm
  readonly targetDurationSec: number
  // 음악을 고르지 않았으면 null
  readonly musicTrackId: string | null
  // 최근 목표(최신순, 최대 2개)
  readonly recentGoals: readonly RecentGoal[]
}

// 진행 중 세션의 메모리 상태. 저장하지 않는다(완료한 러닝만 RunRecord로 저장한다).
export interface RunSessionSnapshot {
  readonly mode: RunMode
  readonly goal: RunGoal
  readonly musicTrackId: string | null
  readonly session: RunSessionData
  readonly distanceSamples: readonly DistanceSample[]
  readonly gpsGaps: readonly GpsGap[]
}

export function createDefaultDraft(): RunDraft {
  return {
    distanceKm: 3,
    targetDurationSec: getDefaultDurationSec(3),
    musicTrackId: null,
    recentGoals: [],
  }
}

// ---------------------------------------------------------------------------
// 값 검사 (저장된 데이터가 손상됐을 수 있으므로 읽을 때 모두 검사한다)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isNumberOrNull = (value: unknown): value is number | null => value === null || isFiniteNumber(value)
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'

function isValidGoal(value: unknown): value is RunGoal {
  if (!isRecord(value)) return false
  const { targetDistanceKm, targetDurationSec } = value
  if (targetDistanceKm === null) return targetDurationSec === null
  if (!isGoalDistance(targetDistanceKm)) return false
  return isFiniteNumber(targetDurationSec) && Number.isInteger(targetDurationSec) && targetDurationSec > 0
}

function isValidGap(value: unknown): value is GpsGap {
  return isRecord(value) && isFiniteNumber(value.lostAtMs) && isNumberOrNull(value.recoveredAtMs)
}

function isValidSplit(value: unknown): value is RunSplit {
  return (
    isRecord(value) &&
    isFiniteNumber(value.index) &&
    isFiniteNumber(value.distanceM) &&
    isFiniteNumber(value.durationMs) &&
    isNumberOrNull(value.paceSecPerKm)
  )
}

export function isRunRecord(value: unknown): value is RunRecord {
  if (!isRecord(value)) return false
  if (typeof value.recordId !== 'string' || value.recordId === '') return false
  if (typeof value.sessionId !== 'string' || value.sessionId === '') return false
  if (value.mode !== 'gps' && value.mode !== 'time') return false
  if (!isFiniteNumber(value.startedAt) || !isFiniteNumber(value.endedAt)) return false
  if (!isValidGoal(value.goal) || !isStringOrNull(value.musicTrackId)) return false
  if (value.sensorReport !== null) return false
  if (value.reflection !== null && !isValidReflection(value.reflection)) return false

  const result = value.result
  if (!isRecord(result)) return false
  if (!isFiniteNumber(result.elapsedMs) || !isNumberOrNull(result.distanceM) || !isNumberOrNull(result.avgPaceSecPerKm)) {
    return false
  }
  if (result.completion !== 'goal' && result.completion !== 'partial' && result.completion !== 'time') return false
  if (!Array.isArray(result.splits) || !result.splits.every(isValidSplit)) return false
  if (!Array.isArray(result.gpsGaps) || !result.gpsGaps.every(isValidGap)) return false

  // TIME 기록은 거리·페이스가 null이어야 하고 구간이 없어야 한다.
  if (value.mode === 'time') {
    return result.distanceM === null && result.avgPaceSecPerKm === null && result.splits.length === 0 && result.completion === 'time'
  }
  return result.completion !== 'time'
}

// ---------------------------------------------------------------------------
// 저장소
// ---------------------------------------------------------------------------

function getBrowserStorage(): RunKeyValueStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // 저장소 접근이 막힌 환경(비공개 모드 등)
  }
}

// 기록 읽기 결과. 기록이 없는 것(ok + 빈 배열)과 읽을 수 없는 것(오류)을 구분한다.
// unavailable: 저장소를 쓸 수 없음 / unreadable: 읽기 실패나 저장 데이터 전체가 손상됨
export type RecordsReadResult =
  | { readonly ok: true; readonly records: RunRecord[] }
  | { readonly ok: false; readonly reason: 'unavailable' | 'unreadable' }

export interface RunStorage {
  loadDraft: () => RunDraft
  saveDraft: (draft: RunDraft) => void
  loadRecords: () => RunRecord[]
  readRecords: () => RecordsReadResult
  getRecord: (recordId: string) => RunRecord | null
  // 같은 recordId는 덮어쓴다(중복 생성 없음).
  saveRecord: (record: RunRecord) => void
}

// storage를 주입하면 테스트에서 가짜 저장소를 쓸 수 있다. 생략하면 브라우저 localStorage를 쓰고, 쓸 수 없으면 null로 동작한다.
export function createRunStorage(storage: RunKeyValueStorage | null = getBrowserStorage()): RunStorage {
  function read(key: string): unknown {
    if (storage === null) return null
    try {
      const raw = storage.getItem(key)
      if (raw === null) return null
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) return null
      return parsed.data ?? null
    } catch {
      return null // 읽기 실패, 손상된 JSON
    }
  }

  function write(key: string, data: unknown): void {
    if (storage === null) throw new RunStorageError('unavailable')
    try {
      storage.setItem(key, JSON.stringify({ version: STORAGE_VERSION, data }))
    } catch (error) {
      throw new RunStorageError('write-failed', error)
    }
  }

  function loadRecords(): RunRecord[] {
    const data = read(RUN_STORAGE_KEYS.records)
    return Array.isArray(data) ? data.filter(isRunRecord) : []
  }

  // 저장된 배열을 그대로(유효하지 않은 항목 포함) 읽는다. 없으면 [], 읽을 수 없거나 배열이 아니면 null.
  function readRawRecords(): unknown[] | null {
    if (storage === null) return null
    try {
      const raw = storage.getItem(RUN_STORAGE_KEYS.records)
      if (raw === null) return []
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.data)) return null
      return parsed.data
    } catch {
      return null
    }
  }

  function readRecords(): RecordsReadResult {
    if (storage === null) return { ok: false, reason: 'unavailable' }
    const items = readRawRecords()
    if (items === null) return { ok: false, reason: 'unreadable' }
    return { ok: true, records: items.filter(isRunRecord) }
  }

  return {
    loadDraft: () => {
      const data = read(RUN_STORAGE_KEYS.draft)
      const defaults = createDefaultDraft()
      if (!isRecord(data) || !isGoalDistance(data.distanceKm)) return defaults
      const distanceKm = data.distanceKm
      const recentGoals = Array.isArray(data.recentGoals)
        ? data.recentGoals
            .filter(
              (goal): goal is RecentGoal =>
                isRecord(goal) && isGoalDistance(goal.distanceKm) && isValidDurationSec(goal.distanceKm, goal.targetDurationSec),
            )
            .slice(0, MAX_RECENT_GOALS)
        : []
      return {
        distanceKm,
        targetDurationSec: isFiniteNumber(data.targetDurationSec)
          ? clampDurationSec(distanceKm, data.targetDurationSec)
          : getDefaultDurationSec(distanceKm),
        musicTrackId: typeof data.musicTrackId === 'string' ? data.musicTrackId : null,
        recentGoals,
      }
    },
    saveDraft: (draft) => write(RUN_STORAGE_KEYS.draft, draft),

    loadRecords,
    readRecords,
    getRecord: (recordId) => loadRecords().find((record) => record.recordId === recordId) ?? null,
    saveRecord: (record) => {
      // 읽을 수 없는 항목도 그대로 남긴다(다른 기록을 지우지 않는다). 저장 데이터 전체를 읽을 수 없으면 새로 시작한다.
      const saved = readRawRecords() ?? []
      const isSame = (item: unknown) => isRunRecord(item) && item.recordId === record.recordId
      const index = saved.findIndex(isSame)
      // 같은 recordId는 첫 항목만 제자리에서 덮어쓴다(같은 id가 겹친 손상 데이터의 다른 항목을 건드리지 않는다). 새 기록은 끝에 추가한다.
      write(RUN_STORAGE_KEYS.records, index === -1 ? [...saved, record] : saved.map((item, i) => (i === index ? record : item)))
    },
  }
}
