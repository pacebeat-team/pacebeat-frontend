import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildHomeRecordsView } from '../home/homeRecords.ts'
import { findRecord } from '../running/recordQueries.ts'
import { saveRunResult } from '../running/runSave.ts'
import { createRunStorage } from '../running/runStorage.ts'
import type { RunKeyValueStorage } from '../running/runStorage.ts'
import { createRunStore } from '../running/runStore.ts'
import { buildRecordDetail, setDraftDifficulty, setDraftMemo, startReportDraft, toggleDraftReason, withReflection } from './recordDetail.ts'
import { buildCalendar, buildRecordRows, buildRecordsSummary } from './recordsView.ts'

// 러닝 결과 저장 → Home·기록 목록·달력·상세 → 리포트 수정 → 다시 읽기까지 한 흐름으로 확인한다.

const NOW = new Date(2026, 10, 19, 12, 0) // 2026-11-19(목)
const at = (day: number, hour = 7) => new Date(2026, 10, day, hour).getTime()

function memoryStorage(): RunKeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
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

describe('러닝 저장 → 기록 → 상세 → 리포트 수정', () => {
  test('완주·부분·TIME 저장이 Home·요약·달력·목록·상세에 같은 기록으로 나타난다', () => {
    const storage = createRunStorage(memoryStorage())
    assert.equal(run(storage, 'gps', at(16), 3010, 1_200_000).ok, true)
    assert.equal(run(storage, 'gps', at(17), 1429, 600_000).ok, true)
    assert.equal(run(storage, 'time', at(19), 0, 591_000).ok, true)

    const read = storage.readRecords()
    assert.equal(read.ok, true)
    const records = read.ok ? read.records : []
    assert.equal(records.length, 3)

    assert.deepEqual(buildRecordsSummary(records, NOW), { monthCount: 3, distanceText: '4.43', completeCount: 1 })
    const markers = buildCalendar(records, NOW).weeks.flat().filter((d) => d?.marker)
    assert.deepEqual(markers.map((d) => [d?.day, d?.marker]), [[16, 'full'], [17, 'partial'], [19, 'time']])

    const rows = buildRecordRows(records, NOW, false)
    assert.deepEqual(rows.map((row) => row.statusText), ['시간 기록', '목표 전 종료', '거리 완주'])
    assert.equal(buildHomeRecordsView(records, NOW).lastRunRecordId, rows[0].recordId)

    const detail = buildRecordDetail(findRecord(records, rows[1].recordId)!)
    assert.equal(detail.kind, 'partial')
    assert.equal(detail.mainText, '1.42')
  })

  test('리포트를 고쳐 저장하면 다시 읽어도 유지되고 다른 기록·결과는 바뀌지 않는다', () => {
    const mem = memoryStorage()
    const storage = createRunStorage(mem)
    run(storage, 'gps', at(16), 3010, 1_200_000)
    run(storage, 'gps', at(17), 1429, 600_000)
    const before = storage.loadRecords()
    const target = before[0]

    let draft = startReportDraft(target)
    draft = setDraftDifficulty(draft, 'hard')
    draft = toggleDraftReason(draft, 'breath')
    draft = setDraftMemo(draft, '다시 읽어도 남아요')
    storage.saveRecord(withReflection(target, draft))

    const after = createRunStorage(mem).loadRecords()
    assert.equal(after.length, 2)
    assert.deepEqual(after[0].reflection, { difficulty: 'hard', reasons: ['breath'], memo: '다시 읽어도 남아요' })
    assert.deepEqual({ ...after[0], reflection: null }, { ...target, reflection: null })
    assert.deepEqual(after[1], before[1])

    // 모두 비우면 reflection은 null로 돌아간다(결과 화면과 같은 규칙)
    storage.saveRecord(withReflection(after[0], { difficulty: null, reasons: [], memo: '' }))
    assert.equal(storage.loadRecords()[0].reflection, null)
  })

  test('시트를 저장하지 않고 닫으면(편집본만 바뀜) 저장된 기록은 그대로다', () => {
    const storage = createRunStorage(memoryStorage())
    run(storage, 'gps', at(16), 3010, 1_200_000)
    const target = storage.loadRecords()[0]
    setDraftMemo(setDraftDifficulty(startReportDraft(target), 'easy'), '저장 안 함')
    assert.deepEqual(storage.loadRecords()[0], target)
  })

  test('읽을 수 없는 항목이 섞여 있어도 리포트 수정이 그 항목을 지우지 않는다', () => {
    const mem = memoryStorage()
    const storage = createRunStorage(mem)
    run(storage, 'gps', at(16), 3010, 1_200_000)
    const raw = JSON.parse(mem.data.get('pacebeat:run:records:v1') ?? '') as { version: number; data: unknown[] }
    raw.data.push({ recordId: 'future-format', unknown: true })
    mem.data.set('pacebeat:run:records:v1', JSON.stringify(raw))

    const target = storage.loadRecords()[0]
    storage.saveRecord(withReflection(target, { difficulty: 'easy', reasons: [], memo: '' }))
    const saved = (JSON.parse(mem.data.get('pacebeat:run:records:v1') ?? '') as { data: unknown[] }).data
    assert.equal(saved.length, 2)
    assert.deepEqual(saved[1], { recordId: 'future-format', unknown: true })
  })

  test('저장소 쓰기가 실패하면 예외로 알리고 기존 기록은 그대로 읽힌다', () => {
    const mem = memoryStorage()
    const storage = createRunStorage(mem)
    run(storage, 'gps', at(16), 3010, 1_200_000)
    const target = storage.loadRecords()[0]
    const failing = createRunStorage({
      getItem: (key) => mem.getItem(key),
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
    })
    assert.throws(() => failing.saveRecord(withReflection(target, { difficulty: 'easy', reasons: [], memo: '' })))
    assert.deepEqual(storage.loadRecords()[0], target)
  })
})
