import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createRecordsLoader } from '../records/recordsLoad.ts'
import { buildRunRecord } from '../running/record.ts'
import { createRunLive } from '../running/runLive.ts'
import { createRunResultStore } from '../running/runResultStore.ts'
import { startRunSessionPersistence } from '../running/runSessionRestore.ts'
import { createRunSessionStorage, RUN_SESSION_KEYS } from '../running/runSessionStorage.ts'
import { startRun, stopRun } from '../running/runSession.ts'
import { createRunStorage, RUN_STORAGE_KEYS } from '../running/runStorage.ts'
import type { RunKeyValueStorage } from '../running/runStorage.ts'
import { createRunStore } from '../running/runStore.ts'
import { createDeleteAction } from './deleteAction.ts'

const BASE = 1_700_000_000_000

function disk(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  const log: string[] = []
  const flags = { failRemove: false, silentRemove: false, failGet: false }
  const storage: RunKeyValueStorage = {
    getItem: (key) => {
      if (flags.failGet) throw new Error('blocked')
      log.push(`get:${key}`)
      return map.get(key) ?? null
    },
    setItem: (key, value) => {
      log.push(`set:${key}`)
      map.set(key, value)
    },
    removeItem: (key) => {
      log.push(`remove:${key}`)
      if (flags.failRemove) throw new Error('denied')
      if (!flags.silentRemove) map.delete(key)
    },
  }
  return { map, log, flags, storage }
}

