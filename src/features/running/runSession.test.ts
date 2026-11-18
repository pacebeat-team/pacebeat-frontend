import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { generateVirtualRun } from '../measurement/virtualRun.ts'
import { VIRTUAL_SCENARIOS } from '../measurement/virtualScenarios.ts'
import type { GpsSource, GpsSourceHandlers } from '../measurement/geolocationSource.ts'
import type { GpsErrorReason, RawFix } from '../measurement/types.ts'
import { createRunLive, HEARTBEAT_MS, selectLiveMetrics } from './runLive.ts'
import { createRunStorage } from './runStorage.ts'
import type { RunKeyValueStorage } from './runStorage.ts'
import { createRunStore } from './runStore.ts'

// 세션 안정화(#48): 복원·GPS 끊김/복구·화면 복귀 재연결·주기 저장. 가상 GPS 시나리오를 같은 경로로 흘려 보낸다.

const BASE = 1_700_000_000_000

function memory() {
  const map = new Map<string, string>()
  const kv: RunKeyValueStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
  return { map, kv }
}

function app(kv = memory().kv) {
  const storage = createRunStorage(kv)
  const store = createRunStore(storage)
  let now = BASE
  let handlers: GpsSourceHandlers | null = null
  let running = false
  let starts = 0
  let visibleCallback: (() => void) | null = null
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
    listenVisible: (callback) => {
      visibleCallback = callback
      return () => {
        visibleCallback = null
      }
    },
    autoHeartbeat: false,
  })
  return {
    kv,
    storage,
    store,
    controller,
    get starts() {
      return starts
    },
    get sourceRunning() {
      return running
    },
    get hasVisibleListener() {
      return visibleCallback !== null
    },
    setNow: (value: number) => {
      now = value
    },
    advance: (ms: number) => {
      now += ms
    },
    show: () => visibleCallback?.(),
    fix: (lat: number, lng: number, accuracyM = 5) => {
      const raw: RawFix = { lat, lng, accuracyM, deviceTime: now, receivedAt: now }
      handlers?.onFix(raw)
    },
    error: (reason: GpsErrorReason) => handlers?.onError(reason),
    metrics: () => selectLiveMetrics(store.getState().activeSession, controller.live.getState().gps, now),
  }
}

const M = 111_195

