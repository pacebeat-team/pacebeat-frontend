import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRunRecord } from './record.ts'
import { deriveRecordId } from './record.ts'
import { findRecord, countGoalCompleted, recordsWithDistance, sortNewestFirst, totalDistanceM, totalElapsedMs } from './recordQueries.ts'
import { createRunResultStore, EMPTY_REFLECTION } from './runResultStore.ts'
import { getPaceKeepPercent, getTargetTimeDeltaSec, isGoalCompletion, summarizeRun } from './runResult.ts'
import { saveRunResult } from './runSave.ts'
import { createRunStorage, RUN_STORAGE_KEYS } from './runStorage.ts'
import type { RunKeyValueStorage, RunSessionSnapshot } from './runStorage.ts'
import { createRunStore } from './runStore.ts'

const BASE = 1_700_000_000_000

function memory(failWrites = false) {
  const map = new Map<string, string>()
  const state = { fail: failWrites }
  const kv: RunKeyValueStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (state.fail && key === RUN_STORAGE_KEYS.records) throw new Error('QuotaExceededError')
      map.set(key, value)
    },
    removeItem: (key) => void map.delete(key),
  }
  return { map, kv, state }
}

// 완료된 GPS 러닝을 만든다.
function finishedRun(options: { mode?: 'gps' | 'time'; distanceKm?: 1 | 3 | 5; samples?: [number, number][]; durationMs: number; reason?: 'user' | 'goal'; targetSec?: number }) {
  const mem = memory()
  const storage = createRunStorage(mem.kv)
  const runs = createRunStore(storage)
  const mode = options.mode ?? 'gps'
  if (options.targetSec !== undefined) runs.getState().setTargetDuration(options.targetSec)
  if (options.distanceKm !== undefined) runs.getState().setDistance(options.distanceKm)
  runs.getState().startRun(mode, BASE, () => 'sess-1')
  for (const [elapsedMs, distanceM] of options.samples ?? []) runs.getState().recordDistanceSample(elapsedMs, distanceM)
  runs.getState().stopRun(BASE + options.durationMs, options.reason ?? 'user')
  return { mem, storage, runs }
}

describe('결과 요약 summarizeRun', () => {
  test('GPS 목표 전 종료는 partial, 남은 거리와 평균 페이스·구간이 계산된다', () => {
    const { runs } = finishedRun({ distanceKm: 3, durationMs: 591_000, samples: [[300_000, 700], [591_000, 1420]] })
    const summary = summarizeRun(runs.getState().activeSession as RunSessionSnapshot)
    assert.equal(summary?.completion, 'partial')
    assert.equal(summary?.distanceM, 1420)
    assert.equal(summary?.avgPaceSecPerKm, 416)
    assert.equal(summary?.remainingM, 1580)
    assert.equal(summary?.splits.length, 2) // 1km + 마지막 0.42km
  })
  test('목표 거리 도달은 goal이고 남은 거리가 없다', () => {
    const { runs } = finishedRun({ distanceKm: 1, durationMs: 420_000, reason: 'goal', samples: [[420_000, 1003]] })
    const snapshot = runs.getState().activeSession as RunSessionSnapshot
    const summary = summarizeRun(snapshot)
    assert.equal(summary?.completion, 'goal')
    assert.equal(summary?.remainingM, null)
    assert.equal(isGoalCompletion(snapshot), true)
  })
  test('TIME은 time이고 거리·페이스·구간이 없다(0이 아니라 null)', () => {
    const { runs } = finishedRun({ mode: 'time', durationMs: 120_000 })
    const summary = summarizeRun(runs.getState().activeSession as RunSessionSnapshot)
    assert.equal(summary?.completion, 'time')
    assert.equal(summary?.distanceM, null)
    assert.equal(summary?.avgPaceSecPerKm, null)
    assert.deepEqual(summary?.splits, [])
    assert.equal(summary?.remainingM, null)
  })
  test('거리가 너무 짧으면 평균 페이스는 null이다. 진행 중 세션은 요약하지 않는다', () => {
    const { runs } = finishedRun({ durationMs: 100_000, samples: [[100_000, 5]] })
    assert.equal(summarizeRun(runs.getState().activeSession as RunSessionSnapshot)?.avgPaceSecPerKm, null)
    const live = createRunStore(createRunStorage(memory().kv))
    live.getState().startRun('gps', BASE, () => 'x')
    assert.equal(summarizeRun(live.getState().activeSession as RunSessionSnapshot), null)
  })
  test('목표 페이스 유지 비율: 구간 기록이 있을 때만, 목표 시간차는 초 단위', () => {
    // 목표 7:00/km(21:00). 구간 7:00 / 7:08 / 7:04는 모두 ±5%(6:39~7:21) 안
    const { runs } = finishedRun({ distanceKm: 3, targetSec: 1260, durationMs: 1272_000, reason: 'goal', samples: [[420_000, 1000], [848_000, 2000], [1272_000, 3000]] })
    const summary = summarizeRun(runs.getState().activeSession as RunSessionSnapshot)
    assert.ok(summary !== null)
    assert.equal(getPaceKeepPercent(summary), 100)
    // 한 구간이 6:00/km(목표보다 너무 빠름)이면 그 시간만큼 제외된다
    const slow = finishedRun({ distanceKm: 3, targetSec: 1260, durationMs: 1200_000, reason: 'goal', samples: [[360_000, 1000], [780_000, 2000], [1200_000, 3000]] })
    const partial = summarizeRun(slow.runs.getState().activeSession as RunSessionSnapshot)
    assert.ok(partial !== null)
    assert.equal(getPaceKeepPercent(partial), 70) // 420s+420s 유지 / 전체 1200s
  })
  test('구간 기록이 없으면 유지 비율은 null', () => {
    const { runs } = finishedRun({ distanceKm: 3, durationMs: 100_000, samples: [[100_000, 400]] })
    const summary = summarizeRun(runs.getState().activeSession as RunSessionSnapshot)
    assert.ok(summary !== null)
    assert.equal(summary.splits.length, 1)
    assert.equal(getTargetTimeDeltaSec({ ...summary, goal: { targetDistanceKm: 3, targetDurationSec: 90 } }), 10)
  })
})

