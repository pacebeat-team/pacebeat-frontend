import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { buildRunRecord } from '../running/record.ts'
import { startRun, stopRun } from '../running/runSession.ts'
import { createRunSessionStorage, RUN_SESSION_KEYS } from '../running/runSessionStorage.ts'
import { createRunStorage, RUN_STORAGE_KEYS } from '../running/runStorage.ts'
import type { RunKeyValueStorage, RunSessionSnapshot } from '../running/runStorage.ts'
import type { RunMode, RunRecord } from '../running/types.ts'
import { deleteRunRecords } from './dataDelete.ts'
import { buildExportFile, CSV_HEADER, downloadExportFile, exportRecords } from './dataExport.ts'
import type { DownloadEnv } from './dataExport.ts'

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

function makeRecord(recordId: string, mode: RunMode = 'gps', durationMs = 600_000): RunRecord {
  const session = stopRun(startRun(null, BASE, () => `sess-${recordId}`), BASE + durationMs)
  return buildRunRecord({
    recordId,
    session,
    mode,
    goal: { targetDistanceKm: 3, targetDurationSec: 1320 },
    musicTrackId: null,
    distanceM: mode === 'gps' ? 1500 : null,
    avgPaceSecPerKm: mode === 'gps' ? 400 : null,
    distanceSamples: mode === 'gps' ? [{ elapsedMs: durationMs, distanceM: 1500 }] : [],
    gpsGaps: [],
    goalReached: false,
  })
}

const NOW = Date.UTC(2026, 10, 23, 9, 0, 0)

describe('내보내기', () => {
  test('데이터가 있으면 저장된 기록만 CSV로 만든다(헤더 + 기록 수만큼 행)', () => {
    const { storage } = memory()
    const runs = createRunStorage(storage)
    runs.saveRecord(makeRecord('rec-a'))
    runs.saveRecord(makeRecord('rec-b', 'time'))
    const result = exportRecords('CSV', { storage, now: () => NOW })
    assert.equal(result.status, 'ok')
    if (result.status !== 'ok') return
    assert.equal(result.file.filename, 'pacebeat-records-2026-11-23.csv')
    assert.equal(result.file.recordCount, 2)
    const lines = result.file.content.trimEnd().split('\r\n')
    assert.equal(lines[0], CSV_HEADER.join(','))
    assert.equal(lines.length, 3)
    assert.equal(lines[1], `rec-a,${new Date(BASE).toISOString()},gps,1.5,600,400`)
  })
  test('시간 기록의 거리·페이스는 0이 아니라 빈 칸(CSV)·null(JSON)이다', () => {
    const records = [makeRecord('rec-t', 'time')]
    const csv = buildExportFile(records, 'CSV', NOW).content.trimEnd().split('\r\n')[1]
    assert.equal(csv, `rec-t,${new Date(BASE).toISOString()},time,,600,`)
    const json = JSON.parse(buildExportFile(records, 'JSON', NOW).content)
    assert.equal(json.records[0].distanceKm, null)
    assert.equal(json.records[0].paceSecPerKm, null)
    assert.equal(json.records[0].durationSec, 600)
  })
  test('JSON은 파싱되고 내보낸 시각과 기록을 담는다. 예시·인솔·회고 같은 다른 데이터는 없다', () => {
    const file = buildExportFile([makeRecord('rec-a')], 'JSON', NOW)
    assert.equal(file.mimeType, 'application/json')
    const json = JSON.parse(file.content)
    assert.equal(json.exportedAt, new Date(NOW).toISOString())
    assert.deepEqual(Object.keys(json.records[0]).sort(), ['date', 'distanceKm', 'durationSec', 'mode', 'paceSecPerKm', 'recordId'])
  })
  test('쉼표·따옴표가 든 값은 CSV에서 따옴표로 감싼다', () => {
    const record = { ...makeRecord('a,"b"'), recordId: 'a,"b"' }
    assert.match(buildExportFile([record], 'CSV', NOW).content, /\r\n"a,""b""",/)
  })
  test('데이터가 없으면 empty이고 파일을 만들지 않는다(저장소가 비었거나 기록 키가 없음)', () => {
    assert.deepEqual(exportRecords('CSV', { storage: memory().storage }), { status: 'empty' })
    const emptyArray = memory({ [RUN_STORAGE_KEYS.records]: JSON.stringify({ version: 1, data: [] }) })
    assert.deepEqual(exportRecords('JSON', { storage: emptyArray.storage }), { status: 'empty' })
  })
  test('저장소를 쓸 수 없으면 unavailable, 데이터가 손상됐으면 unreadable로 empty와 구분한다', () => {
    assert.deepEqual(exportRecords('CSV', { storage: null }), { status: 'unavailable' })
    const corrupt = memory({ [RUN_STORAGE_KEYS.records]: 'not-json' })
    assert.deepEqual(exportRecords('CSV', { storage: corrupt.storage }), { status: 'unreadable' })
    assert.deepEqual(exportRecords('CSV', { readRecords: () => { throw new Error('boom') } }), { status: 'unreadable' })
  })
  test('일부만 유효하면 유효한 기록만 내보낸다', () => {
    const good = makeRecord('rec-good')
    const raw = JSON.stringify({ version: 1, data: [good, { recordId: 'broken' }, 7] })
    const result = exportRecords('CSV', { storage: memory({ [RUN_STORAGE_KEYS.records]: raw }).storage, now: () => NOW })
    assert.equal(result.status === 'ok' && result.file.recordCount, 1)
  })
  test('다른 키(프로필·세션·draft·기초 측정)는 읽어도 파일에 넣지 않는다', () => {
    const { storage } = memory({
      'pacebeat-profile': '{"nickname":"비밀"}',
      [RUN_SESSION_KEYS.session]: '{"x":1}',
      'pacebeat:measurement:v1': '{"x":1}',
    })
    assert.equal(exportRecords('CSV', { storage }).status, 'empty')
  })
})

