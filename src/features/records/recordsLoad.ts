import type { RecordsReadResult } from '../running/runStorage.ts'
import type { RunRecord } from '../running/types.ts'

// 기록 화면의 조회 상태 (순수 상태 모델 + 작은 로더).
// - 처음 조회: loading → ready / empty / error.
// - 이미 기록을 갖고 있을 때 다시 조회: 기록을 그대로 보이면서 refreshing. 성공하면 갱신, 0건이면 empty, 실패하면 기록을 유지하고 refreshError만 켠다.
// - 화면에 보이는 것은 Figma가 정의한 Loading / Empty / Error 카드와 기록 화면뿐이다.
//   "기록은 유지하고 새로 고침만 실패"한 상태의 표현은 Figma에 없으므로 여기서는 값(refreshError)으로만 구분한다.
// - 지금 저장소 읽기는 동기이므로 기본 스케줄러는 즉시 완료한다(Loading을 일부러 길게 보이지 않는다).
//   지연은 테스트가 스케줄러를 바꿔 만든다.

export type RecordsPhase = 'loading' | 'ready' | 'empty' | 'error'

export interface RecordsLoadState {
  readonly phase: RecordsPhase
  // phase가 ready일 때만 비어 있지 않다.
  readonly records: readonly RunRecord[]
  // 기록을 보이는 채로 다시 조회하는 중
  readonly refreshing: boolean
  // 기록을 보이는 채로 다시 조회했으나 실패했다(기록은 유지)
  readonly refreshError: boolean
}

export const INITIAL_RECORDS_LOAD: RecordsLoadState = Object.freeze({
  phase: 'loading',
  records: [],
  refreshing: false,
  refreshError: false,
})

// 조회를 시작한다. 보이는 기록이 있으면 유지하고, 없으면 Loading 화면으로 간다(Error의 "다시 시도"도 Loading을 거친다).
export function beginLoad(state: RecordsLoadState): RecordsLoadState {
  if (state.phase === 'ready' && state.records.length > 0) {
    return { ...state, refreshing: true, refreshError: false }
  }
  return INITIAL_RECORDS_LOAD
}

// 조회 결과를 반영한다.
export function completeLoad(state: RecordsLoadState, result: RecordsReadResult): RecordsLoadState {
  if (result.ok) {
    if (result.records.length === 0) return { phase: 'empty', records: [], refreshing: false, refreshError: false }
    return { phase: 'ready', records: result.records, refreshing: false, refreshError: false }
  }
  // 실패: 이미 보이는 기록이 있으면 지우지 않는다.
  if (state.phase === 'ready' && state.records.length > 0) {
    return { ...state, refreshing: false, refreshError: true }
  }
  return { phase: 'error', records: [], refreshing: false, refreshError: false }
}

function safeRead(read: () => RecordsReadResult): RecordsReadResult {
  try {
    return read()
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

export interface RecordsLoader {
  getState: () => RecordsLoadState
  subscribe: (listener: () => void) => () => void
  // 조회를 시작한다. 이전 조회가 끝나기 전에 다시 부르면 이전 결과는 버린다(마지막 조회만 반영).
  load: () => void
}

// schedule: 읽기를 언제 실행할지. 기본은 즉시.
export function createRecordsLoader(
  read: () => RecordsReadResult,
  schedule: (run: () => void) => void = (run) => run(),
): RecordsLoader {
  let state = INITIAL_RECORDS_LOAD
  let generation = 0
  const listeners = new Set<() => void>()
  const set = (next: RecordsLoadState) => {
    state = next
    listeners.forEach((listener) => listener())
  }
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    load: () => {
      generation += 1
      const mine = generation
      set(beginLoad(state))
      schedule(() => {
        if (mine !== generation) return
        set(completeLoad(state, safeRead(read)))
      })
    },
  }
}
