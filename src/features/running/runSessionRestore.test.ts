import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { GpsSource, GpsSourceHandlers } from '../measurement/geolocationSource.ts'
import type { RawFix } from '../measurement/types.ts'
import { deriveRecordId } from './record.ts'
import { isArrivalPending, resolveRunRedirect, RUN_PATHS } from './runFlow.ts'
import { createRunLive, selectLiveMetrics } from './runLive.ts'
import { createRunResultStore } from './runResultStore.ts'
import { SAMPLE_SAVE_MIN_INTERVAL_MS, SESSION_MAX_AGE_MS, startRunSessionPersistence } from './runSessionRestore.ts'
import { createRunSessionStorage, RUN_SESSION_KEYS } from './runSessionStorage.ts'
import { getRunElapsedMs } from './runSession.ts'
import { createRunStorage, RUN_STORAGE_KEYS } from './runStorage.ts'
import type { RunKeyValueStorage } from './runStorage.ts'
import { createRunStore } from './runStore.ts'

const BASE = 1_700_000_000_000
const M_PER_DEG = 111_195
const HOUR = 60 * 60 * 1000

// 새로고침을 흉내 내려고 저장소(map)는 그대로 두고 Store·컨트롤러를 새로 만든다.
interface Disk {
  readonly map: Map<string, string>
  failWrites: boolean
  failRemoves: boolean
  // 이 키에 대한 읽기·쓰기·삭제는 모두 실패한다.
  readonly failKeys: Set<string>
  writes: number
}

function createDisk(): Disk {
  return { map: new Map(), failWrites: false, failRemoves: false, failKeys: new Set(), writes: 0 }
}

function kvOf(disk: Disk): RunKeyValueStorage {
  return {
    getItem: (key) => {
      if (disk.failKeys.has(key)) throw new Error('denied')
      return disk.map.get(key) ?? null
    },
    setItem: (key, value) => {
      if (disk.failWrites || disk.failKeys.has(key)) throw new Error('quota')
      disk.writes += 1
      disk.map.set(key, value)
    },
    removeItem: (key) => {
      if (disk.failRemoves || disk.failKeys.has(key)) throw new Error('blocked')
      disk.map.delete(key)
    },
  }
}

function boot(disk: Disk, startAt: number, kv: RunKeyValueStorage | null = kvOf(disk)) {
  const clock = { now: startAt }
  const records = createRunStorage(kv)
  const runs = createRunStore(records)
  const results = createRunResultStore(runs, records, { getState: () => ({ reset: () => undefined }) })
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
    store: runs,
    now: () => clock.now,
    createSource: (h) => {
      handlers = h
      return source
    },
    createId: () => 'sess-1',
    autoHeartbeat: false,
    listenVisible: () => () => undefined,
    queryPermission: () => Promise.resolve('unknown'),
  })
  // 구독이 등록되는 시점의 Store 상태를 기록한다(복원이 끝난 뒤에 구독하는지 확인).
  const seenAtSubscribe: boolean[] = []
  const spiedRuns = {
    ...runs,
    subscribe: (listener: Parameters<typeof runs.subscribe>[0]) => {
      seenAtSubscribe.push(runs.getState().activeSession !== null)
      return runs.subscribe(listener)
    },
  }
  const persistence = startRunSessionPersistence({
    runs: spiedRuns,
    results,
    live: controller.live,
    sessionStorage: createRunSessionStorage(kv),
    records,
    now: () => clock.now,
  })
  let meters = 0
  return {
    clock,
    runs,
    results,
    controller,
    persistence,
    seenAtSubscribe,
    get starts() {
      return starts
    },
    get sourceRunning() {
      return running
    },
    moveTo: (distanceM: number) => {
      meters = distanceM
      const fix: RawFix = { lat: 37 + meters / M_PER_DEG, lng: 127, accuracyM: 5, deviceTime: clock.now, receivedAt: clock.now }
      handlers?.onFix(fix)
    },
    error: (reason: Parameters<GpsSourceHandlers['onError']>[0]) => handlers?.onError(reason),
  }
}

type App = ReturnType<typeof boot>

// GPS 러닝을 시작해 30m씩 이동한다(3m/s).
function runGps(app: App, steps: number): void {
  app.controller.prepare({ onUnavailable: () => undefined })
  app.controller.begin('gps')
  for (let index = 1; index <= steps; index += 1) {
    app.clock.now += 10_000
    app.moveTo(index * 30)
  }
}

