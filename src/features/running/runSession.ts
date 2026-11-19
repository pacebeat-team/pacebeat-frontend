import {
  getElapsedMs,
  isSessionActive,
  pauseSession,
  resumeSession,
  startSession,
  stopSession,
} from '../measurement/session.ts'
import type { MeasurementSession } from '../measurement/types.ts'

// 러닝 세션 (순수 함수 래퍼).
// - 기초 측정의 세션 엔진(features/measurement/session.ts) 순수 함수를 그대로 쓴다. 기초 측정 Store는 쓰지 않는다.
// - 경과 시간에서 빼는 것은 사용자가 직접 한 일시정지뿐이다. 재개는 같은 session id를 유지한다.
// - 타이머나 Date.now()를 쓰지 않는다. 현재 시각(now)은 호출하는 쪽이 넘긴다.
// - TIME 모드도 같은 세션을 쓴다. 거리·GPS 없이 경과 시간만 계산한다.

export type RunSessionData = MeasurementSession

// 종료 원인: user(사용자가 종료) / goal(목표 거리 도달로 자동 종료). 엔진의 'auto'에 대응한다.
export type RunEndReason = 'user' | 'goal'

export function startRun(current: RunSessionData | null, now: number, createId?: () => string): RunSessionData {
  return startSession(current, now, createId)
}

export function pauseRun(session: RunSessionData, now: number): RunSessionData {
  return pauseSession(session, now)
}

export function resumeRun(session: RunSessionData, now: number): RunSessionData {
  return resumeSession(session, now)
}

export function stopRun(session: RunSessionData, now: number, reason: RunEndReason = 'user'): RunSessionData {
  return stopSession(session, now, reason === 'goal' ? 'auto' : 'user')
}

export function isRunActive(session: RunSessionData | null): boolean {
  return isSessionActive(session)
}

// 일시정지를 뺀 러닝 시간(ms). 종료된 세션은 종료 시각 기준으로 고정된다.
export function getRunElapsedMs(session: RunSessionData, now: number): number {
  return getElapsedMs(session, now)
}