function record(id: string) {
  const session = stopRun(startRun(null, BASE, () => `s-${id}`), BASE + 600_000)
  return buildRunRecord({
    recordId: id,
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

// 삭제 대상이 아닌 키: 프로필·온보딩·기초 측정·안내 설정·목표 draft
const KEEP = {
  [RUN_STORAGE_KEYS.draft]: '{"version":1,"data":{"distanceKm":5}}',
  'pacebeat-profile': '{"p":1}',
  'pacebeat-onboarding': '{"o":1}',
  'pacebeat:measurement:v1': '{"m":1}',
  'pacebeat:guidance-settings:v1': '{"g":1}',
}

function seeded() {
  const d = disk(KEEP)
  const runs = createRunStorage(d.storage)
  runs.saveRecord(record('rec-1'))
  runs.saveRecord(record('rec-2'))
  d.log.length = 0
  return { ...d, runs }
}

describe('확인 버튼', () => {
  test('기록을 지우고 이전 화면으로 나가며, 비대상 키는 그대로다', () => {
    const d = seeded()
    let left = 0
    const action = createDeleteAction({ storage: d.storage, leave: () => (left += 1) })
    assert.deepEqual(action.confirm(), { status: 'deleted', deletedCount: 2, sessionCleaned: true })
    assert.equal(left, 1)
    assert.equal(d.map.has(RUN_STORAGE_KEYS.records), false)
    for (const [key, value] of Object.entries(KEEP)) assert.equal(d.map.get(key), value)
  })
  test('중복 클릭: 끝난 뒤 다시 눌러도 삭제를 다시 실행하지 않고 다시 나가지도 않는다', () => {
    const d = seeded()
    let left = 0
    const action = createDeleteAction({ storage: d.storage, leave: () => (left += 1) })
    action.confirm()
    d.log.length = 0
    assert.deepEqual(action.confirm(), { status: 'already-done' })
    assert.deepEqual(d.log, [])
    assert.equal(left, 1)
  })
  test('지울 기록이 없으면 nothing이고 저장소를 바꾸지 않은 채 나간다', () => {
    const d = disk(KEEP)
    let left = 0
    const action = createDeleteAction({ storage: d.storage, leave: () => (left += 1) })
    assert.deepEqual(action.confirm(), { status: 'nothing' })
    assert.equal(left, 1)
    assert.equal(d.log.some((entry) => entry.startsWith('remove:') || entry.startsWith('set:')), false)
  })
  test('삭제 실패: 나가지 않고 기록이 남으며, 문제가 풀린 뒤 다시 시도할 수 있다', () => {
    const d = seeded()
    let left = 0
    const action = createDeleteAction({ storage: d.storage, leave: () => (left += 1) })
    d.flags.failRemove = true
    assert.deepEqual(action.confirm(), { status: 'failed', reason: 'write-failed' })
    assert.equal(left, 0)
    assert.equal(d.runs.loadRecords().length, 2)
    d.flags.failRemove = false
    assert.equal(action.confirm().status, 'deleted')
    assert.equal(left, 1)
  })
  test('지웠다고 응답했지만 다시 읽으니 남아 있으면 실패로 본다', () => {
    const d = seeded()
    let left = 0
    d.flags.silentRemove = true
    const result = createDeleteAction({ storage: d.storage, leave: () => (left += 1) }).confirm()
    assert.deepEqual(result, { status: 'failed', reason: 'write-failed' })
    assert.equal(left, 0)
  })
  test('저장소 접근 실패(null·읽기 예외)는 성공과 구분되고 나가지 않는다', () => {
    let left = 0
    assert.deepEqual(createDeleteAction({ storage: null, leave: () => (left += 1) }).confirm(), { status: 'failed', reason: 'unavailable' })
    const d = seeded()
    d.flags.failGet = true
    assert.deepEqual(createDeleteAction({ storage: d.storage, leave: () => (left += 1) }).confirm(), { status: 'failed', reason: 'unavailable' })
    assert.equal(left, 0)
  })
})

describe('돌아가기 버튼', () => {
  test('저장소를 읽지도 쓰지도 않고 이전 화면으로만 나간다', () => {
    const d = seeded()
    let left = 0
    createDeleteAction({ storage: d.storage, leave: () => (left += 1) }).cancel()
    assert.equal(left, 1)
    assert.deepEqual(d.log, [])
    assert.equal(d.runs.loadRecords().length, 2)
  })
  test('돌아간 뒤에도 확인은 그대로 삭제할 수 있다', () => {
    const d = seeded()
    const action = createDeleteAction({ storage: d.storage, leave: () => undefined })
    action.cancel()
    assert.equal(action.confirm().status, 'deleted')
  })
})

describe('삭제 뒤 다른 기능', () => {
  test('Records 조회는 삭제 전에는 기록, 삭제 뒤에는 비어 있음(Empty)이다', () => {
    const d = seeded()
    const loader = createRecordsLoader(() => d.runs.readRecords())
    loader.load()
    assert.equal(loader.getState().phase, 'ready')
    createDeleteAction({ storage: d.storage, leave: () => undefined }).confirm()
    loader.load()
    assert.equal(loader.getState().phase, 'empty')
  })
  test('#48: 진행 중 세션은 기록을 지워도 그대로 복원된다', () => {
    const d = seeded()
    function boot(now: number) {
      const records = createRunStorage(d.storage)
      const runs = createRunStore(records)
      const results = createRunResultStore(runs, records, { getState: () => ({ reset: () => undefined }) })
      const controller = createRunLive({
        store: runs,
        now: () => now,
        createSource: () => ({ start: () => undefined, stop: () => undefined, isRunning: false }),
        createId: () => 'sess-live',
        autoHeartbeat: false,
        listenVisible: () => () => undefined,
        queryPermission: () => Promise.resolve('unknown'),
      })
      const persistence = startRunSessionPersistence({
        runs,
        results,
        live: controller.live,
        sessionStorage: createRunSessionStorage(d.storage),
        records,
        now: () => now,
      })
      return { runs, controller, persistence }
    }
    boot(BASE).controller.begin('time')
    assert.ok(d.map.has(RUN_SESSION_KEYS.session))
    createDeleteAction({ storage: d.storage, leave: () => undefined }).confirm()
    assert.ok(d.map.has(RUN_SESSION_KEYS.session))
    const after = boot(BASE + 5000)
    assert.equal(after.persistence.getStatus().outcome, 'restored')
    assert.equal(after.runs.getState().activeSession?.session.id, 'sess-live')
  })
})
