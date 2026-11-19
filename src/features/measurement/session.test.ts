import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSessionId,
  getElapsedMs,
  getRunningMsBetween,
  isSessionActive,
  pauseSession,
  resumeSession,
  startSession,
  stopSession,
} from './session.ts'
import type { CryptoLike } from './session.ts'
import type { MeasurementSession } from './types.ts'

const BASE = 1_700_000_000_000
// 시작 시각(BASE)에서 s초 뒤의 시각
const t = (seconds: number) => BASE + seconds * 1000
const sec = (seconds: number) => seconds * 1000

const fixedId = () => 'session-a'

function start(at = 0): MeasurementSession {
  return startSession(null, t(at), fixedId)
}

// 입력을 수정하는 코드가 있으면 TypeError가 나도록 깊게 동결한다.
function deepFreeze(session: MeasurementSession): MeasurementSession {
  session.pauses.forEach((pause) => Object.freeze(pause))
  Object.freeze(session.pauses)
  return Object.freeze(session)
}

function assertInvariants(session: MeasurementSession) {
  const openPauses = session.pauses.filter((pause) => pause.resumedAt === null)
  assert.ok(openPauses.length <= 1, '열린 일시정지는 최대 1개')
  assert.equal(session.status === 'paused', openPauses.length === 1, 'paused일 때만 열린 일시정지가 있음')
  if (openPauses.length === 1) {
    assert.equal(session.pauses[session.pauses.length - 1].resumedAt, null, '열린 일시정지는 마지막')
  }
  if (session.status === 'finished') {
    assert.notEqual(session.endedAt, null)
    assert.notEqual(session.endReason, null)
    assert.equal(openPauses.length, 0, 'finished에는 열린 일시정지가 없음')
  } else {
    assert.equal(session.endedAt, null)
    assert.equal(session.endReason, null)
  }
  let cursor = session.startedAt
  for (const pause of session.pauses) {
    assert.ok(pause.pausedAt >= cursor, '일시정지는 정렬되고 겹치지 않음')
    if (pause.resumedAt === null) {
      cursor = pause.pausedAt
    } else {
      assert.ok(pause.resumedAt >= pause.pausedAt, '일시정지 길이는 음수가 아님')
      cursor = pause.resumedAt
    }
  }
  if (session.endedAt !== null) {
    assert.ok(session.endedAt >= cursor)
  }
}

// 같은 입력이면 항상 같은 결과가 나오는 난수(테스트 재현용)
function createRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

describe('startSession', () => {
  test('세션이 없으면 새 세션을 만든다', () => {
    assert.deepEqual(startSession(null, t(0), fixedId), {
      id: 'session-a',
      status: 'running',
      startedAt: t(0),
      endedAt: null,
      endReason: null,
      pauses: [],
    })
  })

  test('진행 중인 세션이 있으면 같은 객체를 돌려주고 id 생성 함수를 호출하지 않는다', () => {
    const running = start()
    let calls = 0
    const result = startSession(running, t(5), () => {
      calls += 1
      return 'session-b'
    })
    assert.equal(result, running)
    assert.equal(calls, 0)
  })

  test('일시정지 중인 세션이 있어도 새로 만들지 않는다', () => {
    const paused = pauseSession(start(), t(5))
    assert.equal(startSession(paused, t(9), () => 'session-b'), paused)
  })

  test('종료된 세션 뒤에는 새 세션(새 id)을 만든다', () => {
    const finished = stopSession(start(), t(10))
    const next = startSession(finished, t(20), () => 'session-b')
    assert.notEqual(next, finished)
    assert.equal(next.id, 'session-b')
    assert.equal(next.status, 'running')
    assert.equal(next.startedAt, t(20))
  })

  test('유효하지 않은 시각으로는 시작할 수 없다', () => {
    assert.throws(() => startSession(null, Number.NaN, fixedId), RangeError)
    assert.throws(() => startSession(null, Number.POSITIVE_INFINITY, fixedId), RangeError)
  })
})