describe('파일 내려받기', () => {
  function env(overrides: Partial<DownloadEnv> = {}) {
    const calls: string[] = []
    const anchor = { href: '', download: '', click: () => calls.push(`click:${anchor.download}`) }
    const value: DownloadEnv = {
      createObjectURL: () => (calls.push('create'), 'blob:x'),
      revokeObjectURL: () => void calls.push('revoke'),
      createAnchor: () => anchor,
      ...overrides,
    }
    return { value, calls }
  }
  const file = buildExportFile([makeRecord('rec-a')], 'CSV', NOW)
  test('내려받기에 성공하면 true이고 파일명으로 클릭하며 URL을 정리한다', () => {
    const { value, calls } = env()
    assert.equal(downloadExportFile(file, value), true)
    assert.deepEqual(calls, ['create', 'click:pacebeat-records-2026-11-23.csv', 'revoke'])
  })
  test('파일 생성·클릭이 실패하면 false이고 URL은 정리한다', () => {
    const failing = env({ createAnchor: () => { throw new Error('no dom') } })
    assert.equal(downloadExportFile(file, failing.value), false)
    assert.deepEqual(failing.calls, ['create', 'revoke'])
    const noUrl = env({ createObjectURL: () => { throw new Error('quota') } })
    assert.equal(downloadExportFile(file, noUrl.value), false)
  })
})