function lastDistance(app: App): number | undefined {
  const samples = app.runs.getState().activeSession?.distanceSamples ?? []
  return samples[samples.length - 1]?.distanceM
}

function storedUpdatedAt(disk: Disk): number {
  const raw = disk.map.get(RUN_SESSION_KEYS.session)
  assert.ok(raw)
  return (JSON.parse(raw) as { data: { updatedAt: number } }).data.updatedAt
}

describe('복원 초기화 순서', () => {
  test('복원이 끝난 뒤에만 구독하고, 복원 전 activeSession이 null이어도 세션 키를 지우지 않는다', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    first.controller.begin('time')
    assert.ok(disk.map.has(RUN_SESSION_KEYS.session))

    const second = boot(disk, BASE + 5_000)
    assert.equal(second.persistence.getStatus().restore, 'ready')
    assert.equal(second.persistence.getStatus().outcome, 'restored')
    // 구독을 등록하는 순간 이미 복원된 세션이 있다.
    assert.deepEqual(second.seenAtSubscribe, [true])
    assert.ok(disk.map.has(RUN_SESSION_KEYS.session))
    assert.equal(second.runs.getState().activeSession?.session.id, 'sess-1')
  })
  test('세션이 없으면 아무것도 복원하지 않고 기록은 건드리지 않는다', () => {
    const disk = createDisk()
    disk.map.set(RUN_STORAGE_KEYS.records, '{"version":1,"data":[]}')
    const app = boot(disk, BASE)
    assert.equal(app.persistence.getStatus().outcome, 'none')
    assert.equal(app.runs.getState().activeSession, null)
    assert.equal(disk.map.get(RUN_STORAGE_KEYS.records), '{"version":1,"data":[]}')
  })
  test('저장소를 쓸 수 없어도 앱이 깨지지 않는다(복원을 건너뛴다)', () => {
    const app = boot(createDisk(), BASE, null)
    assert.equal(app.persistence.getStatus().outcome, 'unavailable')
    app.controller.begin('time')
    assert.equal(app.runs.getState().activeSession?.session.status, 'running')
    assert.equal(app.persistence.getStatus().lastSaveError, 'unavailable')
  })
})

describe('복원', () => {
  test('진행 중이던 세션은 마지막 저장 시각에 일시정지된 상태로 같은 id로 복원된다', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    first.controller.begin('time')
    first.clock.now += 20_000
    first.controller.tick()
    first.controller.pause() // 20초 시점에 일시정지, 저장
    const savedAt = first.clock.now

    const second = boot(disk, savedAt + 3 * HOUR)
    const active = second.runs.getState().activeSession
    assert.equal(active?.session.id, 'sess-1')
    assert.equal(active?.session.status, 'paused')
    assert.equal(active?.session.pauses[0]?.pausedAt, savedAt)
  })
  test('실행 중 새로고침: 새로고침 동안의 시간은 경과 시간에 넣지 않는다', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    first.controller.begin('time') // 시작 시점에 저장(updatedAt = BASE)
    const second = boot(disk, BASE + 30 * 60 * 1000)
    const active = second.runs.getState().activeSession
    assert.equal(active?.session.status, 'paused')
    const metrics = selectLiveMetrics(active ?? null, second.controller.live.getState().gps, BASE + 30 * 60 * 1000)
    assert.equal(metrics?.elapsedMs, 0)
  })
  test('TIME 러닝 중 시계가 흐른 만큼은 새로고침해도 경과 시간에 남는다(만료 기준은 그대로)', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    first.controller.begin('time')
    const updatedAt = storedUpdatedAt(disk)
    for (let second = 1; second <= 30; second += 1) {
      first.clock.now += 1000
      first.controller.tick()
    }
    assert.equal(storedUpdatedAt(disk), updatedAt, '시계 틱은 세션 저장 시각(만료 기준)을 바꾸지 않는다')
    const second = boot(disk, first.clock.now + 5 * 60_000)
    const active = second.runs.getState().activeSession ?? null
    const metrics = selectLiveMetrics(active, second.controller.live.getState().gps, second.clock.now)
    assert.ok((metrics?.elapsedMs ?? 0) >= 25_000 && (metrics?.elapsedMs ?? 0) <= 30_000)
  })
  test('손상된 세션 데이터는 폐기하고 복원하지 않는다', () => {
    for (const raw of ['not-json', '{"version":2,"data":{}}', '{"version":1,"data":{"updatedAt":1,"snapshot":{"mode":"gps"}}}']) {
      const disk = createDisk()
      disk.map.set(RUN_SESSION_KEYS.session, raw)
      const app = boot(disk, BASE)
      assert.equal(app.persistence.getStatus().outcome, 'corrupt')
      assert.equal(app.runs.getState().activeSession, null)
      assert.equal(disk.map.has(RUN_SESSION_KEYS.session), false)
    }
  })
  test('앞뒤가 맞지 않는 값(감소하는 거리, 종료 시각 불일치)도 손상으로 본다', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    runGps(first, 3)
    const stored = JSON.parse(disk.map.get(RUN_SESSION_KEYS.session) ?? '') as {
      data: { snapshot: { distanceSamples: { distanceM: number }[] } }
    }
    stored.data.snapshot.distanceSamples[2] = { ...stored.data.snapshot.distanceSamples[2], distanceM: 1 }
    disk.map.set(RUN_SESSION_KEYS.session, JSON.stringify(stored))
    assert.equal(boot(disk, first.clock.now).persistence.getStatus().outcome, 'corrupt')
  })
})