describe('pauseSession / resumeSession', () => {
  test('진행 중에 일시정지하면 paused가 되고 경과 시간이 고정된다', () => {
    const paused = pauseSession(start(), t(10))
    assert.equal(paused.status, 'paused')
    assert.deepEqual(paused.pauses, [{ pausedAt: t(10), resumedAt: null }])
    assert.equal(getElapsedMs(paused, t(10)), sec(10))
    assert.equal(getElapsedMs(paused, t(500)), sec(10))
  })

  test('진행 중이 아니면 일시정지는 무시된다', () => {
    const paused = pauseSession(start(), t(10))
    const finished = stopSession(start(), t(10))
    assert.equal(pauseSession(paused, t(20)), paused)
    assert.equal(pauseSession(finished, t(20)), finished)
  })

  test('일시정지 중에 재개하면 running이 되고 같은 id를 유지한다', () => {
    const paused = pauseSession(start(), t(10))
    const resumed = resumeSession(paused, t(30))
    assert.equal(resumed.status, 'running')
    assert.equal(resumed.id, paused.id)
    assert.deepEqual(resumed.pauses, [{ pausedAt: t(10), resumedAt: t(30) }])
  })

  test('일시정지 중이 아니면 재개는 무시된다', () => {
    const running = start()
    const finished = stopSession(start(), t(10))
    assert.equal(resumeSession(running, t(5)), running)
    assert.equal(resumeSession(finished, t(20)), finished)
  })

  test('유효하지 않은 시각의 일시정지, 재개, 종료는 무시된다', () => {
    const running = start()
    const paused = pauseSession(running, t(5))
    assert.equal(pauseSession(running, Number.NaN), running)
    assert.equal(resumeSession(paused, Number.NaN), paused)
    assert.equal(stopSession(running, Number.NaN), running)
  })
})

describe('stopSession', () => {
  test('진행 중에 종료하면 finished가 되고 경과 시간이 고정된다', () => {
    const finished = stopSession(start(), t(50))
    assert.equal(finished.status, 'finished')
    assert.equal(finished.endedAt, t(50))
    assert.equal(finished.endReason, 'user')
    assert.deepEqual(finished.pauses, [])
    assert.equal(getElapsedMs(finished, t(50)), sec(50))
    assert.equal(getElapsedMs(finished, t(900)), sec(50))
  })

  test('측정 시간 도달로 종료하면 사유가 auto이다', () => {
    assert.equal(stopSession(start(), t(600), 'auto').endReason, 'auto')
  })

  test('이미 종료된 세션을 다시 종료해도 종료 시각을 덮어쓰지 않는다', () => {
    const finished = stopSession(start(), t(50))
    assert.equal(stopSession(finished, t(80), 'auto'), finished)
    assert.equal(finished.endedAt, t(50))
    assert.equal(finished.endReason, 'user')
  })

  test('일시정지 중에 종료하면 열린 일시정지를 종료 시각에 닫고 경과 시간은 그대로이다 (T5)', () => {
    const paused = pauseSession(start(), t(60))
    const finished = stopSession(paused, t(100))
    assert.equal(finished.status, 'finished')
    assert.equal(finished.endedAt, t(100))
    assert.deepEqual(finished.pauses, [{ pausedAt: t(60), resumedAt: t(100) }])
    assert.equal(getElapsedMs(finished, t(100)), sec(60))
    assert.equal(getElapsedMs(finished, t(1000)), sec(60))
  })
})

