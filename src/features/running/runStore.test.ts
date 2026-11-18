import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRunStorage } from './runStorage.ts'
import type { RunKeyValueStorage } from './runStorage.ts'
import { createRunStore } from './runStore.ts'

const BASE = 1_700_000_000_000

function setup() {
  const map = new Map<string, string>()
  const kv: RunKeyValueStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
  const storage = createRunStorage(kv)
  return { map, kv, storage, store: createRunStore(storage) }
}

describe('목표 draft', () => {
  test('처음에는 기본값(3km 22:30, 음악 없음, 최근 목표 없음, 세션 없음)', () => {
    const { store } = setup()
    const { draft, activeSession } = store.getState()
    assert.equal(draft.distanceKm, 3)
    assert.equal(draft.targetDurationSec, 1350)
    assert.equal(draft.musicTrackId, null)
    assert.deepEqual(draft.recentGoals, [])
    assert.equal(activeSession, null)
  })
  test('거리를 바꾸면 목표 페이스를 유지하도록 시간이 다시 계산된다', () => {
    const { store } = setup()
    store.getState().setTargetDuration(1320) // 3km 22:00 = 7:20/km
    store.getState().setDistance(1)
    assert.equal(store.getState().draft.targetDurationSec, 440) // 1km 7:20
    store.getState().setDistance(5)
    assert.equal(store.getState().draft.targetDurationSec, 2200) // 5km 36:40
  })
  test('목표 시간은 범위 안의 정수 초로 제한된다', () => {
    const { store } = setup()
    store.getState().setTargetDuration(1349)
    assert.equal(store.getState().draft.targetDurationSec, 1349)
    store.getState().setTargetDuration(5)
    assert.equal(store.getState().draft.targetDurationSec, 720)
    store.getState().setTargetDuration(99999)
    assert.equal(store.getState().draft.targetDurationSec, 1800)
  })
  test('음악을 고르거나 고르지 않을 수 있다(없으면 null)', () => {
    const { store } = setup()
    store.getState().setMusicTrack('city-loop')
    assert.equal(store.getState().draft.musicTrackId, 'city-loop')
    store.getState().setMusicTrack(null)
    assert.equal(store.getState().draft.musicTrackId, null)
  })
  test('draft는 전용 키에 저장되고 새 Store가 이어서 읽는다', () => {
    const { store, kv } = setup()
    store.getState().setDistance(5)
    store.getState().setMusicTrack('night-pace')
    const again = createRunStore(createRunStorage(kv))
    assert.equal(again.getState().draft.distanceKm, 5)
    assert.equal(again.getState().draft.musicTrackId, 'night-pace')
  })
})

describe('러닝 시작과 최근 목표', () => {
  test('GPS 시작: draft의 목표를 쓰고 최근 목표에 기록한다(최신순·중복 제거·최대 2개)', () => {
    const { store } = setup()
    const run = () => {
      store.getState().startRun('gps', BASE, () => 'id')
      store.getState().stopRun(BASE + 1000)
      store.getState().clearSession()
    }
    store.getState().setTargetDuration(1260)
    run()
    store.getState().setDistance(1)
    run()
    store.getState().setDistance(5)
    run()
    assert.deepEqual(
      store.getState().draft.recentGoals.map((goal) => goal.distanceKm),
      [5, 1],
    )
    store.getState().setDistance(1)
    run()
    assert.deepEqual(
      store.getState().draft.recentGoals.map((goal) => goal.distanceKm),
      [1, 5],
    )
  })
  test('GPS 시작: 세션 목표는 draft 값이다', () => {
    const { store } = setup()
    store.getState().setTargetDuration(1260)
    store.getState().setMusicTrack('morning-stride')
    store.getState().startRun('gps', BASE, () => 'sess-1')
    const active = store.getState().activeSession
    assert.equal(active?.mode, 'gps')
    assert.deepEqual(active?.goal, { targetDistanceKm: 3, targetDurationSec: 1260 })
    assert.equal(active?.musicTrackId, 'morning-stride')
    assert.equal(active?.session.id, 'sess-1')
  })
  test('TIME 시작: 목표가 없고 최근 목표도 바뀌지 않는다', () => {
    const { store } = setup()
    store.getState().startRun('time', BASE, () => 'sess-t')
    const active = store.getState().activeSession
    assert.equal(active?.mode, 'time')
    assert.deepEqual(active?.goal, { targetDistanceKm: null, targetDurationSec: null })
    assert.deepEqual(store.getState().draft.recentGoals, [])
  })
  test('활성 세션이 있으면 다시 시작해도 바뀌지 않는다', () => {
    const { store } = setup()
    store.getState().startRun('gps', BASE, () => 'first')
    store.getState().startRun('time', BASE + 1000, () => 'second')
    assert.equal(store.getState().activeSession?.session.id, 'first')
    assert.equal(store.getState().activeSession?.mode, 'gps')
  })
  test('올바르지 않은 시각으로는 시작하지 않는다', () => {
    const { store } = setup()
    store.getState().startRun('gps', Number.NaN)
    assert.equal(store.getState().activeSession, null)
  })
})