describe('24시간 만료(마지막 세션 저장 성공 기준)', () => {
  test('저장 후 24시간 이내면 복원하고 24시간을 넘으면 폐기한다', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    first.controller.begin('time')
    const savedAt = storedUpdatedAt(disk)
    assert.equal(boot(disk, savedAt + SESSION_MAX_AGE_MS).persistence.getStatus().outcome, 'restored')
    const late = boot(disk, savedAt + SESSION_MAX_AGE_MS + 1)
    assert.equal(late.persistence.getStatus().outcome, 'expired')
    assert.equal(late.runs.getState().activeSession, null)
    assert.equal(disk.map.has(RUN_SESSION_KEYS.session), false)
  })
  test('시작 시각이 24시간 전이어도 최근에 저장했다면 복원한다', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    first.controller.begin('time')
    first.clock.now += 30 * HOUR
    first.controller.pause() // 일시정지 저장 = updatedAt
    const second = boot(disk, first.clock.now + HOUR)
    assert.equal(second.persistence.getStatus().outcome, 'restored')
  })
  test('일시정지·백그라운드 동안에는 저장하지 않아 만료 시간이 늘어나지 않는다', () => {
    const disk = createDisk()
    const app = boot(disk, BASE)
    app.controller.begin('time')
    app.controller.pause()
    const writes = disk.writes
    const updatedAt = storedUpdatedAt(disk)
    for (let hour = 1; hour <= 10; hour += 1) {
      app.clock.now += HOUR
      app.controller.tick() // 시계 틱·하트비트는 세션을 바꾸지 않는다
    }
    assert.equal(disk.writes, writes)
    assert.equal(storedUpdatedAt(disk), updatedAt)
    // 복원 자체도 저장하지 않는다.
    boot(disk, app.clock.now)
    assert.equal(disk.writes, writes)
  })
  test('저장에 실패하면 updatedAt은 마지막으로 성공한 시각으로 남고 앱은 계속 동작한다', () => {
    const disk = createDisk()
    const app = boot(disk, BASE)
    app.controller.begin('time')
    const updatedAt = storedUpdatedAt(disk)
    disk.failWrites = true
    app.clock.now += HOUR
    app.controller.pause()
    assert.equal(app.persistence.getStatus().lastSaveError, 'write-failed')
    assert.equal(app.runs.getState().activeSession?.session.status, 'paused')
    assert.equal(storedUpdatedAt(disk), updatedAt)
    disk.failWrites = false
    app.clock.now += HOUR
    app.controller.resume()
    assert.equal(app.persistence.getStatus().lastSaveError, null)
    assert.equal(storedUpdatedAt(disk), app.clock.now)
  })
  test('거리 샘플만 늘어나는 변경은 저장 간격을 둔다', () => {
    const disk = createDisk()
    const app = boot(disk, BASE)
    app.controller.prepare({ onUnavailable: () => undefined })
    app.controller.begin('gps')
    app.clock.now += 10_000
    app.moveTo(30)
    const afterFirst = disk.writes
    app.clock.now += 1_000
    app.moveTo(33)
    assert.equal(disk.writes, afterFirst)
    app.clock.now += SAMPLE_SAVE_MIN_INTERVAL_MS
    app.moveTo(40)
    assert.equal(disk.writes, afterFirst + 1)
  })
})