describe('getElapsedMs: 경과 시간은 수동 일시정지만 제외한다', () => {
  test('T1. 일시정지가 없으면 시작부터 현재까지 전부이다', () => {
    assert.equal(getElapsedMs(start(), t(150)), sec(150))
  })

  test('T2. 0초 시작, 60초 일시정지, 90초 재개, 150초 조회 → 120초', () => {
    const session = resumeSession(pauseSession(start(), t(60)), t(90))
    assert.equal(getElapsedMs(session, t(150)), sec(120))
  })

  test('10초 달림 → 20초 정지 → 재개 → 5초 달림 → 15초', () => {
    const session = resumeSession(pauseSession(start(), t(10)), t(30))
    assert.equal(getElapsedMs(session, t(35)), sec(15))
  })

  test('시작과 같은 밀리초에 일시정지하면 경과 시간은 0으로 유지된다 (경계값)', () => {
    const paused = pauseSession(start(), t(0)) // 시작 시각과 정확히 같음
    assert.deepEqual(paused.pauses, [{ pausedAt: t(0), resumedAt: null }])
    assert.equal(getElapsedMs(paused, t(0)), 0)
    assert.equal(getElapsedMs(paused, t(30)), 0)
    assert.equal(getElapsedMs(paused, t(3600)), 0)
    // 일시정지 중에는 어떤 구간도 달린 시간이 0이다 (1ms도 남지 않음)
    assert.equal(getRunningMsBetween(paused, t(0), t(30), t(30)), 0)
    // 재개한 시점부터만 센다
    const resumed = resumeSession(paused, t(30))
    assert.equal(getElapsedMs(resumed, t(40)), sec(10))
  })

  test('일시정지와 재개를 여러 번 반복해도 일시정지 시간만 빠진다', () => {
    let session = start()
    session = resumeSession(pauseSession(session, t(10)), t(30)) // 20초 정지
    session = resumeSession(pauseSession(session, t(40)), t(45)) // 5초 정지
    assert.equal(getElapsedMs(session, t(60)), sec(60 - 25))
  })

  test('T3. GPS가 끊겨도(세션에는 GPS 입력이 없다) 경과 시간은 그대로 흐른다', () => {
    // 10분 동안 세션 상태 변화가 없음 = GPS 끊김이 있어도 경과 시간에 모두 포함
    assert.equal(getElapsedMs(start(), t(600)), sec(600))
  })

  test('T4. 저장했다가 복원해도(재확인 대기 시간 포함) 경과 시간이 계속 흐른다', () => {
    const saved = JSON.stringify(start())
    const restored = JSON.parse(saved) as MeasurementSession
    assert.deepEqual(restored, start())
    // 100초에 새로고침, 130초에 복원 → 대기한 30초도 경과 시간에 포함
    assert.equal(getElapsedMs(restored, t(130)), sec(130))
  })

  test('T4b. 일시정지 중에 저장했다가 복원하면 일시정지가 유지된다', () => {
    const paused = pauseSession(start(), t(60))
    const restored = JSON.parse(JSON.stringify(paused)) as MeasurementSession
    assert.equal(restored.status, 'paused')
    assert.equal(getElapsedMs(restored, t(500)), sec(60))
  })

  test('유효하지 않은 now여도 유한한 값(마지막 사건 시점 기준)을 돌려준다', () => {
    const session = resumeSession(pauseSession(start(), t(10)), t(30))
    const elapsed = getElapsedMs(session, Number.NaN)
    assert.ok(Number.isFinite(elapsed))
    assert.equal(elapsed, getElapsedMs(session, t(30)))
  })
})

describe('getRunningMsBetween: 구간에서 수동 일시정지만 뺀 시간', () => {
  // 0초 시작, 20~30초 일시정지, 100초 현재(진행 중)
  const session = resumeSession(pauseSession(start(), t(20)), t(30))
  const now = t(100)

  test('T6. 일시정지와 겹치지 않는 구간은 길이 그대로이다', () => {
    assert.equal(getRunningMsBetween(session, t(40), t(60), now), sec(20))
  })

  test('T6b. 일시정지와 일부 또는 전부 겹치면 겹친 만큼 줄어든다', () => {
    assert.equal(getRunningMsBetween(session, t(10), t(25), now), sec(10)) // 앞쪽이 겹침
    assert.equal(getRunningMsBetween(session, t(25), t(40), now), sec(10)) // 뒤쪽이 겹침
    assert.equal(getRunningMsBetween(session, t(10), t(40), now), sec(20)) // 일시정지를 포함
    assert.equal(getRunningMsBetween(session, t(22), t(28), now), 0) // 일시정지 안
  })

  test('T6c. 세션 범위를 벗어난 구간은 세션 범위로 잘라 계산한다', () => {
    assert.equal(getRunningMsBetween(session, t(-50), t(10), now), sec(10)) // 시작 이전
    assert.equal(getRunningMsBetween(session, t(90), t(500), now), sec(10)) // 현재 이후
    const finished = stopSession(session, t(100))
    assert.equal(getRunningMsBetween(finished, t(90), t(500), t(900)), sec(10))
    assert.equal(getRunningMsBetween(finished, t(200), t(300), t(900)), 0) // 종료 이후
  })

  test('T6d. 거꾸로 된 구간, 잘못된 값은 0이고, 열린 일시정지는 세션 끝까지로 본다', () => {
    assert.equal(getRunningMsBetween(session, t(60), t(40), now), 0)
    assert.equal(getRunningMsBetween(session, Number.NaN, t(40), now), 0)
    const open = pauseSession(start(), t(20)) // 20초부터 일시정지 중
    assert.equal(getRunningMsBetween(open, t(0), t(50), t(50)), sec(20))
    assert.equal(getRunningMsBetween(open, t(10), t(50), t(50)), sec(10))
  })

  test('T7. 시각으로 나눈 구간들의 합은 경과 시간과 같다 (일시정지, 열린 일시정지 포함)', () => {
    const cuts = [0, 7, 20, 25, 31, 44, 60].map(t)
    const sessions = [
      resumeSession(pauseSession(start(), t(20)), t(30)),
      pauseSession(resumeSession(pauseSession(start(), t(5)), t(12)), t(40)), // 열린 일시정지
      stopSession(resumeSession(pauseSession(start(), t(20)), t(30)), t(50)), // 종료된 세션
    ]
    for (const target of sessions) {
      let sum = 0
      for (let index = 0; index < cuts.length - 1; index += 1) {
        sum += getRunningMsBetween(target, cuts[index], cuts[index + 1], t(60))
      }
      assert.equal(sum, getElapsedMs(target, t(60)))
    }
  })

  test('T8. 어떤 구간들의 합도 경과 시간을 넘지 않는다 (유효 시간 ≤ 경과 시간)', () => {
    const target = pauseSession(resumeSession(pauseSession(start(), t(15)), t(35)), t(70))
    const elapsed = getElapsedMs(target, t(80))
    const rng = createRng(2024)
    for (let round = 0; round < 200; round += 1) {
      // 서로 겹치지 않는 임의 구간 3개를 만든다(세션 범위 밖도 포함)
      const points = [rng(), rng(), rng(), rng(), rng(), rng()].map((value) => t(value * 110 - 15)).sort((a, b) => a - b)
      let sum = 0
      for (let index = 0; index < points.length; index += 2) {
        const part = getRunningMsBetween(target, points[index], points[index + 1], t(80))
        assert.ok(part >= 0)
        sum += part
      }
      assert.ok(sum <= elapsed, `구간 합(${sum})이 경과 시간(${elapsed})을 넘음`)
    }
  })
})

