import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { GpsSource, GpsSourceHandlers } from '../measurement/geolocationSource.ts'
import type { GpsErrorReason, RawFix } from '../measurement/types.ts'
import { formatRemainingKm2 } from './format.ts'
import { getRunSessionPhase, isArrivalPending, resolveGuardPhase, resolveRunRedirect, RUN_PATHS } from './runFlow.ts'
import { createRunLive, selectLiveMetrics } from './runLive.ts'
import type { GpsPermission } from './runLive.ts'
import { computeAvgPaceSecPerKm } from './runPace.ts'
import { createRunResultStore } from './runResultStore.ts'
import { summarizeRun } from './runResult.ts'
import { createRunSetupStore } from './runSetupStore.ts'
import { createRunStorage } from './runStorage.ts'
import type { RunKeyValueStorage } from './runStorage.ts'
import { createRunStore } from './runStore.ts'

// R3·R4·R5 리뷰 결함 수정의 회귀 테스트(자동 종료 화면 전환, 권한 지연, 저장 후 재시작).
// 가상 GPS 입력이다. 실기기 동작은 검증하지 않는다.

const BASE = 1_700_000_000_000
const M = 111_195 // 위도 1도 ≈ 111,195m

function memory(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial))
  let failWrites = false
  const kv: RunKeyValueStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error('QuotaExceededError')
      map.set(key, value)
    },
    removeItem: (key) => void map.delete(key),
  }
  return {
    map,
    kv,
    failWrites: (value: boolean) => {
      failWrites = value
    },
    writes: () => map.size,
  }
}

interface Harness {
  readonly mem: ReturnType<typeof memory>
  readonly storage: ReturnType<typeof createRunStorage>
  readonly store: ReturnType<typeof createRunStore>
  readonly controller: ReturnType<typeof createRunLive>
  readonly setup: ReturnType<typeof createRunSetupStore>
  readonly result: ReturnType<typeof createRunResultStore>
  readonly permissionChange: { fire: (state: GpsPermission) => void }
  readonly clock: { now: () => number; set: (value: number) => void; advance: (ms: number) => void }
  fix: (lat: number, lng: number) => void
  error: (reason: GpsErrorReason) => void
  stops: () => number
  sourceStarts: () => number
  sourceRunning: () => boolean
  metrics: () => ReturnType<typeof selectLiveMetrics>
  runMeters: (meters: number, stepM?: number) => void
}

interface HarnessOptions {
  readonly kv?: ReturnType<typeof memory>
  readonly permission?: () => Promise<GpsPermission>
}

function harness(options: HarnessOptions = {}): Harness {
  const mem = options.kv ?? memory()
  const storage = createRunStorage(mem.kv)
  let now = BASE
  const store = createRunStore(storage)
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
  let permissionOnChange: (state: GpsPermission) => void = () => undefined
  const controller = createRunLive({
    store,
    now: () => now,
    createSource: (h) => {
      handlers = h
      return source
    },
    createId: () => 'sess-1',
    listenVisible: () => () => undefined,
    queryPermission: (onChange) => {
      permissionOnChange = onChange
      return options.permission?.() ?? Promise.resolve('unknown')
    },
    autoHeartbeat: false,
  })
  const setup = createRunSetupStore()
  const result = createRunResultStore(store, storage, setup)
  let latM = 0
  const h: Harness = {
    mem,
    storage,
    store,
    controller,
    setup,
    result,
    permissionChange: { fire: (state) => permissionOnChange(state) },
    clock: { now: () => now, set: (value) => void (now = value), advance: (ms) => void (now += ms) },
    fix: (lat, lng) => {
      const raw: RawFix = { lat, lng, accuracyM: 5, deviceTime: now, receivedAt: now }
      handlers?.onFix(raw)
    },
    error: (reason) => handlers?.onError(reason),
    stops: () => 0,
    sourceStarts: () => starts,
    sourceRunning: () => running,
    metrics: () => selectLiveMetrics(store.getState().activeSession, controller.live.getState().gps, now),
    runMeters: (meters, stepM = 3) => {
      for (let done = 0; done <= meters; done += stepM) {
        latM += stepM
        h.fix(37 + latM / M, 127)
        h.clock.advance(1000)
        if (store.getState().activeSession?.session.status !== 'running') return
      }
    },
  }
  return h
}

