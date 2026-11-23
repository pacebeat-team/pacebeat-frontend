import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { exportRecords } from '../my/dataExport.ts'
import { deleteRunRecords } from '../my/dataDelete.ts'
import { buildRunRecord } from './record.ts'
import { startRun, stopRun } from './runSession.ts'
import { createRunStorage, isRunRecord, parseRunRecord, RUN_STORAGE_KEYS } from './runStorage.ts'
import type { RunKeyValueStorage } from './runStorage.ts'

const BASE = 1_700_000_000_000

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  const storage: RunKeyValueStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
  return { storage, map }
}

function makeRecord(recordId: string) {
  const session = stopRun(startRun(null, BASE, () => `s-${recordId}`), BASE + 600_000)
  return buildRunRecord({
    recordId,
    session,
    mode: 'gps',
    goal: { targetDistanceKm: 3, targetDurationSec: 1320 },
    musicTrackId: null,
    distanceM: 1500,
    avgPaceSecPerKm: 400,
    distanceSamples: [{ elapsedMs: 600_000, distanceM: 1500 }],
    gpsGaps: [],
    goalReached: false,
  })
}

const VALID = { measuredSide: 'both', balance: { left: 47, right: 53 }, pressure: { heel: 60, mid: 30, forefoot: 10 } }
const stored = (...items: unknown[]) => JSON.stringify({ version: 1, data: items })

describe('자세 요약 검증 분리(러닝 기록 보존)', () => {
  test('sensorReport가 null인 기존 기록은 그대로 유효하다', () => {
    const record = makeRecord('rec-old')
    assert.equal(isRunRecord(record), true)
    assert.equal(parseRunRecord(record)?.sensorReport, null)
  })
  test('손상된 sensorReport가 있어도 기록은 읽히고 sensorReport만 null이 된다', () => {
    const base = makeRecord('rec-bad')
    for (const broken of [{ quality: 'good' }, 'x', 5, { ...VALID, balance: { left: 10, right: 10 } }, { ...VALID, measuredSide: 'both', balance: null }]) {
      const { storage } = memory({ [RUN_STORAGE_KEYS.records]: stored({ ...base, sensorReport: broken }) })
      const records = createRunStorage(storage).loadRecords()
      assert.equal(records.length, 1)
      assert.equal(records[0].recordId, 'rec-bad')
      assert.equal(records[0].result.distanceM, 1500)
      assert.equal(records[0].result.avgPaceSecPerKm, 400)
      assert.equal(records[0].sensorReport, null)
    }
  })
  test('sensorReport가 없는(필드 누락) 기록도 읽힌다', () => {
    const { sensorReport: omitted, ...withoutField } = makeRecord('rec-missing')
    void omitted
    const { storage } = memory({ [RUN_STORAGE_KEYS.records]: stored(withoutField) })
    assert.equal(createRunStorage(storage).loadRecords()[0]?.sensorReport, null)
  })
  test('유효한 sensorReport는 유지된다', () => {
    const { storage } = memory({ [RUN_STORAGE_KEYS.records]: stored({ ...makeRecord('rec-ok'), sensorReport: VALID }) })
    assert.deepEqual(createRunStorage(storage).getRecord('rec-ok')?.sensorReport, VALID)
  })
  test('기록 본체가 손상되면 sensorReport가 유효해도 기록은 읽지 않는다(기존 동작)', () => {
    const { storage } = memory({ [RUN_STORAGE_KEYS.records]: stored({ ...makeRecord('rec-body'), sensorReport: VALID, mode: 'walk' }) })
    assert.equal(createRunStorage(storage).loadRecords().length, 0)
  })
  test('isRunRecord는 자세 요약이 손상된 기록을 엄격하게 거부하지만 parseRunRecord는 읽는다', () => {
    const broken = { ...makeRecord('rec-x'), sensorReport: { quality: 'good' } }
    assert.equal(isRunRecord(broken), false)
    assert.ok(parseRunRecord(broken))
  })
  test('손상된 자세 요약이 있는 기록을 같은 id로 저장해도 다른 기록은 그대로다', () => {
    const { storage, map } = memory({ [RUN_STORAGE_KEYS.records]: stored({ ...makeRecord('rec-a'), sensorReport: 'bad' }, makeRecord('rec-b')) })
    createRunStorage(storage).saveRecord(makeRecord('rec-a'))
    const saved = JSON.parse(map.get(RUN_STORAGE_KEYS.records) ?? '{}') as { data: { recordId: string; sensorReport: unknown }[] }
    assert.deepEqual(saved.data.map((item) => item.recordId), ['rec-a', 'rec-b'])
    assert.equal(saved.data[0].sensorReport, null)
  })
})

describe('자세 요약이 다른 기능에 주는 영향', () => {
  test('내보내기 열과 내용은 자세 요약 유무와 상관없이 같다(자세 데이터는 포함하지 않는다)', () => {
    const plain = memory({ [RUN_STORAGE_KEYS.records]: stored(makeRecord('rec-1')) })
    const withReport = memory({ [RUN_STORAGE_KEYS.records]: stored({ ...makeRecord('rec-1'), sensorReport: VALID }) })
    const a = exportRecords('CSV', { storage: plain.storage, now: () => BASE })
    const b = exportRecords('CSV', { storage: withReport.storage, now: () => BASE })
    assert.equal(a.status === 'ok' && b.status === 'ok' && a.file.content === b.file.content, true)
    const json = exportRecords('JSON', { storage: withReport.storage, now: () => BASE })
    assert.equal(json.status === 'ok' && /posture|balance|pressure|sensor/i.test(json.file.content), false)
  })
  test('삭제는 자세 요약이 든 기록도 함께 지운다', () => {
    const { storage, map } = memory({ [RUN_STORAGE_KEYS.records]: stored({ ...makeRecord('rec-1'), sensorReport: VALID }) })
    assert.deepEqual(deleteRunRecords(storage), { status: 'deleted', deletedCount: 1, sessionCleaned: true })
    assert.equal(map.size, 0)
  })
})
