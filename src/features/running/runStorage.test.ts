import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { STORAGE_KEY as MEASUREMENT_STORAGE_KEY } from '../measurement/sessionPersistence.ts'
import { buildRunRecord } from './record.ts'
import { startRun, stopRun } from './runSession.ts'
import { createDefaultDraft, createRunStorage, isRunRecord, RUN_STORAGE_KEYS, RunStorageError } from './runStorage.ts'
import type { RunKeyValueStorage } from './runStorage.ts'
import type { RunMode, RunRecord } from './types.ts'

const BASE = 1_700_000_000_000

function createMemoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  const storage: RunKeyValueStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
  return { storage, map }
}

function makeRecord(recordId: string, mode: RunMode = 'gps', durationMs = 600_000): RunRecord {
  const session = stopRun(startRun(null, BASE, () => `sess-${recordId}`), BASE + durationMs)
  return buildRunRecord({
    recordId,
    session,
    mode,
    goal: { targetDistanceKm: 3, targetDurationSec: 1320 },
    musicTrackId: null,
    distanceM: 1500,
    avgPaceSecPerKm: 400,
    distanceSamples: [{ elapsedMs: durationMs, distanceM: 1500 }],
    gpsGaps: [],
    goalReached: false,
  })
}

describe('저장 키', () => {
  test('전용 키 2개(목표 draft·완료 기록)이고 버전을 포함하며 기초 측정 키와 겹치지 않는다', () => {
    assert.deepEqual(RUN_STORAGE_KEYS, {
      draft: 'pacebeat:run:draft:v1',
      records: 'pacebeat:run:records:v1',
    })
    for (const key of Object.values(RUN_STORAGE_KEYS)) {
      assert.notEqual(key, MEASUREMENT_STORAGE_KEY)
      assert.ok(key.startsWith('pacebeat:run:'))
    }
  })
  test('러닝 저장은 기초 측정 키를 읽거나 쓰지 않는다', () => {
    const touched: string[] = []
    const inner = createMemoryStorage({ [MEASUREMENT_STORAGE_KEY]: 'measurement-data' })
    const storage = createRunStorage({
      getItem: (key) => (touched.push(key), inner.storage.getItem(key)),
      setItem: (key, value) => (touched.push(key), inner.storage.setItem(key, value)),
      removeItem: (key) => (touched.push(key), inner.storage.removeItem(key)),
    })
    storage.saveDraft(createDefaultDraft())
    storage.loadDraft()
    storage.saveRecord(makeRecord('a'))
    storage.loadRecords()
    assert.ok(!touched.includes(MEASUREMENT_STORAGE_KEY))
    assert.equal(inner.map.get(MEASUREMENT_STORAGE_KEY), 'measurement-data')
  })
})