describe('시계 방어', () => {
  test('T9. 시스템 시계가 거꾸로 가도 일시정지 구간이 음수가 되거나 겹치지 않는다', () => {
    let session = start(0)
    session = resumeSession(pauseSession(session, t(10)), t(30))
    session = pauseSession(session, t(20)) // 직전 사건(30초)보다 이전 시각
    assert.deepEqual(session.pauses[1], { pausedAt: t(30), resumedAt: null })
    session = resumeSession(session, t(5)) // 일시정지 시각보다 이전 시각
    assert.deepEqual(session.pauses[1], { pausedAt: t(30), resumedAt: t(30) })
    assertInvariants(session)
    const finished = stopSession(session, t(1))
    assert.equal(finished.endedAt, t(30)) // 마지막 사건 시각으로 맞춤
    assertInvariants(finished)
  })

  test('조회 시각이 시작보다 이전이어도 경과 시간은 0이고, now가 커지면 줄어들지 않는다', () => {
    const session = resumeSession(pauseSession(start(10), t(20)), t(40))
    assert.equal(getElapsedMs(session, t(-100)), 0)
    let previous = 0
    for (let second = -20; second <= 200; second += 1) {
      const elapsed = getElapsedMs(session, t(second))
      assert.ok(elapsed >= previous, `${second}초에서 경과 시간이 줄어듦`)
      previous = elapsed
    }
  })
})

describe('불변성과 id', () => {
  test('입력을 동결해도 모든 함수가 오류 없이 동작하고 입력을 바꾸지 않는다', () => {
    const base = deepFreeze(start())
    const paused = deepFreeze(pauseSession(base, t(5)))
    const resumed = deepFreeze(resumeSession(paused, t(9)))
    const finished = deepFreeze(stopSession(resumed, t(20)))
    assert.deepEqual(base.pauses, [])
    assert.equal(paused.pauses.length, 1)
    assert.equal(resumed.pauses[0].resumedAt, t(9))
    assert.doesNotThrow(() => {
      startSession(finished, t(30), () => 'next')
      getElapsedMs(finished, t(40))
      getRunningMsBetween(finished, t(0), t(40), t(40))
    })
  })

  test('모든 전이를 거쳐도 같은 세션이면 id가 변하지 않는다', () => {
    const first = start()
    const chain = [
      pauseSession(first, t(5)),
      resumeSession(pauseSession(first, t(5)), t(9)),
      stopSession(resumeSession(pauseSession(first, t(5)), t(9)), t(20)),
    ]
    for (const session of chain) {
      assert.equal(session.id, first.id)
    }
  })

  test('T10. 연산 순서(역행하는 시각 포함)를 따라가며 불변식을 유지한다', () => {
    const operations: Array<[string, number]> = [
      ['start', 0], ['pause', 5], ['pause', 6], ['resume', 9], ['resume', 10], ['pause', 9],
      ['resume', 20], ['pause', 15], ['stop', 30], ['pause', 40], ['resume', 41], ['stop', 50],
      ['start', 60], ['stop', 70, ],
    ]
    let session: MeasurementSession | null = null
    for (const [name, at] of operations) {
      if (name === 'start') session = startSession(session, t(at), fixedId)
      else if (session === null) continue
      else if (name === 'pause') session = pauseSession(session, t(at))
      else if (name === 'resume') session = resumeSession(session, t(at))
      else session = stopSession(session, t(at))
      if (session !== null) assertInvariants(session)
    }
  })

  test('임의의 연산을 300번 이어서 해도 불변식이 유지되고 경과 시간은 항상 올바른 범위이다', () => {
    const rng = createRng(77)
    let counter = 0
    let session: MeasurementSession | null = null
    let clock = 0
    for (let step = 0; step < 300; step += 1) {
      clock += rng() * 20 - 4 // 가끔 거꾸로 감
      const pick = Math.floor(rng() * 4)
      if (pick === 0) {
        counter += 1
        session = startSession(session, t(clock), () => `session-${counter}`)
      } else if (session !== null) {
        session = [pauseSession, resumeSession, stopSession][pick - 1](session, t(clock))
      }
      if (session !== null) {
        assertInvariants(session)
        const end = session.endedAt ?? Math.max(t(clock), session.startedAt)
        const elapsed = getElapsedMs(session, t(clock))
        assert.ok(Number.isFinite(elapsed) && elapsed >= 0, '경과 시간은 0 이상의 유한한 값')
        assert.ok(elapsed <= end - session.startedAt, '경과 시간은 시작~끝 길이를 넘지 않음')
      }
    }
  })
})

