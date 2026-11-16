import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_AGE_MS,
  STORAGE_KEY,
  clearMeasurement,
  loadMeasurement,
  saveMeasurement,
} from './sessionPersistence.ts'
import type { StorageLike } from './sessionPersistence.ts'
import { pauseSession, startSession, stopSession } from './session.ts'
import type { MetricsState } from './types.ts'

const BASE = 1_700_000_000_000

// 호출 기록이 남는 가짜 storage
function createFakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  const calls: string[] = []
  const storage: StorageLike = {
    getItem(key) {
      calls.push(`get:${key}`)
      return data.get(key) ?? null
    },
    setItem(key, value) {
      calls.push(`set:${key}`)
      data.set(key, value)
    },
    removeItem(key) {
      calls.push(`remove:${key}`)
      data.delete(key)
    },
  }
  return { storage, data, calls }
}

const session = startSession(null, BASE, () => 'sid')
const metrics: MetricsState = {
  lastFix: { lat: 1, lng: 2, at: BASE + 5000 },
  distanceM: 123.5,
  validMs: 40_000,
  recent: [{ from: BASE + 4000, to: BASE + 5000, distanceM: 3 }],
}
const valid = { version: 1, savedAt: BASE, session, metrics }

describe('saveMeasurement', () => {
  test('키는 pacebeat:measurement:v1이고 {version, savedAt, session, metrics}만 저장한다 (tracker 없음)', () => {
    const { storage, data } = createFakeStorage()
    assert.equal(STORAGE_KEY, 'pacebeat:measurement:v1')
    assert.equal(saveMeasurement(storage, { session, metrics }, BASE + 10), true)
    assert.deepEqual([...data.keys()], ['pacebeat:measurement:v1'])
    const saved = JSON.parse(data.get(STORAGE_KEY) ?? '')
    assert.deepEqual(Object.keys(saved).sort(), ['metrics', 'savedAt', 'session', 'version'])
    assert.equal(saved.version, 1)
    assert.equal(saved.savedAt, BASE + 10)
    assert.deepEqual(saved.session, session)
    assert.deepEqual(saved.metrics, metrics)
  })

  test('storage가 없거나 setItem이 예외를 던져도 throw하지 않고 false이다', () => {
    assert.equal(saveMeasurement(null, { session, metrics }, BASE), false)
    assert.equal(saveMeasurement(undefined, { session, metrics }, BASE), false)
    const full: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: () => {},
    }
    assert.equal(saveMeasurement(full, { session, metrics }, BASE), false)
  })

  test('직렬화할 수 없는 값(순환 참조)이어도 throw하지 않는다', () => {
    const { storage } = createFakeStorage()
    const circular: { self?: unknown } = {}
    circular.self = circular
    const bad = { session, metrics: { ...metrics, recent: [circular] } }
    // @ts-expect-error 일부러 잘못된 모양을 넣는다
    assert.equal(saveMeasurement(storage, bad, BASE), false)
  })
})