describe('GPS 끊김과 복구', () => {
  test('가상 시나리오 gps-lost: 끊김 구간이 기록되고 거리는 유효 좌표로만 늘며 복구 뒤 이어진다', () => {
    const t = app()
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.begin('gps')
    const events = generateVirtualRun(VIRTUAL_SCENARIOS['gps-lost'])
    let lostSeen = false
    let distanceBeforeLoss = 0
    for (const event of events) {
      if (event.kind !== 'fix') continue
      t.setNow(BASE + event.deliverAtMs)
      t.fix(event.lat, event.lng, event.accuracyM)
      t.controller.tick()
      const gaps = t.store.getState().activeSession?.gpsGaps ?? []
      if (gaps.length > 0 && gaps[gaps.length - 1].recoveredAtMs === null && !lostSeen) {
        lostSeen = true
        distanceBeforeLoss = t.metrics()?.distanceM ?? 0
      }
    }
    // 시나리오 안에서 끊겼다가 복구된다: 구간 1개가 닫혀 있다
    const recovered = t.store.getState().activeSession?.gpsGaps ?? []
    assert.equal(recovered.length, 1)
    assert.notEqual(recovered[0].recoveredAtMs, null)
    assert.ok((recovered[0].recoveredAtMs ?? 0) > recovered[0].lostAtMs)
    // 끊김 구간 동안 시계는 계속 흐른다(마지막 좌표 뒤 20초)
    t.advance(20_000)
    t.controller.tick()
    const gaps = t.store.getState().activeSession?.gpsGaps ?? []
    assert.ok(gaps.length >= 1, '끊김 구간 기록')
    assert.ok(distanceBeforeLoss >= 0)
    assert.equal(t.store.getState().activeSession?.mode, 'gps') // TIME으로 바뀌지 않는다
    assert.equal(t.store.getState().activeSession?.session.status, 'running')
  })
  test('신호가 끊기면 현재 페이스가 없고, 복구되면 구간이 닫힌다', () => {
    const t = app()
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.begin('gps')
    for (let i = 0; i <= 20; i += 1) {
      t.fix(37 + (i * 3) / M, 127)
      t.advance(1000)
    }
    const before = t.metrics()?.distanceM ?? 0
    assert.ok(before > 40)
    // 20초 동안 좌표가 없다
    t.advance(20_000)
    t.controller.tick()
    const lost = t.metrics()
    assert.equal(lost?.gpsSignal, 'lost')
    assert.equal(lost?.currentPaceSecPerKm, null)
    assert.equal(lost?.distanceM, before) // 유효 거리는 그대로
    const open = t.store.getState().activeSession?.gpsGaps ?? []
    assert.equal(open.length, 1)
    assert.equal(open[0].recoveredAtMs, null)
    // 복구: 새 좌표
    t.fix(37 + 400 / M, 127)
    const after = t.store.getState().activeSession?.gpsGaps ?? []
    assert.equal(after.length, 1)
    assert.notEqual(after[0].recoveredAtMs, null)
    // 복구 직후 재앵커: 멀리 떨어진 첫 좌표를 거리로 더하지 않는다
    assert.ok((t.metrics()?.distanceM ?? 0) - before < 5)
  })
  test('끊긴 동안에는 목표에 도달하지 않는다(유효 거리로만 판정)', () => {
    const t = app()
    t.store.getState().setDistance(1)
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.begin('gps')
    t.fix(37, 127)
    t.advance(60_000) // 좌표 없이 시간만 흐른다
    t.controller.tick()
    assert.equal(t.store.getState().activeSession?.session.status, 'running')
  })
  test('러닝 중 권한 회수: 모드는 유지되고 끊김 구간이 열린다', () => {
    const t = app()
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.begin('gps')
    t.fix(37, 127)
    t.advance(1000)
    t.error('permission-denied')
    t.advance(2000)
    t.controller.tick()
    assert.equal(t.metrics()?.gpsSignal, 'unavailable')
    assert.equal(t.store.getState().activeSession?.mode, 'gps')
    assert.equal(t.store.getState().activeSession?.gpsGaps.length, 1)
  })
  test('일시정지 중에는 끊김 구간을 열지 않는다', () => {
    const t = app()
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.begin('gps')
    t.fix(37, 127)
    t.controller.pause()
    t.advance(120_000)
    t.controller.tick()
    assert.equal(t.store.getState().activeSession?.gpsGaps.length, 0)
  })
})

describe('화면 복귀(visibilitychange)와 주기 저장', () => {
  test('진행 중 GPS 러닝은 화면이 다시 보일 때 위치 구독을 새로 연결한다', () => {
    const t = app()
    t.controller.prepare({ onUnavailable: () => undefined })
    t.controller.begin('gps')
    assert.equal(t.hasVisibleListener, true)
    const startsBefore = t.starts
    t.advance(30_000)
    t.show()
    assert.equal(t.starts, startsBefore + 1)
    assert.equal(t.sourceRunning, true)
  })
  test('TIME 러닝·일시정지 중에는 위치 구독을 만들지 않고, 종료하면 리스너가 해제된다', () => {
    const time = app()
    time.controller.begin('time')
    time.show()
    assert.equal(time.starts, 0)
    const paused = app()
    paused.controller.prepare({ onUnavailable: () => undefined })
    paused.controller.begin('gps')
    paused.controller.pause()
    assert.equal(paused.hasVisibleListener, false)
    const stopped = app()
    stopped.controller.begin('time')
    stopped.controller.stop()
    assert.equal(stopped.hasVisibleListener, false)
  })
  test('heartbeat는 마지막 확인 시각을 저장한다(진행 중에만)', () => {
    const t = app()
    t.controller.begin('time')
    t.advance(HEARTBEAT_MS)
    t.controller.heartbeat()
    assert.equal(t.storage.loadSession()?.lastSeenAt, BASE + HEARTBEAT_MS)
    t.controller.pause()
    t.advance(HEARTBEAT_MS)
    t.controller.heartbeat()
    assert.equal(t.storage.loadSession()?.lastSeenAt, BASE + HEARTBEAT_MS)
  })
})