// 1km 목표 GPS 러닝을 시작한다(준비 → 시작).
function startGps(h: Harness): void {
  h.store.getState().setDistance(1)
  h.controller.prepare({ onUnavailable: () => undefined })
  h.controller.begin('gps')
}

// 접근 가드가 정하는 목적지(RunFlowGuard와 같은 순수 규칙)
function guard(h: Harness, path: string): string | null {
  const session = h.store.getState().activeSession?.session ?? null
  const phase = getRunSessionPhase(session)
  return resolveRunRedirect(path, h.setup.getState().level, phase, isArrivalPending(session), h.result.getState().saved)
}

function readyLevel(h: Harness, mode: 'gps' | 'time'): void {
  const setup = h.setup.getState()
  setup.enterGoal()
  setup.confirmGoal()
  setup.confirmMusic()
  setup.signalStart(mode)
}

describe('목표 달성 자동 종료 → 도착 → 결과', () => {
  test('진행 화면에서 목표 거리에 도달하면 가드가 도착 화면으로 보내고, 도착·결과 화면은 열려 있다', () => {
    const h = harness()
    startGps(h)
    assert.equal(guard(h, RUN_PATHS.active), null)
    h.runMeters(1010)
    const session = h.store.getState().activeSession?.session
    assert.equal(session?.status, 'finished')
    assert.equal(session?.endReason, 'auto')
    assert.equal(guard(h, RUN_PATHS.active), RUN_PATHS.arrival) // 결과가 아니라 도착
    assert.equal(guard(h, RUN_PATHS.end), RUN_PATHS.arrival) // 종료 확인 화면에서 끝나도 같다
    assert.equal(guard(h, RUN_PATHS.arrival), null)
    assert.equal(guard(h, RUN_PATHS.result), null)
    assert.equal(guard(h, RUN_PATHS.resultDetails), null)
  })
  test('경합 없음: 화면 전환은 가드 한 곳의 규칙이라 같은 상태에서는 언제나 같은 목적지를 돌려준다', () => {
    const h = harness()
    startGps(h)
    h.runMeters(1010)
    const first = guard(h, RUN_PATHS.active)
    for (let i = 0; i < 5; i += 1) assert.equal(guard(h, RUN_PATHS.active), first)
    assert.equal(summarizeRun(h.store.getState().activeSession!)?.completion, 'goal')
  })
  test('수동 종료는 도착을 거치지 않고 결과로 간다', () => {
    const h = harness()
    startGps(h)
    h.runMeters(200)
    h.controller.stop('user')
    assert.equal(h.store.getState().activeSession?.session.endReason, 'user')
    assert.equal(guard(h, RUN_PATHS.end), RUN_PATHS.result)
    assert.equal(guard(h, RUN_PATHS.active), RUN_PATHS.result)
  })
  test('목표를 못 채운 자동 종료가 아니면 도착은 쓰이지 않는다(partial)', () => {
    const h = harness()
    startGps(h)
    h.runMeters(300)
    h.controller.stop('user')
    assert.equal(summarizeRun(h.store.getState().activeSession!)?.completion, 'partial')
  })
  test('자동 종료는 한 번만 일어난다: 종료 뒤에 좌표가 더 들어와도 종료 시각·거리는 바뀌지 않는다', () => {
    const h = harness()
    startGps(h)
    h.runMeters(1010)
    const ended = h.store.getState().activeSession
    assert.equal(ended?.session.status, 'finished')
    const endedAt = ended?.session.endedAt
    const samples = ended?.distanceSamples.length
    // 수집이 이미 멈췄더라도 늦게 도착한 좌표를 흉내 낸다(콜백이 아직 호출될 수 있다)
    for (let i = 0; i < 5; i += 1) {
      h.clock.advance(1000)
      h.fix(37 + 0.02 + i / M, 127)
    }
    h.controller.stop('user') // 중복 종료
    const after = h.store.getState().activeSession
    assert.equal(after?.session.endedAt, endedAt)
    assert.equal(after?.session.endReason, 'auto')
    assert.equal(after?.distanceSamples.length, samples)
    assert.equal(h.sourceRunning(), false)
  })
  test('마지막 샘플이 버려져도 자동 종료 세션은 완주로 분류된다(자동 종료와 partial의 불일치 없음)', () => {
    const h = harness()
    startGps(h)
    h.runMeters(1010)
    const snapshot = h.store.getState().activeSession!
    const trimmed = { ...snapshot, distanceSamples: snapshot.distanceSamples.slice(0, -3) }
    assert.equal(summarizeRun(trimmed)?.completion, 'goal')
  })
})