describe('삭제', () => {
  const KEEP = {
    [RUN_STORAGE_KEYS.draft]: '{"version":1,"data":{"distanceKm":5}}',
    'pacebeat-profile': '{"a":1}',
    'pacebeat-onboarding': '{"a":1}',
    'pacebeat:measurement:v1': '{"a":1}',
    'pacebeat:guidance-settings:v1': '{"a":1}',
    'pacebeat-guide-skipped': '1',
  }

  test('기록만 지우고 다른 키는 그대로이며 지운 뒤 읽으면 비어 있다', () => {
    const { storage, map } = memory(KEEP)
    const runs = createRunStorage(storage)
    runs.saveRecord(makeRecord('rec-a'))
    runs.saveRecord(makeRecord('rec-b'))
    const before = new Map(map)
    assert.deepEqual(deleteRunRecords(storage), { status: 'deleted', deletedCount: 2, sessionCleaned: true })
    assert.equal(map.has(RUN_STORAGE_KEYS.records), false)
    for (const [key, value] of Object.entries(KEEP)) assert.equal(map.get(key), value)
    assert.equal(before.size - map.size, 1)
    assert.deepEqual(runs.readRecords(), { ok: true, records: [] })
    assert.equal(runs.loadRecords().length, 0)
  })
  test('지울 기록이 없으면 nothing이고 저장소를 바꾸지 않는다', () => {
    const { storage, map } = memory(KEEP)
    const snapshot = JSON.stringify([...map])
    assert.deepEqual(deleteRunRecords(storage), { status: 'nothing' })
    assert.equal(JSON.stringify([...map]), snapshot)
  })
  test('손상된 기록 데이터도 지운다(읽을 수 있던 기록은 0건)', () => {
    const { storage, map } = memory({ [RUN_STORAGE_KEYS.records]: 'not-json' })
    assert.deepEqual(deleteRunRecords(storage), { status: 'deleted', deletedCount: 0, sessionCleaned: true })
    assert.equal(map.size, 0)
  })
  test('일부만 유효해도 키 전체를 지우고 유효한 수만 센다', () => {
    const raw = JSON.stringify({ version: 1, data: [makeRecord('rec-a'), { broken: true }] })
    const { storage, map } = memory({ [RUN_STORAGE_KEYS.records]: raw })
    assert.deepEqual(deleteRunRecords(storage), { status: 'deleted', deletedCount: 1, sessionCleaned: true })
    assert.equal(map.size, 0)
  })
  test('저장소를 쓸 수 없으면 실패(unavailable)로 알린다', () => {
    assert.deepEqual(deleteRunRecords(null), { status: 'failed', reason: 'unavailable' })
    const throwing: RunKeyValueStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => undefined, removeItem: () => undefined }
    assert.deepEqual(deleteRunRecords(throwing), { status: 'failed', reason: 'unavailable' })
  })
  test('삭제가 실패하면 성공으로 알리지 않고 기록은 그대로다', () => {
    const { storage, map } = memory()
    createRunStorage(storage).saveRecord(makeRecord('rec-a'))
    const failing: RunKeyValueStorage = { ...storage, removeItem: () => { throw new Error('denied') } }
    assert.deepEqual(deleteRunRecords(failing), { status: 'failed', reason: 'write-failed' })
    assert.equal(createRunStorage(storage).loadRecords().length, 1)
    assert.equal(map.has(RUN_STORAGE_KEYS.records), true)
    // 예외 없이 아무 일도 하지 않는 저장소(지워졌다고 거짓 응답)도 다시 읽어 실패로 본다.
    const silent: RunKeyValueStorage = { ...storage, removeItem: () => undefined }
    assert.deepEqual(deleteRunRecords(silent), { status: 'failed', reason: 'write-failed' })
  })
  test('진행 중 세션·회고·draft는 지우지 않는다(#48 복원과 충돌하지 않는다)', () => {
    const { storage, map } = memory(KEEP)
    const runs = createRunStorage(storage)
    runs.saveRecord(makeRecord('rec-old'))
    const live: RunSessionSnapshot = {
      mode: 'gps',
      goal: { targetDistanceKm: 3, targetDurationSec: 1320 },
      musicTrackId: null,
      session: startRun(null, BASE, () => 'sess-live'),
      distanceSamples: [],
      gpsGaps: [],
    }
    const sessions = createRunSessionStorage(storage)
    sessions.saveSession(live, BASE)
    deleteRunRecords(storage)
    assert.equal(sessions.loadSession().status, 'ok')
    assert.equal(map.get(RUN_STORAGE_KEYS.draft), KEEP[RUN_STORAGE_KEYS.draft])
  })
  test('방금 지운 기록의 이미 저장된 세션이 남아 있으면 되살아나지 않게 함께 지운다', () => {
    const { storage } = memory()
    const runs = createRunStorage(storage)
    const record = makeRecord('rec-sess-saved')
    runs.saveRecord(record)
    const finished: RunSessionSnapshot = {
      mode: 'gps',
      goal: { targetDistanceKm: 3, targetDurationSec: 1320 },
      musicTrackId: null,
      session: stopRun(startRun(null, BASE, () => 'saved'), BASE + 1000),
      distanceSamples: [],
      gpsGaps: [],
    }
    // 세션 id가 'saved'이면 recordId는 'rec-saved'다.
    runs.saveRecord({ ...record, recordId: 'rec-saved', sessionId: 'saved' })
    const sessions = createRunSessionStorage(storage)
    sessions.saveSession(finished, BASE)
    sessions.saveSeen({ sessionId: 'saved', at: BASE })
    assert.deepEqual(deleteRunRecords(storage), { status: 'deleted', deletedCount: 2, sessionCleaned: true })
    assert.equal(sessions.loadSession().status, 'none')
    assert.equal(sessions.loadSeen(), null)
  })
})
