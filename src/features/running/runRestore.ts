import { pauseRun } from './runSession.ts'
import type { RunSessionSnapshot } from './runStorage.ts'

// 새로고침 뒤 저장된 러닝 세션을 어떻게 다룰지 정한다(순수 함수).
// - 진행 중이던 세션은 마지막으로 확인한 시각(lastSeenAt)에 일시정지한 상태로 되살린다(앱이 닫혀 있던 시간은 러닝 시간에 넣지 않는다).
// - 일시정지 중이던 세션은 그대로, 종료됐지만 저장하지 않은 결과는 결과 화면으로 되살린다.
// - 기준 시각에서 24시간이 지난 세션은 폐기한다.

export const RESTORE_MAX_AGE_MS = 24 * 60 * 60 * 1000

export type RestoreDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'discard'; readonly reason: 'expired' }
  | { readonly kind: 'restore'; readonly snapshot: RunSessionSnapshot; readonly resumedAs: 'paused' | 'finished' }

// 오래됐는지 가늠하는 기준 시각: 종료된 세션은 종료 시각, 나머지는 마지막으로 확인한 시각(없으면 시작 시각)
// 기기 시계가 되돌려졌거나 저장값이 미래 시각이면(now보다 뒤) 지금으로 본다: 일시정지 시각이 미래가 되어
// 앱이 닫혀 있던 시간이 러닝 시간에 들어가는 일을 막는다.
function referenceTime(snapshot: RunSessionSnapshot, now: number): number {
  const { session } = snapshot
  const raw = session.status === 'finished' ? (session.endedAt ?? session.startedAt) : Math.max(session.startedAt, snapshot.lastSeenAt ?? session.startedAt)
  return Number.isFinite(now) ? Math.min(raw, Math.max(now, session.startedAt)) : raw
}

export function decideRestore(snapshot: RunSessionSnapshot | null, now: number): RestoreDecision {
  if (snapshot === null) return { kind: 'none' }
  const age = Number.isFinite(now) ? Math.max(0, now - referenceTime(snapshot, now)) : 0
  if (age > RESTORE_MAX_AGE_MS) return { kind: 'discard', reason: 'expired' }
  const { session } = snapshot
  if (session.status === 'running') {
    const pausedAt = referenceTime(snapshot, now)
    return { kind: 'restore', resumedAs: 'paused', snapshot: { ...snapshot, session: pauseRun(session, pausedAt) } }
  }
  return { kind: 'restore', resumedAs: session.status === 'paused' ? 'paused' : 'finished', snapshot }
}