describe('위치 권한: 늦은 응답', () => {
  test('권한 프롬프트를 5초 넘게 기다린 뒤 거부하면 시작하지 않고 준비 화면으로 돌아간다', () => {
    const h = harness({ permission: () => Promise.resolve('prompt') })
    let unavailable = 0
    h.controller.prepare({ onUnavailable: () => void (unavailable += 1) })
    h.permissionChange.fire('prompt')
    assert.equal(h.controller.gpsStartState(), 'waiting') // 카운트다운이 끝나도 시작하지 않고 기다린다
    h.clock.advance(6000)
    assert.equal(h.controller.gpsStartState(), 'waiting')
    h.error('permission-denied') // 사용자가 거부
    assert.equal(unavailable, 1)
    assert.equal(h.store.getState().activeSession, null)
    assert.equal(h.sourceRunning(), false)
  })
  test('권한 상태가 prompt → denied로 바뀌어도(브라우저 변경 알림) 시작하지 않고 알린다', () => {
    const h = harness({ permission: () => Promise.resolve('prompt') })
    let unavailable = 0
    h.controller.prepare({ onUnavailable: () => void (unavailable += 1) })
    h.permissionChange.fire('denied')
    assert.equal(unavailable, 1)
    assert.equal(h.store.getState().activeSession, null)
  })
  test('허용되면(좌표 수신) 기다리지 않고 시작할 수 있다', () => {
    const h = harness({ permission: () => Promise.resolve('prompt') })
    h.controller.prepare({ onUnavailable: () => undefined })
    h.permissionChange.fire('prompt')
    assert.equal(h.controller.gpsStartState(), 'waiting')
    h.fix(37, 127)
    assert.equal(h.controller.gpsStartState(), 'ready')
    h.permissionChange.fire('granted')
    assert.equal(h.controller.gpsStartState(), 'ready')
  })
  test('권한을 확인할 수 없는 환경(unknown)이나 허용(granted)은 기다리지 않는다', () => {
    for (const state of ['unknown', 'granted'] as const) {
      const h = harness({ permission: () => Promise.resolve(state) })
      h.controller.prepare({ onUnavailable: () => undefined })
      h.permissionChange.fire(state)
      assert.equal(h.controller.gpsStartState(), 'ready')
    }
  })
  test('늦게 도착한 권한 응답은 취소된 준비나 이미 시작한 세션에 영향을 주지 않는다', () => {
    const h = harness()
    let unavailable = 0
    h.controller.prepare({ onUnavailable: () => void (unavailable += 1) })
    h.controller.cancelPrepare() // 화면을 벗어남
    h.permissionChange.fire('denied') // 옛 응답이 뒤늦게 도착
    assert.equal(unavailable, 0)
    assert.equal(h.store.getState().activeSession, null)

    const g = harness()
    g.controller.prepare({ onUnavailable: () => void (unavailable += 1) })
    g.controller.begin('gps') // 응답 없이 시작
    g.permissionChange.fire('denied')
    assert.equal(unavailable, 0)
    assert.equal(g.store.getState().activeSession?.mode, 'gps') // 세션·모드 유지(기존 계약)
  })
  test('TIME 모드는 위치 수집·권한 확인 없이 그대로 시작한다', () => {
    const h = harness({ permission: () => Promise.resolve('denied') })
    h.controller.begin('time')
    assert.equal(h.store.getState().activeSession?.mode, 'time')
    assert.equal(h.sourceStarts(), 0)
  })
})