describe('명시적 재개', () => {
  test('복원만으로는 위치 수집이 시작되지 않고 시계도 흐르지 않는다', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    runGps(first, 2)
    const second = boot(disk, first.clock.now + 60_000)
    assert.equal(second.starts, 0)
    assert.equal(second.sourceRunning, false)
    const active = second.runs.getState().activeSession ?? null
    const at = (ms: number) => selectLiveMetrics(active, second.controller.live.getState().gps, second.clock.now + ms)
    assert.equal(at(0)?.elapsedMs, at(10 * 60_000)?.elapsedMs)
    assert.equal(at(0)?.currentPaceSecPerKm, null)
  })
  test('"계속 달리기"를 눌러야 같은 세션이 이어지고 그때 위치 수집이 시작된다', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    runGps(first, 2)
    const second = boot(disk, first.clock.now + 60_000)
    second.controller.resume()
    const active = second.runs.getState().activeSession
    assert.equal(active?.session.id, 'sess-1')
    assert.equal(active?.session.status, 'running')
    assert.equal(active?.mode, 'gps')
    assert.equal(second.starts, 1)
    assert.equal(second.sourceRunning, true)
  })
  test('GPS 누적 거리가 이어진다: 0으로 되돌아가지 않고 작은 값 샘플도 버려지지 않는다', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    runGps(first, 3)
    const before = lastDistance(first) ?? 0
    assert.ok(before > 59)

    const second = boot(disk, first.clock.now + 60_000)
    assert.equal(second.controller.live.getState().gps.metrics.distanceM, before)
    assert.equal(lastDistance(second), before)
    second.controller.resume()
    second.clock.now += 5_000
    second.moveTo(500) // 재개 후 첫 좌표: 새 구간의 시작점(끊긴 사이는 거리에 넣지 않는다)
    assert.equal(lastDistance(second), before)
    second.clock.now += 10_000
    second.moveTo(530)
    const after = lastDistance(second) ?? 0
    assert.ok(after > before, '재개 후 거리가 이어서 늘어난다')
    assert.ok(after < before + 40)
    // 모든 샘플은 단조 증가이고 복원 직후 값 이상이다.
    const samples = second.runs.getState().activeSession?.distanceSamples ?? []
    for (let index = 1; index < samples.length; index += 1) {
      assert.ok(samples[index].distanceM >= samples[index - 1].distanceM)
    }
  })
  test('TIME 모드는 재개해도 위치 수집을 시작하지 않는다(모드 불변)', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    first.controller.begin('time')
    const second = boot(disk, BASE + 1000)
    second.controller.resume()
    assert.equal(second.runs.getState().activeSession?.mode, 'time')
    assert.equal(second.starts, 0)
  })
  test('재개 후 위치 권한이 거부되면 TIME으로 바뀌지 않고 신호 손실 구간으로 남는다', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    runGps(first, 2)
    const second = boot(disk, first.clock.now + 60_000)
    second.controller.resume()
    second.clock.now += 1_000
    second.error('permission-denied')
    const active = second.runs.getState().activeSession
    assert.equal(active?.mode, 'gps')
    assert.equal(active?.session.status, 'running')
    assert.equal(active?.gpsGaps.at(-1)?.recoveredAtMs, null)
    const metrics = selectLiveMetrics(active ?? null, second.controller.live.getState().gps, second.clock.now)
    assert.equal(metrics?.currentPaceSecPerKm, null)
    assert.equal(metrics?.gpsSignal, 'unavailable')
  })
  test('재개 후 신호가 끊기면(권한 오류가 아닌 경우) 열린 손실 구간으로 남고 모드는 바뀌지 않는다', () => {
    const disk = createDisk()
    const first = boot(disk, BASE)
    runGps(first, 2)
    const second = boot(disk, first.clock.now + 60_000)
    second.controller.resume()
    second.clock.now += 1_000
    second.moveTo(200)
    second.clock.now += 60_000
    second.controller.heartbeat()
    assert.equal(second.runs.getState().activeSession?.gpsGaps.at(-1)?.recoveredAtMs, null)
    assert.equal(second.runs.getState().activeSession?.mode, 'gps')
  })
})