describe('기록 저장(records)', () => {
  test('저장하고 다시 읽을 수 있다', () => {
    const storage = createRunStorage(createMemoryStorage().storage)
    storage.saveRecord(makeRecord('a'))
    assert.equal(storage.loadRecords().length, 1)
    assert.equal(storage.getRecord('a')?.recordId, 'a')
    assert.equal(storage.getRecord('missing'), null)
  })
  test('같은 recordId로 다시 저장하면 1건만 남고 내용은 덮어쓴다', () => {
    const storage = createRunStorage(createMemoryStorage().storage)
    storage.saveRecord(makeRecord('a'))
    storage.saveRecord(makeRecord('b'))
    storage.saveRecord({ ...makeRecord('a'), reflection: { difficulty: 'easy', reasons: [], memo: '좋았다' } })
    const records = storage.loadRecords()
    assert.equal(records.length, 2)
    assert.deepEqual(records.map((record) => record.recordId), ['a', 'b']) // 제자리 덮어쓰기
    assert.equal(records[0].reflection?.memo, '좋았다')
  })
  test('TIME 기록은 거리·페이스 null로 저장되고 그대로 읽힌다', () => {
    const storage = createRunStorage(createMemoryStorage().storage)
    storage.saveRecord(makeRecord('t', 'time'))
    const record = storage.getRecord('t')
    assert.equal(record?.result.distanceM, null)
    assert.equal(record?.result.avgPaceSecPerKm, null)
  })
  test('쓰기 실패는 RunStorageError(write-failed)로 알리고 기존 기록은 유지된다', () => {
    const memory = createMemoryStorage()
    const storage = createRunStorage(memory.storage)
    storage.saveRecord(makeRecord('a'))
    const failing = createRunStorage({
      ...memory.storage,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    assert.throws(
      () => failing.saveRecord(makeRecord('b')),
      (error) => error instanceof RunStorageError && error.code === 'write-failed',
    )
    assert.equal(storage.loadRecords().length, 1)
  })
  test('손상된 저장값·잘못된 기록은 건너뛴다', () => {
    const { storage: kv } = createMemoryStorage({
      [RUN_STORAGE_KEYS.records]: JSON.stringify({
        version: 1,
        data: [makeRecord('good'), { recordId: 'bad' }, makeRecord('time-with-distance', 'time')].map((record, index) =>
          index === 2 ? { ...record, result: { ...(record as RunRecord).result, distanceM: 100 } } : record,
        ),
      }),
    })
    const records = createRunStorage(kv).loadRecords()
    assert.deepEqual(records.map((record) => record.recordId), ['good'])
    assert.equal(createRunStorage(createMemoryStorage({ [RUN_STORAGE_KEYS.records]: '{깨짐' }).storage).loadRecords().length, 0)
    assert.equal(createRunStorage(createMemoryStorage({ [RUN_STORAGE_KEYS.records]: JSON.stringify({ version: 9, data: [] }) }).storage).loadRecords().length, 0)
  })
  test('readRecords: 없음·정상·손상·저장소 없음을 구분한다', () => {
    const key = RUN_STORAGE_KEYS.records
    assert.deepEqual(createRunStorage(createMemoryStorage().storage).readRecords(), { ok: true, records: [] })
    assert.deepEqual(createRunStorage(null).readRecords(), { ok: false, reason: 'unavailable' })
    for (const raw of ['{깨짐', JSON.stringify({ version: 9, data: [] }), JSON.stringify({ version: 1, data: 'x' }), JSON.stringify({ version: 1 })]) {
      assert.deepEqual(createRunStorage(createMemoryStorage({ [key]: raw }).storage).readRecords(), { ok: false, reason: 'unreadable' })
    }
    const throwing = createRunStorage({ getItem: () => { throw new Error('denied') }, setItem: () => {}, removeItem: () => {} })
    assert.deepEqual(throwing.readRecords(), { ok: false, reason: 'unreadable' })
    const mixed = createMemoryStorage({ [key]: JSON.stringify({ version: 1, data: [makeRecord('good'), { recordId: 'bad' }] }) })
    const result = createRunStorage(mixed.storage).readRecords()
    assert.equal(result.ok && result.records.map((record) => record.recordId).join(), 'good')
  })
  test('saveRecord: 읽을 수 없는 기존 항목을 지우지 않고 보존한다', () => {
    const key = RUN_STORAGE_KEYS.records
    const bad = { recordId: 'bad', note: '미래 버전 기록' }
    const memory = createMemoryStorage({ [key]: JSON.stringify({ version: 1, data: [bad, makeRecord('a')] }) })
    const storage = createRunStorage(memory.storage)
    storage.saveRecord(makeRecord('b'))
    storage.saveRecord(makeRecord('a', 'gps', 900_000))
    const data = (JSON.parse(memory.map.get(key) ?? '') as { data: unknown[] }).data
    assert.equal(data.length, 3)
    assert.deepEqual(data[0], bad)
    assert.deepEqual(storage.loadRecords().map((record) => record.recordId), ['a', 'b'])
  })
  test('isRunRecord: 센서 리포트가 null이 아니거나 회고 메모가 100자를 넘으면 거부한다', () => {
    const record = makeRecord('a')
    assert.equal(isRunRecord(record), true)
    assert.equal(isRunRecord({ ...record, sensorReport: { quality: 'good' } }), false)
    assert.equal(isRunRecord({ ...record, reflection: { difficulty: null, reasons: [], memo: 'ㅇ'.repeat(101) } }), false)
    assert.equal(isRunRecord({ ...record, reflection: { difficulty: null, reasons: [], memo: 'ㅇ'.repeat(100) } }), true)
  })
})

describe('draft 저장', () => {
  test('저장이 없으면 기본값(3km 22:30, 음악 없음, 최근 목표 없음)', () => {
    assert.deepEqual(createRunStorage(createMemoryStorage().storage).loadDraft(), {
      distanceKm: 3,
      targetDurationSec: 1350,
      musicTrackId: null,
      recentGoals: [],
    })
  })
  test('저장한 값을 읽는다', () => {
    const storage = createRunStorage(createMemoryStorage().storage)
    const draft = {
      distanceKm: 5 as const,
      targetDurationSec: 2400,
      musicTrackId: 'city-loop',
      recentGoals: [{ distanceKm: 3 as const, targetDurationSec: 1320 }],
    }
    storage.saveDraft(draft)
    assert.deepEqual(storage.loadDraft(), draft)
  })
  test('손상된 값은 기본값·보정값으로 읽는다(범위를 벗어난 시간은 제한, 최근 목표는 올바른 것만 최대 2개)', () => {
    const { storage: kv } = createMemoryStorage({
      [RUN_STORAGE_KEYS.draft]: JSON.stringify({
        version: 1,
        data: {
          distanceKm: 3,
          targetDurationSec: 1349,
          musicTrackId: 7,
          recentGoals: [
            { distanceKm: 3, targetDurationSec: 1320 },
            { distanceKm: 4, targetDurationSec: 1000 },
            { distanceKm: 1, targetDurationSec: 450 },
            { distanceKm: 5, targetDurationSec: 2400 },
          ],
        },
      }),
    })
    const draft = createRunStorage(kv).loadDraft()
    assert.equal(draft.targetDurationSec, 1349) // 범위 안의 정수 초는 그대로
    assert.equal(draft.musicTrackId, null)
    assert.equal(draft.recentGoals.length, 2)
    assert.deepEqual(createRunStorage(createMemoryStorage({ [RUN_STORAGE_KEYS.draft]: '###' }).storage).loadDraft(), createDefaultDraft())
  })
})

describe('저장소를 쓸 수 없는 환경', () => {
  test('읽기는 빈 값, 삭제는 무시, 쓰기는 unavailable 오류다', () => {
    const storage = createRunStorage(null)
    assert.deepEqual(storage.loadDraft(), createDefaultDraft())
    assert.deepEqual(storage.loadRecords(), [])
    assert.throws(
      () => storage.saveRecord(makeRecord('a')),
      (error) => error instanceof RunStorageError && error.code === 'unavailable',
    )
  })
  test('읽기가 예외를 던져도 빈 값으로 처리한다', () => {
    const storage = createRunStorage({
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    })
    assert.deepEqual(storage.loadRecords(), [])
    assert.deepEqual(storage.loadDraft(), createDefaultDraft())
  })
  test('localStorage가 없는 환경(Node)에서도 모듈 로드와 기본 저장소 생성이 안전하다', async () => {
    const { runStore } = await import('./runStore.ts')
    assert.equal(runStore.getState().activeSession, null)
    assert.doesNotThrow(() => createRunStorage())
  })
})