describe('loadMeasurement', () => {
  test('저장한 값을 그대로 읽는다 (진행 중, 일시정지, 종료)', () => {
    const paused = pauseSession(session, BASE + 1000)
    const finished = stopSession(session, BASE + 9000, 'auto')
    for (const s of [session, paused, finished]) {
      const { storage } = createFakeStorage()
      saveMeasurement(storage, { session: s, metrics }, BASE)
      assert.deepEqual(loadMeasurement(storage, BASE + 1000), { version: 1, savedAt: BASE, session: s, metrics })
    }
  })

  test('저장된 것이 없으면 null이고 아무것도 지우지 않는다', () => {
    const { storage, calls } = createFakeStorage()
    assert.equal(loadMeasurement(storage, BASE), null)
    assert.deepEqual(calls, [`get:${STORAGE_KEY}`])
  })

  test('storage가 없거나 getItem이 예외를 던져도 null이다', () => {
    assert.equal(loadMeasurement(null, BASE), null)
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {},
      removeItem: () => {},
    }
    assert.equal(loadMeasurement(broken, BASE), null)
  })

  test('30분 이내는 읽고, 30분을 넘기면 null이며 삭제한다', () => {
    const { storage, data } = createFakeStorage({ [STORAGE_KEY]: JSON.stringify(valid) })
    assert.notEqual(loadMeasurement(storage, BASE + MAX_AGE_MS), null) // 정확히 30분은 아직 유효
    assert.equal(loadMeasurement(storage, BASE + MAX_AGE_MS + 1), null)
    assert.equal(data.has(STORAGE_KEY), false)
  })

  test('저장 시각이 미래이면 믿지 않고 삭제한다', () => {
    const { storage, data } = createFakeStorage({ [STORAGE_KEY]: JSON.stringify({ ...valid, savedAt: BASE + 5000 }) })
    assert.equal(loadMeasurement(storage, BASE), null)
    assert.equal(data.has(STORAGE_KEY), false)
  })

  test('손상된 JSON, 잘못된 타입, 버전 불일치는 null이며 삭제한다', () => {
    const bad: [string, string][] = [
      ['깨진 JSON', '{"version":1,'],
      ['빈 문자열', ''],
      ['null', 'null'],
      ['배열', '[]'],
      ['숫자', '42'],
      ['버전 불일치', JSON.stringify({ ...valid, version: 2 })],
      ['버전 없음', JSON.stringify({ savedAt: BASE, session, metrics })],
      ['savedAt 문자열', JSON.stringify({ ...valid, savedAt: 'now' })],
      ['session 없음', JSON.stringify({ version: 1, savedAt: BASE, metrics })],
      ['metrics 없음', JSON.stringify({ version: 1, savedAt: BASE, session })],
      ['status 모름', JSON.stringify({ ...valid, session: { ...session, status: 'zzz' } })],
      ['id 숫자', JSON.stringify({ ...valid, session: { ...session, id: 7 } })],
      ['startedAt 문자열', JSON.stringify({ ...valid, session: { ...session, startedAt: '1' } })],
      ['pauses가 배열 아님', JSON.stringify({ ...valid, session: { ...session, pauses: {} } })],
      ['pause 항목 손상', JSON.stringify({ ...valid, session: { ...session, pauses: [{ pausedAt: 'x', resumedAt: null }] } })],
      ['종료인데 endedAt 없음', JSON.stringify({ ...valid, session: { ...session, status: 'finished' } })],
      ['진행 중인데 endedAt 있음', JSON.stringify({ ...valid, session: { ...session, endedAt: BASE } })],
      ['일시정지인데 열린 구간 없음', JSON.stringify({ ...valid, session: { ...session, status: 'paused', pauses: [] } })],
      ['distanceM 음수', JSON.stringify({ ...valid, metrics: { ...metrics, distanceM: -1 } })],
      ['validMs null', JSON.stringify({ ...valid, metrics: { ...metrics, validMs: null } })],
      ['lastFix 손상', JSON.stringify({ ...valid, metrics: { ...metrics, lastFix: { lat: 1 } } })],
      ['recent 항목 손상', JSON.stringify({ ...valid, metrics: { ...metrics, recent: [{ from: 1 }] } })],
    ]
    for (const [name, raw] of bad) {
      const { storage, data } = createFakeStorage({ [STORAGE_KEY]: raw })
      assert.equal(loadMeasurement(storage, BASE + 1000), null, name)
      assert.equal(data.has(STORAGE_KEY), false, `${name}: 삭제`)
    }
  })

  test('removeItem이 예외를 던져도 손상 데이터 처리에서 throw하지 않는다', () => {
    const storage: StorageLike = {
      getItem: () => 'not json',
      setItem: () => {},
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    assert.equal(loadMeasurement(storage, BASE), null)
  })
})

describe('clearMeasurement', () => {
  test('저장분을 지우고, storage가 없거나 예외가 나도 throw하지 않는다', () => {
    const { storage, data } = createFakeStorage({ [STORAGE_KEY]: 'x' })
    assert.equal(clearMeasurement(storage), true)
    assert.equal(data.has(STORAGE_KEY), false)
    assert.equal(clearMeasurement(null), false)
    const broken: StorageLike = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    assert.equal(clearMeasurement(broken), false)
  })
})