describe('저장 완료와 정리', () => {
  function finishedApp(disk: Disk, reason: 'user' | 'goal') {
    const app = boot(disk, BASE)
    runGps(app, 3)
    app.clock.now += 70_000
    app.controller.stop(reason)
    return app
  }

  test('저장 후 새로고침해도 결과를 다시 복원하지 않는다', () => {
    const disk = createDisk()
    const app = finishedApp(disk, 'user')
    app.results.getState().sync(app.runs.getState().activeSession?.session.id ?? null)
    assert.equal(app.results.getState().save(), true)
    assert.equal(disk.map.has(RUN_SESSION_KEYS.session), false)
    assert.equal(disk.map.has(RUN_SESSION_KEYS.reflection), false)
    const reloaded = boot(disk, app.clock.now + 1000)
    assert.equal(reloaded.runs.getState().activeSession, null)
    assert.equal(createRunStorage(kvOf(disk)).loadRecords().length, 1)
  })
  test('저장은 성공했지만 세션 키 삭제가 실패해도 다시 복원하지 않고 중복 기록도 없다', () => {
    const disk = createDisk()
    const app = finishedApp(disk, 'user')
    app.results.getState().sync('sess-1')
    disk.failRemoves = true
    assert.equal(app.results.getState().save(), true)
    assert.equal(app.persistence.getStatus().lastRemoveError, 'write-failed')
    assert.ok(disk.map.has(RUN_SESSION_KEYS.session), '삭제에 실패해 키가 남아 있다')

    disk.failRemoves = false
    const reloaded = boot(disk, app.clock.now + 1000)
    assert.equal(reloaded.persistence.getStatus().outcome, 'already-saved')
    assert.equal(reloaded.runs.getState().activeSession, null)
    assert.equal(disk.map.has(RUN_SESSION_KEYS.session), false)
    const records = createRunStorage(kvOf(disk)).loadRecords()
    assert.equal(records.length, 1)
    assert.equal(records[0]?.recordId, deriveRecordId('sess-1'))
  })
  test('삭제에 계속 실패해도 앱을 다시 열면 기록이 있는 세션은 복원되지 않는다', () => {
    const disk = createDisk()
    const app = finishedApp(disk, 'user')
    app.results.getState().sync('sess-1')
    disk.failRemoves = true
    app.results.getState().save()
    const reloaded = boot(disk, app.clock.now + 1000)
    assert.equal(reloaded.runs.getState().activeSession, null)
    assert.equal(reloaded.persistence.getStatus().lastRemoveError, 'write-failed')
  })
  test('저장하지 않고 종료(세션 폐기)하면 세션 키도 지워진다', () => {
    const disk = createDisk()
    const app = boot(disk, BASE)
    app.controller.begin('time')
    assert.ok(disk.map.has(RUN_SESSION_KEYS.session))
    app.runs.getState().clearSession()
    assert.equal(disk.map.has(RUN_SESSION_KEYS.session), false)
  })
  test('기록 저장에 실패하면 세션을 남겨 다시 복원·재시도할 수 있다', () => {
    const disk = createDisk()
    const app = finishedApp(disk, 'user')
    app.results.getState().sync('sess-1')
    disk.failWrites = true
    assert.equal(app.results.getState().save(), false)
    disk.failWrites = false
    assert.ok(disk.map.has(RUN_SESSION_KEYS.session))
    const reloaded = boot(disk, app.clock.now + 1000)
    assert.equal(reloaded.persistence.getStatus().outcome, 'restored')
    reloaded.results.getState().sync('sess-1')
    assert.equal(reloaded.results.getState().save(), true)
    assert.equal(createRunStorage(kvOf(disk)).loadRecords().length, 1)
  })
})

