import type { StoreApi } from 'zustand/vanilla'
import { createMetrics } from '../measurement/metrics.ts'
import { deriveRecordId } from './record.ts'
import { createGpsRunState } from './runMetrics.ts'
import type { RunLiveData } from './runLive.ts'
import type { RunResultState } from './runResultStore.ts'
import { pauseRun } from './runSession.ts'
import { RunStorageError } from './runStorage.ts'
import type { RunSessionSnapshot, RunStorage } from './runStorage.ts'
import type { RunSessionStorage } from './runSessionStorage.ts'
import type { RunStoreState } from './runStore.ts'
import type { RunReflection } from './types.ts'

// 새로고침·재진입 뒤 러닝 세션 복원과 세션 저장(#48).
//
// 순서(바꾸지 않는다):
//   1) 복원: 저장된 세션을 읽어 Store에 넣는다. 이 동안 어떤 구독도 없으므로 "세션이 아직 없다"는 상태가 저장소를 지우지 않는다.
//   2) 복원이 끝난 뒤에만 Store 구독을 등록한다(status가 'restoring' → 'ready').
// 복원 규칙:
//   - 진행 중(running)이던 세션은 일시정지로 복원한다. 일시정지 시각은 마지막 저장 시각이다(새로고침 동안의 시간은 경과 시간에 넣지 않는다).
//   - 위치 수집·시계는 자동으로 시작하지 않는다. 사용자가 "계속 달리기"를 눌러야 runLive.resume이 같은 세션을 이어간다.
//   - 끝난 세션은 그대로 복원한다: 목표 도달 종료는 도착 화면, 일반 종료는 결과 화면으로 접근 규칙이 보낸다.
//   - 기록 저장을 마친 세션(같은 recordId의 기록이 있음), 만료, 손상은 복원하지 않고 세션 키를 지운다.
//   - 저장소를 읽을 수 없으면 아무것도 지우지 않는다. 지우기에 실패해도 앱은 계속 동작한다.

// 마지막 저장 성공 시각으로부터 24시간이 지나면 폐기한다(D13).
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000
// 거리 샘플만 늘어난 변경은 이 간격보다 자주 저장하지 않는다(상태·세션·끊김 구간 변경은 바로 저장한다).
export const SAMPLE_SAVE_MIN_INTERVAL_MS = 3000
// 진행 중 "마지막으로 확인한 시각"을 적는 간격. 만료 기준(updatedAt)은 바꾸지 않는다.
export const SEEN_SAVE_INTERVAL_MS = 5000

export type RestoreOutcome = 'none' | 'restored' | 'expired' | 'corrupt' | 'already-saved' | 'unavailable'

export interface RunSessionPersistenceStatus {
  readonly restore: 'restoring' | 'ready'
  readonly outcome: RestoreOutcome | null
  // 마지막 저장·삭제 시도의 실패 코드(성공하면 null). 화면에 보이지 않는 내부 상태이다.
  readonly lastSaveError: RunStorageError['code'] | null
  readonly lastRemoveError: RunStorageError['code'] | null
}

export interface RunSessionPersistenceDeps {
  readonly runs: StoreApi<RunStoreState>
  readonly results: StoreApi<RunResultState>
  readonly live: StoreApi<RunLiveData>
  readonly sessionStorage: RunSessionStorage
  // 저장된 기록 조회(같은 recordId가 이미 있으면 복원하지 않는다)
  readonly records: Pick<RunStorage, 'getRecord'>
  readonly now?: () => number
}

export interface RunSessionPersistence {
  getStatus: () => RunSessionPersistenceStatus
  stop: () => void
}

function isEmptyReflection(reflection: RunReflection): boolean {
  return reflection.difficulty === null && reflection.reasons.length === 0 && reflection.memo === ''
}

function errorCode(error: unknown): RunStorageError['code'] {
  return error instanceof RunStorageError ? error.code : 'write-failed'
}

// 복원한 세션의 거리 지표를 마지막 거리 샘플의 누적 거리로 이어 붙인다(0으로 되돌리지 않는다).
// 직전 좌표(lastFix)는 비워 둔다: 재개 후 첫 좌표는 새 구간의 시작점이 되어 끊긴 사이의 거리가 더해지지 않는다.
// 현재 페이스는 최근 좌표 쌍(recent)이 쌓이기 전까지 null이다.
export function seedGpsRunState(snapshot: RunSessionSnapshot) {
  const state = createGpsRunState()
  if (snapshot.mode !== 'gps') return state
  const last = snapshot.distanceSamples[snapshot.distanceSamples.length - 1]
  if (last === undefined) return state
  return { ...state, metrics: { ...createMetrics(), distanceM: last.distanceM } }
}

