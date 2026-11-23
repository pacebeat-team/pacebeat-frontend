import assert from 'node:assert/strict'
import test from 'node:test'
import { RUN_STORAGE_KEYS } from '../running/runStorage.ts'
import type { RunRecord } from '../running/types.ts'
import { parseGrowthRecords, readGrowthRecords } from './growthRecords.ts'

function rec(id: string): RunRecord {
  return {
    recordId: id,
    sessionId: `s-${id}`,
    mode: 'gps',
    startedAt: 1_000,
    endedAt: 2_000,
    goal: { targetDistanceKm: 3, targetDurationSec: 1200 },
    musicTrackId: null,
    result: { elapsedMs: 1000, distanceM: 3000, avgPaceSecPerKm: 400, splits: [], completion: 'goal', gpsGaps: [] },
    reflection: null,
    sensorReport: null,
  }
}
const wrap = (data: unknown) => JSON.stringify({ version: 1, data })

test('기록이 저장된 적 없으면 기록 없음(오류 아님)', () => {
  assert.deepEqual(parseGrowthRecords(null), { ok: true, records: [], skipped: 0 })
  assert.deepEqual(parseGrowthRecords(wrap([])), { ok: true, records: [], skipped: 0 })
})

test('정상 기록은 그대로 읽는다', () => {
  const result = parseGrowthRecords(wrap([rec('a'), rec('b')]))
  assert.ok(result.ok)
  assert.deepEqual(result.records.map((r) => r.recordId), ['a', 'b'])
  assert.equal(result.skipped, 0)
})

test('전체가 손상(JSON 깨짐, 다른 버전, 배열 아님)되면 오류다', () => {
  for (const raw of ['{깨짐', JSON.stringify({ version: 9, data: [] }), JSON.stringify({ version: 1, data: 'x' }), JSON.stringify({ version: 1 }), '[]', '"x"']) {
    assert.deepEqual(parseGrowthRecords(raw), { ok: false, reason: 'unreadable' }, raw)
  }
})

test('저장된 항목이 있는데 읽을 수 있는 기록이 없으면 기록 없음이 아니라 오류다', () => {
  assert.deepEqual(parseGrowthRecords(wrap([{ recordId: 'bad' }])), { ok: false, reason: 'unreadable' })
  assert.deepEqual(parseGrowthRecords(wrap([null, 3, 'x'])), { ok: false, reason: 'unreadable' })
})

test('일부만 손상되면 읽을 수 있는 기록을 보여 주고 건너뛴 수를 알린다', () => {
  const result = parseGrowthRecords(wrap([rec('a'), { recordId: 'bad' }, rec('b'), 7]))
  assert.ok(result.ok)
  assert.deepEqual(result.records.map((r) => r.recordId), ['a', 'b'])
  assert.equal(result.skipped, 2)
})

test('저장소를 쓸 수 없거나 읽다가 예외가 나면 오류다', () => {
  assert.deepEqual(readGrowthRecords(null), { ok: false, reason: 'unavailable' })
  const throwing = {
    getItem: () => {
      throw new Error('denied')
    },
  }
  assert.deepEqual(readGrowthRecords(throwing), { ok: false, reason: 'unreadable' })
})

test('읽기만 하고 저장소를 바꾸지 않는다(손상된 원본 보존)', () => {
  const store = new Map<string, string>([[RUN_STORAGE_KEYS.records, wrap([rec('a'), { recordId: 'bad' }])]])
  const before = store.get(RUN_STORAGE_KEYS.records)
  const storage = { getItem: (key: string) => store.get(key) ?? null }
  const result = readGrowthRecords(storage)
  assert.ok(result.ok)
  assert.equal(store.get(RUN_STORAGE_KEYS.records), before)
  assert.equal(store.size, 1)
})