describe('종료 후 복원 위치(D12)', () => {
  test('목표 도달로 끝난 세션은 진행·종료 화면에서 도착 화면으로 복원된다', () => {
    const disk = createDisk()
    const app = boot(disk, BASE)
    runGps(app, 2)
    app.clock.now += 70_000
    app.controller.stop('goal')
    const reloaded = boot(disk, app.clock.now + 1000)
    const session = reloaded.runs.getState().activeSession?.session ?? null
    assert.equal(session?.status, 'finished')
    assert.equal(isArrivalPending(session), true)
    for (const path of [RUN_PATHS.active, RUN_PATHS.end]) {
      assert.equal(resolveRunRedirect(path, 0, 'finished', true, false), RUN_PATHS.arrival)
    }
    assert.equal(resolveRunRedirect(RUN_PATHS.arrival, 0, 'finished', true, false), null)
  })
  test('일반 종료 후 저장 전 세션은 결과 화면으로 복원된다', () => {
    const disk = createDisk()
    const app = boot(disk, BASE)
    runGps(app, 2)
    app.clock.now += 70_000
    app.controller.stop('user')
    const reloaded = boot(disk, app.clock.now + 1000)
    const session = reloaded.runs.getState().activeSession?.session ?? null
    assert.equal(isArrivalPending(session), false)
    assert.equal(resolveRunRedirect(RUN_PATHS.active, 0, 'finished', false, false), RUN_PATHS.result)
    assert.equal(resolveRunRedirect(RUN_PATHS.goal, 0, 'finished', false, false), RUN_PATHS.result)
  })
  test('결과에 반영한 회고는 복원하고, 시트에 입력만 하고 적용하지 않은 값은 복원하지 않는다', () => {
    const disk = createDisk()
    const app = boot(disk, BASE)
    runGps(app, 2)
    app.clock.now += 70_000
    app.controller.stop('user')
    app.results.getState().sync('sess-1')

    // 시트 입력만(적용 전)
    app.results.getState().openSheet()
    app.results.getState().setDraftDifficulty('hard')
    app.results.getState().setDraftMemo('입력만 함')
    const unapplied = boot(disk, app.clock.now + 1000)
    assert.deepEqual(unapplied.results.getState().applied, { difficulty: null, reasons: [], memo: '' })

    // 적용
    app.results.getState().applySheet()
    const applied = boot(disk, app.clock.now + 2000)
    assert.equal(applied.results.getState().sessionId, 'sess-1')
    assert.equal(applied.results.getState().applied.difficulty, 'hard')
    assert.equal(applied.results.getState().applied.memo, '입력만 함')
    // 결과 화면이 sync해도 같은 세션이면 회고를 지우지 않는다.
    applied.results.getState().sync('sess-1')
    assert.equal(applied.results.getState().applied.memo, '입력만 함')
  })
  test('다른 세션의 회고 키는 복원하지 않고 지운다', () => {
    const disk = createDisk()
    const app = boot(disk, BASE)
    runGps(app, 2)
    app.clock.now += 70_000
    app.controller.stop('user')
    disk.map.set(
      RUN_SESSION_KEYS.reflection,
      JSON.stringify({ version: 1, data: { sessionId: 'other', applied: { difficulty: 'hard', reasons: [], memo: '' } } }),
    )
    const reloaded = boot(disk, app.clock.now + 1000)
    assert.equal(reloaded.results.getState().applied.difficulty, null)
    assert.equal(disk.map.has(RUN_SESSION_KEYS.reflection), false)
  })
})

// ---- D13: 시간 복원 ---------------------------------------------------------
function elapsedAfterRestore(app: App, at: number): number | undefined {
  const session = app.runs.getState().activeSession?.session
  return session === undefined ? undefined : getRunElapsedMs(session, at)
}

function runTimeSession(disk: Disk, seconds: number) {
  const app = boot(disk, BASE)
  app.controller.begin('time')
  for (let tick = 1; tick <= seconds; tick += 1) {
    app.clock.now += 1000
    app.controller.tick()
  }
  return app
}