describe('isSessionActive', () => {
  test('진행 중이거나 일시정지일 때만 활성이다', () => {
    const running = start()
    assert.equal(isSessionActive(null), false)
    assert.equal(isSessionActive(running), true)
    assert.equal(isSessionActive(pauseSession(running, t(5))), true)
    assert.equal(isSessionActive(stopSession(running, t(5))), false)
  })
})

describe('createSessionId', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  test('randomUUID가 있으면 그 값을 쓰고, 메서드로 호출한다', () => {
    const cryptoLike = {
      value: 'from-this',
      randomUUID() {
        return this.value
      },
    }
    assert.equal(createSessionId(cryptoLike), 'from-this')
  })

  test('randomUUID가 없으면 getRandomValues로 UUID v4를 만든다 (버전, 변형 비트)', () => {
    const fill = (byte: number) => ({
      getRandomValues: (array: Uint8Array) => array.fill(byte),
    })
    assert.equal(createSessionId(fill(0xff)), 'ffffffff-ffff-4fff-bfff-ffffffffffff')
    assert.equal(createSessionId(fill(0x00)), '00000000-0000-4000-8000-000000000000')
  })

  test('getRandomValues는 crypto 객체의 메서드로 호출한다 (떼어내 호출하면 브라우저에서 Illegal invocation)', () => {
    // 브라우저의 crypto처럼, 이 객체의 메서드로 호출되지 않으면 실패하는 가짜 crypto
    const strictCrypto: CryptoLike = {
      getRandomValues(array) {
        if (this !== strictCrypto) {
          throw new TypeError('Illegal invocation')
        }
        return crypto.getRandomValues(array)
      },
    }
    // 가짜 crypto가 실제로 "떼어내 호출"을 거부하는지 먼저 확인한다 (테스트가 아무것도 검증하지 못하는 상황 방지)
    const detached = strictCrypto.getRandomValues as (array: Uint8Array<ArrayBuffer>) => unknown
    assert.throws(() => detached(new Uint8Array(16)), TypeError)
    // 올바르게 메서드로 호출하면 UUID v4가 만들어진다
    assert.match(createSessionId(strictCrypto), UUID_V4)
  })

  test('실제 난수로 만든 id 1,000개는 형식이 맞고 서로 다르다', () => {
    const fallback = { getRandomValues: (array: Uint8Array<ArrayBuffer>) => crypto.getRandomValues(array) }
    const ids = new Set<string>()
    for (let index = 0; index < 1000; index += 1) {
      const id = createSessionId(fallback)
      assert.match(id, UUID_V4)
      ids.add(id)
    }
    assert.equal(ids.size, 1000)
  })

  test('기본값(실행 환경의 crypto)으로도 UUID v4를 만든다', () => {
    assert.match(createSessionId(), UUID_V4)
  })

  test('crypto를 쓸 수 없으면 오류를 던진다', () => {
    assert.throws(() => createSessionId({}), Error)
    assert.throws(() => createSessionId({ randomUUID: undefined, getRandomValues: undefined }), Error)
  })
})