describe('저장 후 상태·라우팅', () => {
  function finishAndSave(h: Harness, mode: 'gps' | 'time'): void {
    readyLevel(h, mode)
    if (mode === 'gps') startGps(h)
    else h.controller.begin('time')
    if (mode === 'gps') h.runMeters(1010)
    else {
      h.clock.advance(90_000)
      h.controller.stop('user')
    }
    assert.equal(h.result.getState().save(), true)
  }

  test('GPS 저장 직후에는 결과 화면으로 되돌리지 않는다(saved 동안 세션은 끝난 것으로 본다)', () => {
    const h = harness()
    finishAndSave(h, 'gps')
    assert.equal(h.store.getState().activeSession?.session.status, 'finished') // 정리는 아직(결과 흐름을 벗어난 뒤)
    assert.equal(guard(h, RUN_PATHS.goal), null) // "다음 목표"는 목표 화면: 결과로 되돌려지지 않는다
    // 저장 직후 결과 흐름 화면에 아직 머무는 동안 가드는 이동을 가로채지 않는다(저장 뒤 이동과 경합하지 않는다)
    assert.equal(guard(h, RUN_PATHS.result), null)
    assert.equal(guard(h, RUN_PATHS.arrival), null)
    assert.equal(resolveGuardPhase('finished', true), 'none') // 복귀 바는 끝난 세션으로 보지 않는다
  })
  test('GPS 저장 후 정리하면 /running/countdown 직접 접근은 목표 화면으로 보내고 새 러닝은 시작되지 않는다', () => {
    const h = harness()
    finishAndSave(h, 'gps')
    h.result.getState().finalize()
    assert.equal(h.store.getState().activeSession, null)
    assert.equal(h.setup.getState().level, 0)
    assert.equal(h.setup.getState().mode, null)
    assert.equal(guard(h, RUN_PATHS.countdown), RUN_PATHS.goal)
    assert.equal(guard(h, RUN_PATHS.ready), RUN_PATHS.goal)
    // 새 러닝 준비는 목표 화면부터 다시 한다
    h.setup.getState().enterGoal()
    assert.equal(guard(h, RUN_PATHS.countdown), RUN_PATHS.goal)
  })
  test('TIME 저장 후에도 같다', () => {
    const h = harness()
    finishAndSave(h, 'time')
    h.result.getState().finalize()
    assert.equal(h.store.getState().activeSession, null)
    assert.equal(guard(h, RUN_PATHS.countdown), RUN_PATHS.goal)
    const record = h.storage.loadRecords()[0]
    assert.equal(record.mode, 'time')
    assert.equal(record.result.distanceM, null)
    assert.equal(record.result.avgPaceSecPerKm, null)
  })
  test('저장 후 같은 환경에서 새 러닝을 시작하면 새 세션이고 이전 기록은 그대로다', () => {
    const h = harness()
    finishAndSave(h, 'time')
    h.result.getState().finalize()
    readyLevel(h, 'gps')
    startGps(h)
    assert.equal(h.store.getState().activeSession?.mode, 'gps')
    assert.equal(h.store.getState().activeSession?.session.status, 'running')
    assert.equal(h.storage.loadRecords().length, 1)
  })
  test('저장 실패: 결과·회고 입력·세션이 유지되고 재시도하면 한 건만 저장된다', () => {
    const h = harness()
    readyLevel(h, 'time')
    h.controller.begin('time')
    h.clock.advance(90_000)
    h.controller.stop('user')
    h.result.getState().sync('sess-1')
    h.result.getState().setDifficulty('moderate')
    h.mem.failWrites(true)
    assert.equal(h.result.getState().save(), false)
    assert.equal(h.result.getState().saveError, 'write-failed')
    assert.equal(h.result.getState().saved, false)
    assert.equal(h.result.getState().applied.difficulty, 'moderate') // 회고 유지
    assert.equal(h.store.getState().activeSession?.session.status, 'finished') // 세션 유지
    assert.equal(guard(h, RUN_PATHS.result), null) // 결과 화면에 머문다
    h.mem.failWrites(false)
    assert.equal(h.result.getState().save(), true)
    assert.equal(h.storage.loadRecords().length, 1)
    assert.equal(h.storage.loadRecords()[0].reflection?.difficulty, 'moderate')
  })
  test('중복 저장 방지: 저장을 두 번 눌러도 기록은 한 건이다', () => {
    const h = harness()
    finishAndSave(h, 'time')
    assert.equal(h.result.getState().save(), true)
    assert.equal(h.storage.loadRecords().length, 1)
  })
})

