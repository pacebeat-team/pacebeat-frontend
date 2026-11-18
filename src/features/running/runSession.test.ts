import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { generateVirtualRun } from '../measurement/virtualRun.ts'
import { VIRTUAL_SCENARIOS } from '../measurement/virtualScenarios.ts'
import type { GpsSource, GpsSourceHandlers } from '../measurement/geolocationSource.ts'
import type { GpsErrorReason, RawFix } from '../measurement/types.ts'
import { describeGpsStatus } from './gpsStatus.ts'
import { createRunLive, HEARTBEAT_MS, selectLiveMetrics } from './runLive.ts'
import { decideRestore, RESTORE_MAX_AGE_MS } from './runRestore.ts'
import { createRunStorage, RUN_STORAGE_KEYS } from './runStorage.ts'
import type { RunKeyValueStorage, RunSessionSnapshot } from './runStorage.ts'
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
    storage,
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
  test('신호가 끊기면 현재 페이스가 없고, 복구되면 구간이 닫히며 복구 시각이 안내된다', () => {
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
    assert.equal(describeGpsStatus(lost?.gpsSignal ?? null, t.store.getState().activeSession?.gpsGaps ?? [], lost?.elapsedMs ?? 0), '신호를 찾고 있어요')
    const open = t.store.getState().activeSession?.gpsGaps ?? []
    assert.equal(open.length, 1)
    assert.equal(open[0].recoveredAtMs, null)
    // 복구: 새 좌표
    t.fix(37 + 400 / M, 127)
    const after = t.store.getState().activeSession?.gpsGaps ?? []
    assert.equal(after.length, 1)
    assert.notEqual(after[0].recoveredAtMs, null)
    const status = describeGpsStatus('good', after, t.metrics()?.elapsedMs ?? 0)
    assert.match(status, /^\d\d:\d\d에 신호가 복구됐어요$/)
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
    assert.equal(describeGpsStatus('unavailable', [], 0), '위치를 사용할 수 없어요')
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

describe('새로고침 복원', () => {
  function snapshot(status: 'running' | 'paused' | 'finished', lastSeenAt: number | null): RunSessionSnapshot {
    const t = app()
    t.controller.begin('gps')
    t.advance(60_000)
    if (status === 'paused') t.controller.pause()
    if (status === 'finished') t.controller.stop()
    const base = t.store.getState().activeSession as RunSessionSnapshot
    return { ...base, lastSeenAt, distanceSamples: [{ elapsedMs: 50_000, distanceM: 120 }] }
  }
  test('decideRestore: 없음·24시간 경과 폐기·진행 중은 lastSeenAt에 일시정지', () => {
    assert.deepEqual(decideRestore(null, BASE), { kind: 'none' })
    const running = snapshot('running', BASE + 50_000)
    const decision = decideRestore(running, BASE + 3_600_000)
    assert.equal(decision.kind, 'restore')
    if (decision.kind === 'restore') {
      assert.equal(decision.snapshot.session.status, 'paused')
      assert.equal(decision.snapshot.session.pauses[0].pausedAt, BASE + 50_000)
      assert.equal(decision.snapshot.session.id, 'sess-1')
    }
    assert.deepEqual(decideRestore(running, BASE + 50_000 + RESTORE_MAX_AGE_MS + 1), { kind: 'discard', reason: 'expired' })
    assert.equal(decideRestore(running, BASE + 50_000 + RESTORE_MAX_AGE_MS).kind, 'restore')
  })
  test('앱이 닫혀 있던 시간은 러닝 시간에 들어가지 않고, 계속하면 같은 session id로 이어진다', () => {
    const first = app()
    first.controller.prepare({ onUnavailable: () => undefined })
    first.controller.begin('gps')
    first.advance(40_000)
    first.controller.heartbeat() // lastSeenAt = BASE+40s
    first.advance(20_000) // 이후 20초는 확인하지 못한 채 앱이 닫힘
    // 3시간 뒤 새로 연다(같은 저장소)
    const second = app(first.kv)
    second.setNow(BASE + 3 * 3_600_000)
    const outcome = second.controller.restore()
    assert.equal(outcome, 'paused')
    const restored = second.store.getState().activeSession
    assert.equal(restored?.session.status, 'paused')
    assert.equal(restored?.session.id, first.store.getState().activeSession?.session.id)
    second.controller.tick()
    assert.equal(second.metrics()?.elapsedMs, 40_000)
    second.controller.resume()
    assert.equal(second.store.getState().activeSession?.session.status, 'running')
    assert.equal(second.store.getState().activeSession?.session.id, 'sess-1')
    assert.equal(second.sourceRunning, true) // GPS 재확인(구독 시작)
    second.advance(5_000)
    second.controller.tick()
    assert.equal(second.metrics()?.elapsedMs, 45_000)
  })
  test('복원한 GPS 세션: 쌓인 거리를 이어가고 위치를 다시 받기 전까지는 끊김으로 본다', () => {
    const first = app()
    first.controller.prepare({ onUnavailable: () => undefined })
    first.controller.begin('gps')
    for (let i = 0; i <= 30; i += 1) {
      first.fix(37 + (i * 3) / M, 127)
      first.advance(1000)
    }
    first.controller.heartbeat()
    const distance = first.metrics()?.distanceM ?? 0
    assert.ok(distance > 60)
    const second = app(first.kv)
    second.setNow(BASE + 600_000)
    assert.equal(second.controller.restore(), 'paused')
    assert.equal(second.metrics()?.distanceM, distance) // 구독 없이도 쌓인 거리 유지
    second.controller.resume()
    second.advance(2000)
    second.controller.tick()
    assert.equal(second.store.getState().activeSession?.gpsGaps.length, 1) // 재확인 전까지 끊김
    second.fix(37 + 100 / M, 127)
    assert.notEqual(second.store.getState().activeSession?.gpsGaps[0].recoveredAtMs, null)
  })
  test('권한이 거부된 채 복원돼도 모드는 GPS로 유지되고 끊김 상태가 된다(TIME으로 바뀌지 않는다)', () => {
    const first = app()
    first.controller.begin('gps')
    first.controller.heartbeat()
    const second = app(first.kv)
    second.setNow(BASE + 10_000)
    second.controller.restore()
    second.controller.resume()
    second.error('permission-denied')
    second.advance(1000)
    second.controller.tick()
    assert.equal(second.store.getState().activeSession?.mode, 'gps')
    assert.equal(second.metrics()?.gpsSignal, 'unavailable')
  })
  test('종료됐지만 저장하지 않은 결과는 결과 상태로 복원된다', () => {
    const first = app()
    first.controller.begin('time')
    first.advance(90_000)
    first.controller.stop()
    const second = app(first.kv)
    second.setNow(BASE + 120_000)
    assert.equal(second.controller.restore(), 'finished')
    assert.equal(second.store.getState().activeSession?.session.status, 'finished')
  })
  test('24시간이 지난 세션은 폐기하고 저장 키를 지운다', () => {
    const first = app()
    first.controller.begin('time')
    first.controller.heartbeat()
    const second = app(first.kv)
    second.setNow(BASE + RESTORE_MAX_AGE_MS + 1000)
    assert.equal(second.controller.restore(), 'discarded')
    assert.equal(second.store.getState().activeSession, null)
    assert.equal(second.kv.getItem(RUN_STORAGE_KEYS.session), null)
  })
  test('손상된 저장값은 건너뛰고 키를 지운다. 저장소를 쓸 수 없어도 예외가 없다', () => {
    const mem = memory()
    mem.kv.setItem(RUN_STORAGE_KEYS.session, '{깨진 json')
    const t = app(mem.kv)
    assert.equal(t.controller.restore(), 'none')
    assert.equal(mem.kv.getItem(RUN_STORAGE_KEYS.session), null)
    const unavailable = createRunLive({ store: createRunStore(createRunStorage(null)), storage: createRunStorage(null), now: () => BASE })
    assert.doesNotThrow(() => unavailable.restore())
    const throwing = createRunStorage({
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    })
    const broken = createRunLive({ store: createRunStore(throwing), storage: throwing, now: () => BASE })
    assert.doesNotThrow(() => broken.restore())
  })
  test('기초 측정 저장 키는 건드리지 않는다', () => {
    const mem = memory()
    mem.kv.setItem('pacebeat:measurement:v1', 'measurement-data')
    const first = app(mem.kv)
    first.controller.begin('time')
    first.controller.heartbeat()
    app(mem.kv).controller.restore()
    assert.equal(mem.kv.getItem('pacebeat:measurement:v1'), 'measurement-data')
  })
})

describe('GPS 상태 문구', () => {
  test('복구 안내는 복구 직후 10초 동안만 보인다', () => {
    const gaps = [{ lostAtMs: 200_000, recoveredAtMs: 252_000 }]
    assert.equal(describeGpsStatus('good', gaps, 255_000), '04:12에 신호가 복구됐어요')
    assert.equal(describeGpsStatus('good', gaps, 263_000), 'GPS 신호 정상')
    assert.equal(describeGpsStatus(null, [], 0), '신호를 찾고 있어요')
    assert.equal(describeGpsStatus('lost', gaps, 300_000), '신호를 찾고 있어요')
  })
})