describe('저장 saveRunResult', () => {
  test('성공: 같은 세션은 항상 같은 recordId이고 다시 저장해도 1건이다', () => {
    const { storage, runs } = finishedRun({ distanceKm: 3, durationMs: 600_000, samples: [[600_000, 1500]] })
    const snapshot = runs.getState().activeSession
    const first = saveRunResult(snapshot, EMPTY_REFLECTION, storage)
    const second = saveRunResult(snapshot, { difficulty: 'easy', reasons: [], memo: '좋았다' }, storage)
    assert.ok(first.ok && second.ok)
    assert.equal(first.record.recordId, deriveRecordId('sess-1'))
    assert.equal(storage.loadRecords().length, 1)
    assert.equal(storage.loadRecords()[0].reflection?.memo, '좋았다')
    assert.equal(first.record.reflection, null) // 입력이 없으면 null
  })
  test('끝나지 않은 세션·세션 없음은 not-finished', () => {
    const storage = createRunStorage(memory().kv)
    assert.deepEqual(saveRunResult(null, EMPTY_REFLECTION, storage), { ok: false, code: 'not-finished' })
  })
  test('저장소 오류: write-failed / unavailable', () => {
    const run = finishedRun({ durationMs: 600_000, samples: [[600_000, 1500]] })
    const failing = createRunStorage({ ...run.mem.kv, setItem: () => { throw new Error('Quota') } })
    assert.deepEqual(saveRunResult(run.runs.getState().activeSession, EMPTY_REFLECTION, failing), { ok: false, code: 'write-failed' })
    assert.deepEqual(saveRunResult(run.runs.getState().activeSession, EMPTY_REFLECTION, createRunStorage(null)), { ok: false, code: 'unavailable' })
  })
  test('TIME 기록은 거리·페이스·구간 없이 저장된다', () => {
    const { storage, runs } = finishedRun({ mode: 'time', durationMs: 120_000 })
    const result = saveRunResult(runs.getState().activeSession, EMPTY_REFLECTION, storage)
    assert.ok(result.ok)
    assert.equal(result.record.result.distanceM, null)
    assert.equal(result.record.result.completion, 'time')
    assert.deepEqual(result.record.result.splits, [])
  })
})

