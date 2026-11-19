import { buildRecordRows } from '../records/recordsView.ts'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { totalDistanceM } from '../running/recordQueries.ts'
import { createRunStorage } from '../running/runStorage.ts'
import type { RunKeyValueStorage } from '../running/runStorage.ts'
import { createRunStore } from '../running/runStore.ts'
import { saveRunResult } from '../running/runSave.ts'
import type { RunCompletion, RunRecord } from '../running/types.ts'
import { buildHomeRecordsView, buildLastRunText, getLatestRecord, getRunWeekdays, getWeekStart } from './homeRecords.ts'

// 2026-11-19(목)이 속한 주: 월 16 ~ 일 22
const NOW = new Date(2026, 10, 19, 12, 0)
const at = (day: number, hour = 9, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()

function makeRecord(over: {
  id?: string
  startedAt: number
  endedAt?: number
  completion?: RunCompletion
  distanceM?: number | null
  elapsedMs?: number
}): RunRecord {
  const completion = over.completion ?? 'goal'
  const distanceM = over.distanceM === undefined ? (completion === 'time' ? null : 3000) : over.distanceM
  return {
    recordId: over.id ?? `rec-${over.startedAt}`,
    sessionId: `sess-${over.startedAt}`,
    mode: completion === 'time' ? 'time' : 'gps',
    startedAt: over.startedAt,
    endedAt: over.endedAt ?? over.startedAt + 1_200_000,
    goal: { targetDistanceKm: completion === 'time' ? null : 3, targetDurationSec: completion === 'time' ? null : 1260 },
    musicTrackId: null,
    result: { elapsedMs: over.elapsedMs ?? 1_200_000, distanceM, avgPaceSecPerKm: null, splits: [], completion, gpsGaps: [] },
    reflection: null,
    sensorReport: null,
  }
}

const trueDays = (days: readonly boolean[]) => days.flatMap((on, i) => (on ? [i] : []))

describe('이번 주 달린 요일', () => {
  test('주의 시작은 월요일 0시(로컬)다', () => {
    assert.equal(getWeekStart(NOW).getTime(), new Date(2026, 10, 16).getTime())
    assert.equal(getWeekStart(new Date(2026, 10, 22, 23, 59)).getTime(), new Date(2026, 10, 16).getTime()) // 일요일
    assert.equal(getWeekStart(new Date(2026, 10, 23, 0, 0)).getTime(), new Date(2026, 10, 23).getTime()) // 다음 월요일
  })
  test('기록이 없으면 모두 false', () => {
    assert.deepEqual(trueDays(getRunWeekdays([], NOW)), [])
  })
  test('주 경계: 월요일 0시는 이번 주, 직전 일요일 23:59는 지난 주', () => {
    const records = [makeRecord({ startedAt: at(16, 0, 0) }), makeRecord({ startedAt: at(15, 23, 59) })]
    assert.deepEqual(trueDays(getRunWeekdays(records, NOW)), [0])
  })
  test('주 경계: 일요일 마지막 분은 이번 주, 다음 월요일 0시는 다음 주', () => {
    const sunday = new Date(2026, 10, 22, 12, 0) // 일요일 낮
    const records = [makeRecord({ startedAt: at(22, 23, 59) }), makeRecord({ startedAt: at(23, 0, 0) })]
    // 같은 주(일요일)를 기준으로 보면 월요일 0시 기록은 미래이므로 제외된다
    assert.deepEqual(trueDays(getRunWeekdays(records, new Date(2026, 10, 22, 23, 59, 59))), [6])
    assert.deepEqual(trueDays(getRunWeekdays(records, sunday)), [])
  })
  test('startedAt 기준: 자정을 넘겨 끝난 러닝은 시작한 요일에 표시한다', () => {
    const record = makeRecord({ startedAt: at(18, 23, 50), endedAt: at(19, 0, 20) })
    assert.deepEqual(trueDays(getRunWeekdays([record], NOW)), [2]) // 수요일
  })
  test('같은 날 여러 번 달려도 한 번만 표시하고, TIME 기록도 포함한다', () => {
    const records = [
      makeRecord({ startedAt: at(17, 7) }),
      makeRecord({ startedAt: at(17, 20), completion: 'partial', distanceM: 1420 }),
      makeRecord({ startedAt: at(19, 6), completion: 'time' }),
    ]
    assert.deepEqual(trueDays(getRunWeekdays(records, NOW)), [1, 3])
  })
  test('지금보다 늦게 시작한 기록(미래)과 먼 과거는 세지 않는다', () => {
    const records = [makeRecord({ startedAt: at(21) }), makeRecord({ startedAt: new Date(2020, 0, 1).getTime() })]
    assert.deepEqual(trueDays(getRunWeekdays(records, NOW)), [])
  })
  test('일광 절약 시간 전환 주에도 7칸 안에서 계산한다', () => {
    // 2026-03-08(일)은 미국 DST 전환일이다. 시간대와 무관하게 달력 날짜로 월~일을 센다.
    const now = new Date(2026, 2, 8, 12, 0)
    const records = [makeRecord({ startedAt: new Date(2026, 2, 2, 0, 0).getTime() }), makeRecord({ startedAt: new Date(2026, 2, 8, 12, 0).getTime() })]
    assert.deepEqual(trueDays(getRunWeekdays(records, now)), [0, 6])
    assert.deepEqual(trueDays(getRunWeekdays([makeRecord({ startedAt: new Date(2026, 2, 1, 23, 59).getTime() })], now)), [])
  })
})

describe('지난 러닝 행', () => {
  test('완주·부분·TIME 문구', () => {
    assert.equal(buildLastRunText(makeRecord({ startedAt: at(17), distanceM: 3000 })), '3.00 km · 거리 완주')
    assert.equal(buildLastRunText(makeRecord({ startedAt: at(17), completion: 'partial', distanceM: 1429.9 })), '1.42 km · 목표 전 종료')
    assert.equal(buildLastRunText(makeRecord({ startedAt: at(17), completion: 'time', elapsedMs: 591_000 })), '09:51 · 시간 기록')
  })
  test('거리 기록인데 거리가 없으면(손상) 행을 만들지 않는다', () => {
    assert.equal(buildLastRunText(makeRecord({ startedAt: at(17), completion: 'partial', distanceM: null })), null)
  })
  test('가장 최근 기록은 endedAt 기준이다', () => {
    const early = makeRecord({ id: 'early', startedAt: at(17, 8), endedAt: at(17, 9) })
    const late = makeRecord({ id: 'late', startedAt: at(16, 8), endedAt: at(18, 9) })
    assert.equal(getLatestRecord([early, late])?.recordId, 'late')
    assert.equal(getLatestRecord([]), null)
  })
  test('미래 시각에 시작한 기록은 지난 러닝으로 보지 않는다', () => {
    const past = makeRecord({ id: 'past', startedAt: at(17), distanceM: 3000 })
    const future = makeRecord({ id: 'future', startedAt: at(21), completion: 'time' })
    assert.equal(buildHomeRecordsView([past, future], NOW).lastRunText, '3.00 km · 거리 완주')
    assert.equal(buildHomeRecordsView([future], NOW).lastRunText, null)
  })
  test('지난 러닝 행은 가장 최근 기록으로 연결되고, 기록 목록의 첫 행과 같은 기록이다', () => {
    const older = makeRecord({ id: 'older', startedAt: at(15, 8), endedAt: at(15, 9) })
    const newer = makeRecord({ id: 'newer', startedAt: at(17, 8), endedAt: at(17, 9) })
    const future = makeRecord({ id: 'future', startedAt: at(21), completion: 'time' })
    const view = buildHomeRecordsView([older, newer, future], NOW)
    assert.equal(view.lastRunRecordId, 'newer')
    assert.equal(buildRecordRows([older, newer, future], NOW, false)[0].recordId, view.lastRunRecordId)
  })
  test('기록이 없으면 행 문구는 null이고 요일은 비어 있다', () => {
    const view = buildHomeRecordsView([], NOW)
    assert.equal(view.lastRunText, null)
    assert.equal(view.lastRunRecordId, null)
    assert.deepEqual(trueDays(view.runDays), [])
  })
  test('TIME 기록은 누적 거리에 포함되지 않는다', () => {
    const records = [makeRecord({ startedAt: at(17), distanceM: 3000 }), makeRecord({ startedAt: at(18), completion: 'time' })]
    assert.equal(totalDistanceM(records), 3000)
  })
})

describe('저장 → 불러오기 → Home 표시값', () => {
  function memoryStorage(initial?: Record<string, string>): RunKeyValueStorage & { data: Map<string, string> } {
    const data = new Map(Object.entries(initial ?? {}))
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    }
  }
  const noReflection = { difficulty: null, reasons: [], memo: '' } as const

  function run(storage: ReturnType<typeof createRunStorage>, mode: 'gps' | 'time', start: number, meters: number, durationMs: number) {
    const store = createRunStore(storage)
    store.getState().setDistance(3)
    store.getState().startRun(mode, start, () => `sess-${start}`)
    if (mode === 'gps') store.getState().recordDistanceSample(durationMs, meters)
    store.getState().stopRun(start + durationMs, 'user')
    return saveRunResult(store.getState().activeSession, noReflection, storage)
  }

  test('완주·부분·TIME을 저장하면 Home에 요일과 최신 기록이 반영된다', () => {
    const mem = memoryStorage()
    const storage = createRunStorage(mem)
    assert.equal(run(storage, 'gps', at(16, 7), 3010, 1_200_000).ok, true)
    assert.equal(run(storage, 'gps', at(17, 7), 1429, 600_000).ok, true)
    assert.equal(run(storage, 'time', at(19, 7), 0, 591_000).ok, true)
    const view = buildHomeRecordsView(storage.loadRecords(), NOW)
    assert.deepEqual(trueDays(view.runDays), [0, 1, 3])
    assert.equal(view.lastRunText, '09:51 · 시간 기록')
    assert.equal(totalDistanceM(storage.loadRecords()), 3010 + 1429)
  })
  test('완주 기록의 행 문구', () => {
    const storage = createRunStorage(memoryStorage())
    run(storage, 'gps', at(19, 7), 3010, 1_200_000)
    assert.equal(buildHomeRecordsView(storage.loadRecords(), NOW).lastRunText, '3.01 km · 거리 완주')
  })
  test('부분 기록의 행 문구', () => {
    const storage = createRunStorage(memoryStorage())
    run(storage, 'gps', at(19, 7), 1429, 600_000)
    assert.equal(buildHomeRecordsView(storage.loadRecords(), NOW).lastRunText, '1.42 km · 목표 전 종료')
  })
  test('손상된 저장 데이터·일부 손상 항목이 있어도 오류 없이 처리한다', () => {
    const corrupt = createRunStorage(memoryStorage({ 'pacebeat:run:records:v1': '{not json' }))
    assert.deepEqual(corrupt.loadRecords(), [])
    assert.equal(buildHomeRecordsView(corrupt.loadRecords(), NOW).lastRunText, null)
    const good = makeRecord({ startedAt: at(17) })
    const mixed = createRunStorage(
      memoryStorage({ 'pacebeat:run:records:v1': JSON.stringify({ version: 1, data: [good, { recordId: 1 }, null, 'x'] }) }),
    )
    assert.equal(mixed.loadRecords().length, 1)
    assert.deepEqual(trueDays(buildHomeRecordsView(mixed.loadRecords(), NOW).runDays), [1])
  })
  test('저장소를 쓸 수 없으면 빈 기록으로 처리한다', () => {
    const throwing: RunKeyValueStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {},
    }
    assert.deepEqual(createRunStorage(throwing).loadRecords(), [])
    assert.deepEqual(createRunStorage(null).loadRecords(), [])
  })
  test('기존 저장 키와 reflection 필드를 유지한다', () => {
    const mem = memoryStorage()
    const storage = createRunStorage(mem)
    const store = createRunStore(storage)
    store.getState().startRun('time', at(19, 7), () => 's1')
    store.getState().stopRun(at(19, 7) + 60_000, 'user')
    saveRunResult(store.getState().activeSession, { difficulty: 'hard', reasons: ['legs'], memo: '무거움' }, storage)
    const saved = JSON.parse(mem.data.get('pacebeat:run:records:v1') ?? '{}') as { version: number; data: RunRecord[] }
    assert.equal(saved.version, 1)
    assert.deepEqual(saved.data[0].reflection, { difficulty: 'hard', reasons: ['legs'], memo: '무거움' })
  })
})