describe('GPS 일시정지·재개와 gap', () => {
  test('일시정지 중 받은 좌표는 거리에 넣지 않고, 재개 뒤 끊김 구간은 일시정지 시간 안에서 시작하지 않는다', () => {
    const h = harness()
    startGps(h)
    h.runMeters(60)
    const distance = h.metrics()?.distanceM ?? 0
    const elapsedAtPause = h.metrics()?.elapsedMs ?? 0
    h.controller.pause()
    for (let i = 0; i < 5; i += 1) {
      h.clock.advance(1000)
      h.fix(37 + 0.01 + i / M, 127)
    }
    assert.equal(h.metrics()?.distanceM, distance)
    h.clock.advance(60_000) // 신호 없이 오래 쉼
    h.controller.resume()
    h.clock.advance(20_000) // 재개 뒤에도 좌표가 안 들어옴
    h.controller.tick()
    const gaps = h.store.getState().activeSession?.gpsGaps ?? []
    assert.equal(gaps.length, 1)
    assert.ok(gaps[0].lostAtMs >= elapsedAtPause, `gap 시작 ${gaps[0].lostAtMs} ≥ 일시정지 시점 ${elapsedAtPause}`)
    h.fix(37 + 0.02, 127)
    assert.notEqual(h.store.getState().activeSession?.gpsGaps[0].recoveredAtMs, null)
  })
  test('일시정지·재개는 같은 세션을 유지한다', () => {
    const h = harness()
    startGps(h)
    h.clock.advance(10_000)
    h.controller.pause()
    assert.equal(h.store.getState().activeSession?.session.id, 'sess-1')
  })
})

describe('표시 기준', () => {
  test('남은 거리는 올림이다: 4m가 남았으면 0.00이 아니라 0.01', () => {
    assert.equal(formatRemainingKm2(4), '0.01')
    assert.equal(formatRemainingKm2(0), '0.00')
    assert.equal(formatRemainingKm2(10), '0.01')
    assert.equal(formatRemainingKm2(1000), '1.00')
    assert.equal(formatRemainingKm2(Number.NaN), '0.00')
  })
  test('진행 화면과 결과의 평균 페이스는 같은 기준(러닝 시간 ÷ 거리)이다', () => {
    const h = harness()
    startGps(h)
    h.runMeters(1010)
    const live = h.metrics()
    const summary = summarizeRun(h.store.getState().activeSession!)
    assert.equal(live?.avgPaceSecPerKm, summary?.avgPaceSecPerKm)
    assert.equal(computeAvgPaceSecPerKm(0, 1000), null)
    assert.equal(computeAvgPaceSecPerKm(60_000, 5), null)
  })
})

describe('360px 레이아웃 가드(정적 확인)', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  test('결과·회고의 칩과 요약 칸은 고정 폭 대신 남는 폭을 나눠 쓴다', () => {
    const shared = read('../../pages/running/ResultShared.tsx')
    assert.ok(!shared.includes('w-[106px]'))
    assert.ok(!shared.includes('w-[76.5px]'))
    const result = read('../../pages/running/ResultPage.tsx')
    assert.ok(!result.includes('flex w-[106px]'))
    const active = read('../../pages/running/ActivePage.tsx')
    assert.ok(!active.includes('"w-[161px]"'))
  })
  test('회고 시트는 뒤 화면을 inert로 만들고 포커스를 가둔다', () => {
    const shared = read('../../pages/running/ResultShared.tsx')
    assert.ok(shared.includes("setAttribute('inert'"))
    assert.ok(shared.includes("event.key !== 'Tab'"))
    assert.ok(shared.includes('opener.focus()'))
  })
  test('카운트다운은 assertive 라이브 영역과 정적 aria-label을 쓰지 않는다', () => {
    const countdown = read('../../pages/running/CountdownPage.tsx')
    assert.ok(!countdown.includes('assertive'))
    assert.ok(!countdown.includes('초 후 시작'))
  })
})

