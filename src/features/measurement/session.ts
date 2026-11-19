import type { MeasurementSession, SessionEndReason } from './types.ts'

// 측정 세션 상태 관리 (순수 함수).
// - 타이머나 Date.now()를 직접 쓰지 않는다. 현재 시각(now)은 호출하는 쪽이 넘긴다.
// - 모든 함수는 입력을 수정하지 않고 새 객체를 돌려준다. 할 일이 없으면 같은 객체를 그대로 돌려준다.
// - 경과 시간 = (시작 ~ 현재/종료) − 사용자가 직접 일시정지한 시간.
//   GPS 끊김, 새로고침 후 GPS 재확인 대기 시간은 경과 시간에 포함된다.
// - 유효 측정 시간(유효 GPS 구간의 시간)은 GPS 데이터가 있어야 알 수 있으므로 이 파일이 아니라
//   다음 단계(GPS·거리·페이스)에서 getRunningMsBetween으로 계산한다.

// crypto.randomUUID는 HTTPS가 아닌 주소에서 쓸 수 없을 수 있어, getRandomValues로 대체할 수 있게 한다.
export interface CryptoLike {
  randomUUID?: () => string
  getRandomValues?: (array: Uint8Array<ArrayBuffer>) => unknown
}

const toHex = (byte: number) => byte.toString(16).padStart(2, '0')

export function createSessionId(cryptoLike: CryptoLike | undefined = globalThis.crypto): string {
  if (typeof cryptoLike?.randomUUID === 'function') {
    return cryptoLike.randomUUID()
  }

  if (typeof cryptoLike?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    cryptoLike.getRandomValues(bytes)
    // UUID v4: 버전(4)과 변형(10xx) 비트를 맞춘다.
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, toHex).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  throw new Error('세션 id를 만들 수 없습니다: crypto를 사용할 수 없는 환경입니다.')
}

export function isSessionActive(session: MeasurementSession | null): boolean {
  return session !== null && (session.status === 'running' || session.status === 'paused')
}

// 세션에서 가장 늦은 사건(시작, 일시정지, 재개, 종료)의 시각.
// 새 사건의 시각이 이보다 앞서지 않게 맞춰서, 시스템 시계가 거꾸로 가도 구간이 겹치거나 음수가 되지 않게 한다.
function getLastEventAt(session: MeasurementSession): number {
  let at = session.startedAt
  for (const pause of session.pauses) {
    at = Math.max(at, pause.pausedAt, pause.resumedAt ?? at)
  }
  if (session.endedAt !== null) {
    at = Math.max(at, session.endedAt)
  }
  return at
}

// 활성 세션(진행 중 또는 일시정지)이 있으면 새로 만들지 않고 그대로 돌려준다(중복 시작 방지).
// 이 경우 id 생성 함수도 호출하지 않는다. 세션이 없거나 종료됐으면 새 세션을 만든다.
export function startSession(
  current: MeasurementSession | null,
  now: number,
  createId: () => string = createSessionId,
): MeasurementSession {
  if (current !== null && isSessionActive(current)) {
    return current
  }
  if (!Number.isFinite(now)) {
    throw new RangeError('세션 시작 시각이 올바르지 않습니다.')
  }
  return {
    id: createId(),
    status: 'running',
    startedAt: now,
    endedAt: null,
    endReason: null,
    pauses: [],
  }
}

export function pauseSession(session: MeasurementSession, now: number): MeasurementSession {
  if (session.status !== 'running' || !Number.isFinite(now)) {
    return session
  }
  const pausedAt = Math.max(now, getLastEventAt(session))
  return {
    ...session,
    status: 'paused',
    pauses: [...session.pauses, { pausedAt, resumedAt: null }],
  }
}

export function resumeSession(session: MeasurementSession, now: number): MeasurementSession {
  if (session.status !== 'paused' || !Number.isFinite(now)) {
    return session
  }
  const resumedAt = Math.max(now, getLastEventAt(session))
  const openPause = session.pauses[session.pauses.length - 1]
  return {
    ...session,
    status: 'running',
    pauses: [...session.pauses.slice(0, -1), { ...openPause, resumedAt }],
  }
}

// 일시정지 중에 종료하면 열린 일시정지를 종료 시각에 닫는다(경과 시간은 일시정지 시점 값으로 고정).
export function stopSession(
  session: MeasurementSession,
  now: number,
  reason: SessionEndReason = 'user',
): MeasurementSession {
  if (session.status === 'finished' || !Number.isFinite(now)) {
    return session
  }
  const endedAt = Math.max(now, getLastEventAt(session))
  const pauses =
    session.status === 'paused'
      ? [...session.pauses.slice(0, -1), { ...session.pauses[session.pauses.length - 1], resumedAt: endedAt }]
      : session.pauses
  return {
    ...session,
    status: 'finished',
    endedAt,
    endReason: reason,
    pauses,
  }
}

// 세션이 끝나는 시각. 종료됐으면 종료 시각, 아니면 now(유효하지 않은 now면 마지막 사건 시각).
function getEndAt(session: MeasurementSession, now: number): number {
  if (session.endedAt !== null) {
    return session.endedAt
  }
  return Number.isFinite(now) ? Math.max(now, session.startedAt) : getLastEventAt(session)
}

// 구간 [from, to]에서 사용자가 직접 일시정지하지 않은 시간(ms).
// 구간은 세션의 [시작, 끝] 안으로 잘라서 계산하고, 열린 일시정지는 세션 끝까지로 본다.
// 경과 시간과 유효 측정 시간이 같은 계산을 쓰도록 이 함수 하나에서 일시정지 겹침을 처리한다.
export function getRunningMsBetween(
  session: MeasurementSession,
  from: number,
  to: number,
  now: number,
): number {
  const end = getEndAt(session, now)
  const low = Math.max(from, session.startedAt)
  const high = Math.min(to, end)
  if (!(high > low)) {
    return 0
  }

  let total = high - low
  for (const pause of session.pauses) {
    const pauseEnd = pause.resumedAt ?? end
    const overlap = Math.min(high, pauseEnd) - Math.max(low, pause.pausedAt)
    if (overlap > 0) {
      total -= overlap
    }
  }
  return Math.max(0, total)
}

// 경과 시간(ms): 시작부터 현재(종료됐으면 종료 시각)까지에서 수동 일시정지만 뺀 시간.
export function getElapsedMs(session: MeasurementSession, now: number): number {
  return getRunningMsBetween(session, session.startedAt, getEndAt(session, now), now)
}