describe('세션 진행', () => {
  test('일시정지·재개는 같은 session id를 유지하고 종료하면 finished가 된다', () => {
    const { store } = setup()
    store.getState().startRun('gps', BASE, () => 'sess-1')
    store.getState().pauseRun(BASE + 10_000)
    assert.equal(store.getState().activeSession?.session.status, 'paused')
    store.getState().resumeRun(BASE + 20_000)
    assert.equal(store.getState().activeSession?.session.status, 'running')
    assert.equal(store.getState().activeSession?.session.id, 'sess-1')
    store.getState().stopRun(BASE + 30_000, 'goal')
    assert.equal(store.getState().activeSession?.session.status, 'finished')
    assert.equal(store.getState().activeSession?.session.endReason, 'auto')
  })
  test('세션이 없을 때의 일시정지·재개·종료는 아무 일도 하지 않는다', () => {
    const { store } = setup()
    store.getState().pauseRun(BASE)
    store.getState().resumeRun(BASE)
    store.getState().stopRun(BASE)
    store.getState().recordDistanceSample(1000, 10)
    assert.equal(store.getState().activeSession, null)
  })
  test('거리 샘플은 GPS 모드에서만 쌓고 TIME 모드에서는 쌓지 않는다', () => {
    const { store } = setup()
    store.getState().startRun('gps', BASE, () => 'g')
    store.getState().recordDistanceSample(1000, 5)
    store.getState().recordDistanceSample(2000, 3) // 거리가 줄면 버린다
    assert.equal(store.getState().activeSession?.distanceSamples.length, 1)
    store.getState().clearSession()
    store.getState().startRun('time', BASE, () => 't')
    store.getState().recordDistanceSample(1000, 5)
    assert.equal(store.getState().activeSession?.distanceSamples.length, 0)
  })
  test('새 Store는 저장된 세션을 상태로 불러오지 않는다', () => {
    const { store, kv } = setup()
    store.getState().startRun('gps', BASE, () => 'sess-1')
    assert.equal(createRunStore(createRunStorage(kv)).getState().activeSession, null)
  })
})

describe('저장 실패', () => {
  test('저장소가 실패해도 메모리 상태는 유지되고 예외를 던지지 않는다', () => {
    const failing = createRunStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    const store = createRunStore(failing)
    assert.doesNotThrow(() => store.getState().setDistance(5))
    assert.doesNotThrow(() => store.getState().startRun('gps', BASE, () => 's'))
    assert.doesNotThrow(() => store.getState().clearSession())
    assert.equal(store.getState().draft.distanceKm, 5)
  })
  test('저장소가 없는 환경(null)에서도 동작한다', () => {
    const store = createRunStore(createRunStorage(null))
    store.getState().startRun('time', BASE, () => 's')
    assert.equal(store.getState().activeSession?.mode, 'time')
  })
})