describe('결과 Store(회고·저장 흐름)', () => {
  function setup(durationMs = 600_000, failWrites = false) {
    const mem = memory(failWrites)
    const storage = createRunStorage(mem.kv)
    const runs = createRunStore(storage)
    runs.getState().startRun('gps', BASE, () => 'sess-1')
    runs.getState().recordDistanceSample(durationMs, 1500)
    runs.getState().stopRun(BASE + durationMs)
    const results = createRunResultStore(runs, storage)
    results.getState().sync('sess-1')
    return { mem, storage, runs, results }
  }
  test('시트: 저장해야만 반영되고 닫기·취소는 반영하지 않는다. 열 때 이전 값이 유지된다', () => {
    const { results } = setup()
    results.getState().setDifficulty('moderate')
    results.getState().openSheet()
    results.getState().setDraftDifficulty('hard')
    results.getState().toggleDraftReason('legs')
    results.getState().setDraftMemo('다리가 무거웠다')
    results.getState().closeSheet()
    assert.equal(results.getState().applied.difficulty, 'moderate')
    results.getState().openSheet()
    assert.equal(results.getState().draft.difficulty, 'moderate') // 반영 안 된 편집은 버려진다
    results.getState().setDraftDifficulty('hard')
    results.getState().toggleDraftReason('legs')
    results.getState().toggleDraftReason('breath')
    results.getState().toggleDraftReason('legs') // 해제
    results.getState().applySheet()
    assert.deepEqual(results.getState().applied, { difficulty: 'hard', reasons: ['breath'], memo: '' })
    assert.equal(results.getState().sheetOpen, false)
  })
  test('메모는 100자까지만 입력된다', () => {
    const { results } = setup()
    results.getState().openSheet()
    results.getState().setDraftMemo('가'.repeat(150))
    assert.equal(results.getState().draft.memo.length, 100)
  })
  test('저장 성공: 기록이 1건 저장되고 진행 중 세션 키가 지워진다', () => {
    const { results, runs, storage, mem } = setup()
    results.getState().setDifficulty('easy')
    assert.equal(results.getState().save(), true)
    assert.equal(storage.loadRecords().length, 1)
    assert.equal(storage.loadRecords()[0].reflection?.difficulty, 'easy')
    assert.equal(runs.getState().activeSession?.session.status, 'finished') // 이동 전에는 세션이 남아 있다
    results.getState().finalize()
    assert.equal(runs.getState().activeSession, null)
    assert.equal(mem.map.has(RUN_STORAGE_KEYS.session), false)
  })
  test('저장 실패: 세션·회고 입력을 그대로 두고 오류를 보이며, 재시도는 같은 recordId로 성공한다', () => {
    const { results, runs, storage, mem } = setup(600_000, true)
    results.getState().setDifficulty('hard')
    assert.equal(results.getState().save(), false)
    assert.equal(results.getState().saveError, 'write-failed')
    assert.equal(results.getState().saving, false)
    assert.equal(results.getState().applied.difficulty, 'hard')
    assert.equal(runs.getState().activeSession?.session.status, 'finished')
    assert.ok(mem.map.has(RUN_STORAGE_KEYS.session))
    mem.state.fail = false
    assert.equal(results.getState().save(), true)
    assert.equal(results.getState().saved, true)
    assert.equal(results.getState().save(), true) // 이중 저장해도 1건
    assert.equal(storage.loadRecords().length, 1)
    assert.equal(storage.loadRecords()[0].recordId, deriveRecordId('sess-1'))
  })
  test('다른 세션 결과가 나오면 회고가 초기화된다', () => {
    const { results } = setup()
    results.getState().setDifficulty('easy')
    results.getState().sync('sess-1')
    assert.equal(results.getState().applied.difficulty, 'easy')
    results.getState().sync('sess-2')
    assert.equal(results.getState().applied.difficulty, null)
  })
})

describe('기록 조회·집계(TIME은 거리 집계에서 제외)', () => {
  function rec(id: string, mode: 'gps' | 'time', endedOffset: number, distanceM: number | null, goalReached: boolean) {
    const mem = memory()
    const runs = createRunStore(createRunStorage(mem.kv))
    runs.getState().startRun(mode, BASE, () => `s-${id}`)
    runs.getState().stopRun(BASE + endedOffset)
    const snapshot = runs.getState().activeSession as RunSessionSnapshot
    return buildRunRecord({
      recordId: id,
      session: snapshot.session,
      mode,
      goal: snapshot.goal,
      musicTrackId: null,
      distanceM,
      avgPaceSecPerKm: distanceM === null ? null : 400,
      distanceSamples: [],
      gpsGaps: [],
      goalReached,
    })
  }
  const records = [rec('a', 'gps', 600_000, 3000, true), rec('b', 'time', 300_000, null, false), rec('c', 'gps', 900_000, 1000, false)]
  test('누적 거리·시간·완주 횟수', () => {
    assert.equal(totalDistanceM(records), 4000)
    assert.equal(totalElapsedMs(records), 1_800_000)
    assert.equal(countGoalCompleted(records), 1)
    assert.deepEqual(recordsWithDistance(records).map((record) => record.recordId), ['a', 'c'])
  })
  test('최신순 정렬·단건 조회', () => {
    assert.deepEqual(sortNewestFirst(records).map((record) => record.recordId), ['c', 'a', 'b'])
    assert.equal(findRecord(records, 'b')?.mode, 'time')
    assert.equal(findRecord(records, 'zzz'), null)
  })
})
