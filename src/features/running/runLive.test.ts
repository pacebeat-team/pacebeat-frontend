import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { GpsSource, GpsSourceHandlers } from '../measurement/geolocationSource.ts'
import type { RawFix } from '../measurement/types.ts'
import { createRunLive, selectLiveMetrics } from './runLive.ts'
import { createRunStorage } from './runStorage.ts'
import type { RunKeyValueStorage } from './runStorage.ts'
import { createRunStore } from './runStore.ts'

const BASE = 1_700_000_000_000
const M_PER_DEG = 111_195

function setup() {
  const map = new Map<string, string>()
  const kv: RunKeyValueStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
  const store = createRunStore(createRunStorage(kv))
  let now = BASE
  let handlers: GpsSourceHandlers | null = null
  let running = false
  let starts = 0
  const source: GpsSource = {
    start: () => {
      running = true
      starts += 1
    },
    stop: () => {
      running = false
    },
    get isRunning() {
      return running
    },
  }
  const controller = createRunLive({
    store,
    now: () => now,
    createSource: (h) => {
      handlers = h
      return source
    },
    createId: () => 'sess-1',
    autoHeartbeat: false,
  })
  let meters = 0
  return {
    store,
    map,
    controller,
    get starts() {
      return starts
    },
    get sourceRunning() {
      return running
    },
    advance: (ms: number) => {
      now += ms
    },
    // 지정한 거리(m)만큼 북쪽으로 이동한 좌표를 받는다.
    moveTo: (distanceM: number) => {
      meters = distanceM
      const fix: RawFix = { lat: 37 + meters / M_PER_DEG, lng: 127, accuracyM: 5, deviceTime: now, receivedAt: now }
      handlers?.onFix(fix)
    },
    error: (reason: Parameters<GpsSourceHandlers['onError']>[0]) => handlers?.onError(reason),
  }
}

describe('시작·일시정지·종료', () => {
  test('begin: GPS는 세션을 시작하고 위치 수집을 쓴다, TIME은 수집하지 않는다', () => {
    const gps = setup()
    gps.controller.prepare({ onUnavailable: () => undefined })
    assert.equal(gps.sourceRunning, true)
    assert.equal(gps.store.getState().activeSession, null)
    gps.controller.begin('gps')
    assert.equal(gps.store.getState().activeSession?.session.status, 'running')
    assert.equal(gps.sourceRunning, true)

    const time = setup()
    time.controller.begin('time')
    assert.equal(time.starts, 0)
    assert.equal(time.sourceRunning, false)
    assert.equal(time.store.getState().activeSession?.mode, 'time')
  })
  test('일시정지·재개는 같은 session id이고 경과 시간에서 일시정지를 뺀다', () => {
    const t = setup()
    t.controller.begin('time')
    t.advance(10_000)
    t.controller.pause()
    t.advance(30_000)
    t.controller.resume()
    t.advance(5_000)
    const active = t.store.getState().activeSession
    assert.equal(active?.session.id, 'sess-1')
    t.controller.tick()
    const metrics = selectLiveMetrics(active, t.controller.live.getState().gps, t.controller.live.getState().now)
    assert.equal(metrics?.elapsedMs, 15_000)
    assert.equal(metrics?.distanceM, null)
    assert.equal(metrics?.currentPaceSecPerKm, null)
    assert.equal(metrics?.gpsSignal, null)
  })
  test('stop은 세션을 종료하고 위치 수집을 멈춘다', () => {
    const t = setup()
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.begin('gps')
    t.advance(1000)
    t.controller.stop('user')
    assert.equal(t.store.getState().activeSession?.session.status, 'finished')
    assert.equal(t.store.getState().activeSession?.session.endReason, 'user')
    assert.equal(t.sourceRunning, false)
  })
})

describe('GPS 거리 누적과 목표 도달', () => {
  test('좌표가 들어오면 거리가 쌓이고 샘플이 기록된다', () => {
    const t = setup()
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.begin('gps')
    for (let i = 0; i <= 30; i += 1) {
      t.moveTo(i * 3)
      t.advance(1000)
    }
    const active = t.store.getState().activeSession
    const metrics = selectLiveMetrics(active, t.controller.live.getState().gps, t.controller.live.getState().now)
    assert.ok((metrics?.distanceM ?? 0) > 80)
    assert.ok((active?.distanceSamples.length ?? 0) > 10)
  })
  test('목표 거리에 도달하면 세션이 한 번만 goal로 종료된다', () => {
    const t = setup()
    t.store.getState().setDistance(1)
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.begin('gps')
    let stops = 0
    t.store.subscribe((state, previous) => {
      if (state.activeSession?.session.status === 'finished' && previous.activeSession?.session.status !== 'finished') stops += 1
    })
    for (let i = 0; i <= 140; i += 1) {
      t.moveTo(i * 8)
      t.advance(1000)
    }
    const session = t.store.getState().activeSession?.session
    assert.equal(session?.status, 'finished')
    assert.equal(session?.endReason, 'auto')
    assert.equal(stops, 1)
    assert.equal(t.sourceRunning, false)
  })
  test('TIME 모드는 거리 목표로 종료되지 않고 샘플도 없다', () => {
    const t = setup()
    t.controller.begin('time')
    t.advance(3_600_000)
    assert.equal(t.store.getState().activeSession?.session.status, 'running')
    assert.equal(t.store.getState().activeSession?.distanceSamples.length, 0)
  })
  test('일시정지 중 받은 좌표는 거리에 반영되지 않는다', () => {
    const t = setup()
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.begin('gps')
    for (let i = 0; i <= 10; i += 1) {
      t.moveTo(i * 3)
      t.advance(1000)
    }
    t.controller.pause()
    const before = selectLiveMetrics(t.store.getState().activeSession, t.controller.live.getState().gps, BASE + 11_000)?.distanceM
    for (let i = 11; i <= 20; i += 1) {
      t.moveTo(i * 3)
      t.advance(1000)
    }
    const after = selectLiveMetrics(t.store.getState().activeSession, t.controller.live.getState().gps, BASE + 11_000)?.distanceM
    assert.equal(after, before)
  })
})

describe('위치 권한', () => {
  test('카운트다운 중 권한 거부: 시작하지 않고 알리며 수집을 멈춘다', () => {
    const t = setup()
    const reasons: string[] = []
    t.controller.prepare({ onUnavailable: (reason) => reasons.push(reason) })
    t.error('permission-denied')
    assert.deepEqual(reasons, ['permission-denied'])
    assert.equal(t.sourceRunning, false)
    assert.equal(t.store.getState().activeSession, null)
  })
  test('cancelPrepare는 세션 없이 수집만 멈춘다', () => {
    const t = setup()
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.cancelPrepare()
    assert.equal(t.sourceRunning, false)
    assert.equal(t.store.getState().activeSession, null)
  })
  test('러닝 중 권한 거부: 세션은 유지되고 신호가 사용 불가로 표시된다', () => {
    const t = setup()
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.begin('gps')
    t.error('permission-denied')
    assert.equal(t.store.getState().activeSession?.session.status, 'running')
    const metrics = selectLiveMetrics(t.store.getState().activeSession, t.controller.live.getState().gps, BASE)
    assert.equal(metrics?.gpsSignal, 'unavailable')
  })
})