export function startRunSessionPersistence(deps: RunSessionPersistenceDeps): RunSessionPersistence {
  const { runs, results, live, sessionStorage, records } = deps
  const clock = deps.now ?? Date.now

  let status: RunSessionPersistenceStatus = { restore: 'restoring', outcome: null, lastSaveError: null, lastRemoveError: null }
  const update = (patch: Partial<RunSessionPersistenceStatus>) => {
    status = { ...status, ...patch }
  }

  // 세션 키와 회고 키를 지운다. 실패해도 던지지 않는다(다음 시작 때 같은 recordId 기록이 있으면 복원하지 않는다).
  function removeStored(): void {
    let failure: RunStorageError['code'] | null = null
    for (const remove of [sessionStorage.removeSession, sessionStorage.removeReflection, sessionStorage.removeSeen]) {
      try {
        remove()
      } catch (error) {
        failure = errorCode(error)
      }
    }
    update({ lastRemoveError: failure })
  }

  // ---- 1) 복원 -------------------------------------------------------------
  function restore(): RestoreOutcome {
    const read = sessionStorage.loadSession()
    if (read.status === 'unavailable') return 'unavailable'
    if (read.status === 'none') {
      // 세션 없이 남은 회고 키는 쓸모가 없다.
      try {
        sessionStorage.removeReflection()
      } catch {
        // 무시한다.
      }
      return 'none'
    }
    if (read.status === 'corrupt') {
      removeStored()
      return 'corrupt'
    }
    const { updatedAt, snapshot } = read.value
    const now = clock()
    if (now - updatedAt > SESSION_MAX_AGE_MS) {
      removeStored()
      return 'expired'
    }
    // 기록 저장은 성공했는데 세션 키 삭제가 실패했던 경우: 같은 recordId의 기록이 있으면 다시 복원하지 않는다.
    if (records.getRecord(deriveRecordId(snapshot.session.id)) !== null) {
      removeStored()
      return 'already-saved'
    }

    // 진행 중이던 세션은 마지막으로 확인한 시각(없으면 마지막 저장 시각)에 일시정지된 것으로 복원한다.
    const seen = sessionStorage.loadSeen()
    const seenAt = seen !== null && seen.sessionId === snapshot.session.id && seen.at <= now ? seen.at : updatedAt
    const session = snapshot.session.status === 'running' ? pauseRun(snapshot.session, Math.max(updatedAt, seenAt)) : snapshot.session
    const restored: RunSessionSnapshot = session === snapshot.session ? snapshot : { ...snapshot, session }
    runs.setState({ activeSession: restored })
    live.setState({ gps: seedGpsRunState(restored), now })

    // 결과에 반영한 회고만 복원한다(끝난 세션이고 같은 세션의 회고일 때).
    const reflection = sessionStorage.loadReflection()
    if (reflection !== null && reflection.sessionId === restored.session.id && restored.session.status === 'finished') {
      results.setState({ sessionId: reflection.sessionId, applied: reflection.applied })
    } else if (reflection !== null) {
      try {
        sessionStorage.removeReflection()
      } catch {
        // 무시한다.
      }
    }
    return 'restored'
  }

  const outcome = restore()
  update({ restore: 'ready', outcome })

  // ---- 2) 구독(복원이 끝난 뒤에만) -------------------------------------------
  let lastSavedAt = Number.NEGATIVE_INFINITY

  const stopRuns = runs.subscribe((state, previous) => {
    const snapshot = state.activeSession
    if (snapshot === previous.activeSession) return
    // 세션을 정리했다(저장 완료 후 정리, 저장하지 않고 종료): 저장된 세션도 함께 지운다.
    if (snapshot === null) {
      removeStored()
      return
    }
    // 기록 저장을 마친 세션은 이미 정리했으므로 다시 쓰지 않는다.
    if (results.getState().saved) return
    const before = previous.activeSession
    const samplesOnly =
      before !== null &&
      before.session === snapshot.session &&
      before.gpsGaps === snapshot.gpsGaps &&
      before.mode === snapshot.mode &&
      before.goal === snapshot.goal
    const now = clock()
    if (samplesOnly && now - lastSavedAt < SAMPLE_SAVE_MIN_INTERVAL_MS) return
    try {
      sessionStorage.saveSession(snapshot, now)
      lastSavedAt = now
      update({ lastSaveError: null })
    } catch (error) {
      // 저장에 실패하면 저장소의 이전 값(과 updatedAt)이 그대로 남는다. 메모리 상태는 계속 쓴다.
      update({ lastSaveError: errorCode(error) })
    }
  })

  const stopResults = results.subscribe((state, previous) => {
    // 기록 저장에 성공하면 세션·회고 임시 데이터를 바로 지운다(삭제에 실패해도 같은 recordId 기록으로 재복원을 막는다).
    if (state.saved && !previous.saved) {
      removeStored()
      return
    }
    if (state.saved || state.applied === previous.applied) return
    const active = runs.getState().activeSession
    if (state.sessionId === null || active === null || active.session.id !== state.sessionId || active.session.status !== 'finished') return
    try {
      if (isEmptyReflection(state.applied)) sessionStorage.removeReflection()
      else sessionStorage.saveReflection({ sessionId: state.sessionId, applied: state.applied })
      update({ lastSaveError: null })
    } catch (error) {
      update({ lastSaveError: errorCode(error) })
    }
  })

  // 진행 중인 동안 시계가 갱신될 때 마지막 확인 시각을 적는다(일시정지·종료 중에는 적지 않는다).
  let lastSeenAt = Number.NEGATIVE_INFINITY
  const stopLive = live.subscribe((state, previous) => {
    if (state.now === previous.now) return
    const active = runs.getState().activeSession
    if (active === null || active.session.status !== 'running' || results.getState().saved) return
    if (state.now - lastSeenAt < SEEN_SAVE_INTERVAL_MS) return
    try {
      sessionStorage.saveSeen({ sessionId: active.session.id, at: state.now })
      lastSeenAt = state.now
    } catch {
      // 무시한다(복원 시 마지막 저장 시각을 쓴다).
    }
  })

  return {
    getStatus: () => status,
    stop: () => {
      stopRuns()
      stopResults()
      stopLive()
    },
  }
}
