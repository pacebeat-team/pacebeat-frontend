import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { RecordsReadResult } from '../running/runStorage.ts'
import type { RunRecord } from '../running/types.ts'
import { beginLoad, completeLoad, createRecordsLoader, INITIAL_RECORDS_LOAD } from './recordsLoad.ts'

const record = (id: string) => ({ recordId: id }) as unknown as RunRecord
const ok = (...ids: string[]): RecordsReadResult => ({ ok: true, records: ids.map(record) })
const fail: RecordsReadResult = { ok: false, reason: 'unreadable' }

describe('상태 전이', () => {
  test('처음 조회: Loading → 기록 있음 / 없음(Empty) / 실패(Error)', () => {
    assert.equal(INITIAL_RECORDS_LOAD.phase, 'loading')
    assert.equal(completeLoad(INITIAL_RECORDS_LOAD, ok('a')).phase, 'ready')
    assert.equal(completeLoad(INITIAL_RECORDS_LOAD, ok()).phase, 'empty')
    assert.equal(completeLoad(INITIAL_RECORDS_LOAD, fail).phase, 'error')
  })
  test('Error·Empty에서 다시 조회하면 Loading을 거친다', () => {
    const error = completeLoad(INITIAL_RECORDS_LOAD, fail)
    assert.equal(beginLoad(error).phase, 'loading')
    const empty = completeLoad(INITIAL_RECORDS_LOAD, ok())
    assert.equal(beginLoad(empty).phase, 'loading')
  })
  test('기록이 있을 때 다시 조회하면 기록을 유지한 채 refreshing이다', () => {
    const ready = completeLoad(INITIAL_RECORDS_LOAD, ok('a', 'b'))
    const refreshing = beginLoad(ready)
    assert.equal(refreshing.phase, 'ready')
    assert.equal(refreshing.refreshing, true)
    assert.equal(refreshing.records.length, 2)
  })
  test('다시 조회 성공은 갱신, 0건이면 Empty, 실패는 기록 유지 + refreshError', () => {
    const refreshing = beginLoad(completeLoad(INITIAL_RECORDS_LOAD, ok('a')))
    const updated = completeLoad(refreshing, ok('a', 'b'))
    assert.deepEqual(updated.records.map((r) => r.recordId), ['a', 'b'])
    assert.equal(updated.refreshing, false)
    assert.equal(completeLoad(refreshing, ok()).phase, 'empty')
    const failed = completeLoad(refreshing, fail)
    assert.equal(failed.phase, 'ready')
    assert.equal(failed.records.length, 1)
    assert.equal(failed.refreshError, true)
    assert.equal(failed.refreshing, false)
    // 다음 조회를 시작하면 오류 표시는 지워진다.
    assert.equal(beginLoad(failed).refreshError, false)
  })
})

describe('로더', () => {
  test('기본 스케줄러는 즉시 끝난다: Loading을 거쳐 결과가 되지만 지연은 없다', () => {
    const phases: string[] = []
    const loader = createRecordsLoader(() => ok('a'))
    loader.subscribe(() => phases.push(loader.getState().phase))
    loader.load()
    assert.deepEqual(phases, ['loading', 'ready'])
  })
  test('지연된 읽기 동안 Loading이고 끝나면 결과로 바뀐다(지연은 테스트에서만 만든다)', () => {
    let finish: () => void = () => undefined
    const loader = createRecordsLoader(() => ok('a'), (run) => (finish = run))
    loader.load()
    assert.equal(loader.getState().phase, 'loading')
    finish()
    assert.equal(loader.getState().phase, 'ready')
  })
  test('읽기가 예외를 던져도 Error로 처리한다', () => {
    const loader = createRecordsLoader(() => {
      throw new Error('boom')
    })
    loader.load()
    assert.equal(loader.getState().phase, 'error')
  })
  test('Error 뒤 다시 시도: Loading → 성공', () => {
    let result: RecordsReadResult = fail
    const pending: (() => void)[] = []
    const loader = createRecordsLoader(() => result, (run) => pending.push(run))
    loader.load()
    pending.shift()?.()
    assert.equal(loader.getState().phase, 'error')
    result = ok('a')
    loader.load()
    assert.equal(loader.getState().phase, 'loading')
    pending.shift()?.()
    assert.equal(loader.getState().phase, 'ready')
  })
  test('조회가 겹치면 마지막 조회만 반영한다', () => {
    const pending: (() => void)[] = []
    let result: RecordsReadResult = ok('old')
    const loader = createRecordsLoader(() => result, (run) => pending.push(run))
    loader.load()
    loader.load()
    result = ok('new')
    pending[0]() // 앞선 조회는 버려진다
    assert.equal(loader.getState().phase, 'loading')
    pending[1]()
    assert.equal(loader.getState().records[0]?.recordId, 'new')
  })
  test('기록이 보이는 상태에서 재조회가 실패해도 기록은 남는다', () => {
    let result: RecordsReadResult = ok('a')
    const loader = createRecordsLoader(() => result)
    loader.load()
    result = fail
    loader.load()
    const state = loader.getState()
    assert.equal(state.phase, 'ready')
    assert.equal(state.records.length, 1)
    assert.equal(state.refreshError, true)
  })
})