describe('시간 복원 (updatedAt = 마지막 세션 저장, 확인 시각은 별도)', () => {
  test('TIME 러닝 중 새로고침: 확인 시각까지만 경과 시간에 넣고 새로고침 동안은 넣지 않는다', () => {
    const disk = createDisk()
    const first = runTimeSession(disk, 40)
    const second = boot(disk, first.clock.now + 10 * 60_000)
    const elapsed = elapsedAfterRestore(second, second.clock.now) ?? 0
    assert.ok(elapsed >= 35_000 && elapsed <= 40_000, `elapsed=${elapsed}`)
    // 복원 뒤 시계가 더 흘러도 경과 시간은 늘지 않는다(일시정지 상태).
    assert.equal(elapsedAfterRestore(second, second.clock.now + HOUR), elapsed)
  })
  test('재개하면 일시정지 시각 이후만 더해진다(중복 계산 없음)', () => {
    const disk = createDisk()
    const first = runTimeSession(disk, 40)
    const second = boot(disk, first.clock.now + 10 * 60_000)
    const atPause = elapsedAfterRestore(second, second.clock.now) ?? 0
    second.controller.resume()
    second.clock.now += 7_000
    assert.equal(elapsedAfterRestore(second, second.clock.now), atPause + 7_000)
  })
  test('마지막 확인 시각이 없으면 마지막 세션 저장 시각을 쓴다', () => {
    const disk = createDisk()
    const first = runTimeSession(disk, 40)
    disk.map.delete(RUN_SESSION_KEYS.seen)
    const updatedAt = storedUpdatedAt(disk)
    const second = boot(disk, first.clock.now + 60_000)
    assert.equal(second.runs.getState().activeSession?.session.pauses[0]?.pausedAt, updatedAt)
  })
  test('확인 시각이 손상됐거나 다른 세션의 것이면 무시한다', () => {
    for (const raw of ['not-json', '{"version":9,"data":{}}', '{"version":1,"data":{"sessionId":"sess-1","at":"x"}}', '{"version":1,"data":{"sessionId":"other","at":99999999999999}}']) {
      const disk = createDisk()
      const first = runTimeSession(disk, 40)
      const updatedAt = storedUpdatedAt(disk)
      disk.map.set(RUN_SESSION_KEYS.seen, raw)
      const second = boot(disk, first.clock.now + 60_000)
      assert.equal(second.runs.getState().activeSession?.session.pauses[0]?.pausedAt, updatedAt, raw)
    }
  })
  test('미래 시각의 확인 시각은 무시해 경과 시간이 임의로 늘지 않는다', () => {
    const disk = createDisk()
    const first = runTimeSession(disk, 40)
    const updatedAt = storedUpdatedAt(disk)
    disk.map.set(RUN_SESSION_KEYS.seen, JSON.stringify({ version: 1, data: { sessionId: 'sess-1', at: first.clock.now + 5 * HOUR } }))
    const second = boot(disk, first.clock.now + 60_000)
    assert.equal(second.runs.getState().activeSession?.session.pauses[0]?.pausedAt, updatedAt)
  })
  test('확인 시각이 저장 시각보다 이르면 저장 시각을 쓴다(시간이 거꾸로 가지 않는다)', () => {
    const disk = createDisk()
    const first = runTimeSession(disk, 40)
    const updatedAt = storedUpdatedAt(disk)
    disk.map.set(RUN_SESSION_KEYS.seen, JSON.stringify({ version: 1, data: { sessionId: 'sess-1', at: updatedAt - 10_000 } }))
    const second = boot(disk, first.clock.now + 60_000)
    assert.equal(second.runs.getState().activeSession?.session.pauses[0]?.pausedAt, updatedAt)
  })
  test('일시정지 중 새로고침: 확인 시각이 있어도 러닝 시간이 늘지 않는다', () => {
    const disk = createDisk()
    const first = runTimeSession(disk, 20)
    first.controller.pause()
    const pausedElapsed = elapsedAfterRestore(first, first.clock.now) ?? 0
    // 일시정지 뒤 나중 시각의 확인 키가 남아 있어도 영향이 없다.
    disk.map.set(RUN_SESSION_KEYS.seen, JSON.stringify({ version: 1, data: { sessionId: 'sess-1', at: first.clock.now + HOUR } }))
    const second = boot(disk, first.clock.now + 2 * HOUR)
    assert.equal(second.runs.getState().activeSession?.session.status, 'paused')
    assert.equal(elapsedAfterRestore(second, second.clock.now + 3 * HOUR), pausedElapsed)
  })
  test('일시정지 중에는 시계가 흘러도 확인 시각을 쓰지 않는다', () => {
    const disk = createDisk()
    const app = runTimeSession(disk, 10)
    app.controller.pause()
    const before = disk.map.get(RUN_SESSION_KEYS.seen)
    for (let tick = 0; tick < 20; tick += 1) {
      app.clock.now += 10_000
      app.controller.tick()
    }
    assert.equal(disk.map.get(RUN_SESSION_KEYS.seen), before)
  })
  test('백그라운드 복귀: 복귀 시 시계가 갱신되면 그때까지의 시간이 경과 시간에 남는다', () => {
    const disk = createDisk()
    const app = runTimeSession(disk, 10)
    // 화면이 꺼진 10분 동안은 틱이 없다. 복귀하면 시계(tick)가 갱신된다.
    app.clock.now += 10 * 60_000
    app.controller.tick()
    const second = boot(disk, app.clock.now + 5_000)
    const elapsed = elapsedAfterRestore(second, second.clock.now) ?? 0
    assert.ok(elapsed >= 10 * 60_000 + 5_000 && elapsed <= 10 * 60_000 + 10_000, `elapsed=${elapsed}`)
  })
  test('확인 시각은 만료를 연장하지 않는다: 마지막 세션 저장이 24시간 지났으면 폐기한다', () => {
    const disk = createDisk()
    const first = runTimeSession(disk, 5)
    const updatedAt = storedUpdatedAt(disk)
    // 오래 실행 중이었다고 가정: 확인 시각만 최근이다.
    disk.map.set(RUN_SESSION_KEYS.seen, JSON.stringify({ version: 1, data: { sessionId: 'sess-1', at: updatedAt + SESSION_MAX_AGE_MS + 1000 } }))
    const second = boot(disk, updatedAt + SESSION_MAX_AGE_MS + 2000)
    assert.equal(second.persistence.getStatus().outcome, 'expired')
    assert.equal(first.persistence.getStatus().outcome, 'none')
    assert.equal(disk.map.has(RUN_SESSION_KEYS.seen), false, '만료되면 확인 시각 키도 지운다')
  })
  test('24시간 경계: 정확히 24시간이면 복원하고 1ms 넘으면 폐기한다(확인 시각과 무관)', () => {
    const disk = createDisk()
    runTimeSession(disk, 5)
    const updatedAt = storedUpdatedAt(disk)
    assert.equal(boot(disk, updatedAt + SESSION_MAX_AGE_MS).persistence.getStatus().outcome, 'restored')
    assert.equal(boot(disk, updatedAt + SESSION_MAX_AGE_MS + 1).persistence.getStatus().outcome, 'expired')
  })
  test('확인 시각을 쓰는 것은 세션 저장 시각(updatedAt)을 바꾸지 않는다', () => {
    const disk = createDisk()
    const app = runTimeSession(disk, 1)
    const updatedAt = storedUpdatedAt(disk)
    for (let tick = 0; tick < 30; tick += 1) {
      app.clock.now += 1000
      app.controller.tick()
    }
    assert.equal(storedUpdatedAt(disk), updatedAt)
    assert.ok(disk.map.has(RUN_SESSION_KEYS.seen))
  })
  test('확인 시각 키의 쓰기·읽기·삭제가 모두 실패해도 앱은 동작하고 저장 시각으로 복원한다', () => {
    const disk = createDisk()
    disk.failKeys.add(RUN_SESSION_KEYS.seen)
    const first = runTimeSession(disk, 40) // 확인 시각 쓰기 실패는 무시한다
    assert.equal(first.runs.getState().activeSession?.session.status, 'running')
    assert.equal(first.persistence.getStatus().lastSaveError, null, '확인 시각 실패는 세션 저장 오류로 보지 않는다')
    const updatedAt = storedUpdatedAt(disk)
    const second = boot(disk, first.clock.now + 60_000) // 읽기 실패 → 저장 시각 사용
    assert.equal(second.runs.getState().activeSession?.session.pauses[0]?.pausedAt, updatedAt)
    // 폐기 때 삭제가 실패해도 던지지 않는다.
    const expired = boot(disk, updatedAt + SESSION_MAX_AGE_MS + 1)
    assert.equal(expired.persistence.getStatus().outcome, 'expired')
  })
  test('세션 저장이 실패한 동안에는 updatedAt이 옛 값이고 그 값으로 만료·복원 시각이 정해진다', () => {
    const disk = createDisk()
    const app = runTimeSession(disk, 5)
    const updatedAt = storedUpdatedAt(disk)
    disk.failWrites = true
    app.clock.now += HOUR
    app.controller.pause() // 저장 실패
    disk.failWrites = false
    const second = boot(disk, app.clock.now + 1000)
    assert.equal(storedUpdatedAt(disk), updatedAt)
    assert.equal(second.runs.getState().activeSession?.session.status, 'paused')
  })
})