describe('#48 신호 손실·복구 통합 시나리오(가상 GPS)', () => {
  test('시작 직후 위치를 쓸 수 없게 되면 끊김으로 남고, 페이스는 없으며 모드는 GPS로 유지되고, 좌표가 돌아오면 이어서 쌓인다', () => {
    const h = harness()
    startGps(h)
    h.error('permission-denied')
    const gaps = h.store.getState().activeSession?.gpsGaps ?? []
    assert.equal(gaps.length, 1)
    assert.equal(gaps[0].recoveredAtMs, null)
    assert.equal(h.metrics()?.currentPaceSecPerKm ?? null, null)
    assert.equal(h.store.getState().activeSession?.mode, 'gps')
    assert.equal(h.store.getState().activeSession?.session.status, 'running')
    h.runMeters(30)
    assert.notEqual(h.store.getState().activeSession?.gpsGaps[0].recoveredAtMs, null)
    assert.ok((h.metrics()?.distanceM ?? 0) > 0, '복구 뒤 유효 거리가 쌓인다')
  })
  test('목표 직전에 끊겼다 복구되어도 유효 거리로 한 번만 완주하고, 끊김 구간이 기록에 저장된다', () => {
    const h = harness()
    readyLevel(h, 'gps')
    startGps(h)
    h.runMeters(950)
    const beforeLoss = h.metrics()?.distanceM ?? 0
    assert.equal(h.store.getState().activeSession?.session.status, 'running')
    h.clock.advance(30_000)
    h.controller.tick()
    assert.equal(h.metrics()?.distanceM, beforeLoss) // 끊긴 동안 거리는 늘지 않는다
    assert.equal(h.store.getState().activeSession?.gpsGaps.length, 1)
    h.runMeters(120)
    const session = h.store.getState().activeSession?.session
    assert.equal(session?.status, 'finished')
    assert.equal(session?.endReason, 'auto')
    assert.ok((h.metrics()?.distanceM ?? 0) >= 1000)
    assert.equal(h.result.getState().save(), true)
    const record = h.storage.loadRecords()[0]
    assert.equal(record.result.completion, 'goal')
    assert.equal(record.result.gpsGaps.length, 1)
    assert.notEqual(record.result.gpsGaps[0].recoveredAtMs, null)
  })
})

describe('#48 저장소·기초 측정 격리', () => {
  const MEASUREMENT_KEY = 'pacebeat:measurement:v1'
  test('러닝 전 과정(시작 → 일시정지 → 완주 → 저장)이 기초 측정 저장 키를 읽거나 바꾸지 않고 러닝 키만 쓴다', () => {
    const mem = memory({ [MEASUREMENT_KEY]: 'measurement-data' })
    const touched: string[] = []
    const { getItem, setItem } = mem.kv
    mem.kv.getItem = (key) => (touched.push(key), getItem(key))
    mem.kv.setItem = (key, value) => (touched.push(key), setItem(key, value))
    const h = harness({ kv: mem })
    readyLevel(h, 'gps')
    startGps(h)
    h.runMeters(300)
    h.controller.pause()
    h.clock.advance(5000)
    h.controller.resume()
    h.runMeters(800)
    assert.equal(h.result.getState().save(), true)
    assert.equal(mem.map.get(MEASUREMENT_KEY), 'measurement-data')
    assert.ok(touched.some((key) => key.startsWith('pacebeat:run:')), '러닝 키 접근이 가로채여야 한다')
    assert.ok(!touched.includes(MEASUREMENT_KEY))
    for (const key of mem.map.keys()) assert.ok(key === MEASUREMENT_KEY || key.startsWith('pacebeat:run:'), key)
  })
  test('저장소를 쓸 수 없는 환경에서도 러닝은 끝까지 진행되고, 저장만 unavailable로 실패한다', () => {
    const storage = createRunStorage(null)
    const store = createRunStore(storage)
    let now = BASE
    const source: GpsSource = { start: () => undefined, stop: () => undefined, isRunning: false }
    const controller = createRunLive({
      store,
      now: () => now,
      createSource: () => source,
      createId: () => 'sess-1',
      listenVisible: () => () => undefined,
      queryPermission: () => Promise.resolve('unknown'),
      autoHeartbeat: false,
    })
    const setup = createRunSetupStore()
    const result = createRunResultStore(store, storage, setup)
    controller.begin('time')
    now += 90_000
    controller.pause()
    now += 1000
    controller.resume()
    now += 1000
    controller.stop('user')
    assert.equal(store.getState().activeSession?.session.status, 'finished')
    assert.equal(result.getState().save(), false)
    assert.equal(result.getState().saveError, 'unavailable')
  })
  test('손상된 러닝 저장값은 읽을 때 무시하고 기본값으로 시작한다', () => {
    const mem = memory({ 'pacebeat:run:draft:v1': '{broken', 'pacebeat:run:records:v1': '###' })
    const store = createRunStore(createRunStorage(mem.kv))
    assert.equal(store.getState().draft.distanceKm, 3)
    assert.deepEqual(createRunStorage(mem.kv).loadRecords(), [])
  })
})
