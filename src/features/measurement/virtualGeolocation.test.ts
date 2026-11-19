import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { createGeolocationSource, toRawFix } from './geolocationSource.ts'
import type { PositionLike } from './geolocationSource.ts'
import { applyGpsError, createGpsTracker, getGpsStatus, processFix } from './gpsTracker.ts'
import { addFix, createMetrics, getMetrics } from './metrics.ts'
import { startSession } from './session.ts'
import type { GpsErrorReason, RawFix, RejectReason } from './types.ts'
import { createVirtualGeolocation } from './virtualGeolocation.ts'
import type { VirtualClock } from './virtualGeolocation.ts'
import { generateVirtualRun } from './virtualRun.ts'
import type { VirtualFixEvent, VirtualScenario } from './virtualRun.ts'
import { VIRTUAL_SCENARIOS } from './virtualScenarios.ts'
import type { VirtualScenarioId } from './virtualScenarios.ts'

const BASE = 1_700_000_000_000
const START = { lat: 37.5665, lng: 126.978 }

function assertClose(actual: number | null, expected: number, tolerance = 0.05) {
  assert.ok(actual !== null, `값이 null이다 (기대값 ${expected})`)
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual}은(는) ${expected}에서 ±${tolerance} 안에 있어야 함`,
  )
}

// 실제 시간을 기다리지 않는 수동 시계. advance로 시간을 진행하면 그 사이에 예약된 콜백이 시간순으로 실행된다.
class ManualClock implements VirtualClock {
  private current: number
  private nextTaskId = 1
  private queue: { id: number; at: number; callback: () => void }[] = []

  constructor(start: number) {
    this.current = start
  }

  now(): number {
    return this.current
  }

  schedule(callback: () => void, delayMs: number): () => void {
    const task = { id: this.nextTaskId, at: this.current + Math.max(0, delayMs), callback }
    this.nextTaskId += 1
    this.queue.push(task)
    return () => {
      this.queue = this.queue.filter((queued) => queued !== task)
    }
  }

  get pending(): number {
    return this.queue.length
  }

  // ms만큼 진행하면서, 각 예약은 자기 시각에 실행한다. (callback이 예외를 던지면 그대로 전파한다.)
  advance(ms: number): void {
    const target = this.current + ms
    this.runDue(target, true)
    this.current = target
  }

  // 시계가 한 번에 ms만큼 건너뛴 뒤에야 예약을 처리한다. (백그라운드 탭에서 타이머가 늦게 실행되는 상황)
  jump(ms: number): void {
    this.current += ms
    this.runDue(this.current, false)
  }

  private runDue(limit: number, moveClock: boolean): void {
    for (;;) {
      const due = this.queue
        .filter((task) => task.at <= limit)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (due === undefined) return
      this.queue = this.queue.filter((task) => task !== due)
      if (moveClock) this.current = Math.max(this.current, due.at)
      due.callback()
    }
  }
}

const walk3: VirtualScenario = { motion: [{ kind: 'move', durationSec: 3, speedMps: 3 }] }

function collect(geo: ReturnType<typeof createVirtualGeolocation>) {
  const positions: PositionLike[] = []
  const errors: number[] = []
  const id = geo.watchPosition(
    (position) => positions.push(position),
    (error) => errors.push(error.code),
  )
  return { id, positions, errors }
}

describe('가상 위치 제공자 (시간 구동)', () => {
  test('감시를 시작하기 전에는 아무것도 보내지 않고 예약도 없다', () => {
    const clock = new ManualClock(BASE)
    createVirtualGeolocation(walk3, clock)
    clock.advance(100_000)
    assert.equal(clock.pending, 0)
  })

  test('watchPosition은 1부터 늘어나는 id를 돌려준다', () => {
    const geo = createVirtualGeolocation(walk3, new ManualClock(BASE))
    assert.equal(collect(geo).id, 1)
    assert.equal(collect(geo).id, 2)
  })

  test('콜백은 watchPosition이 돌아온 뒤 비동기로만 호출된다 (시간을 진행하기 전에는 없음)', () => {
    const clock = new ManualClock(BASE)
    const { positions } = collect(createVirtualGeolocation(walk3, clock))
    assert.equal(positions.length, 0)
    clock.advance(0)
    assert.equal(positions.length, 1)
  })

  test('정해진 시각에 정확히 전달한다 (0초, 1초, 2초, 3초)', () => {
    const clock = new ManualClock(BASE)
    const { positions } = collect(createVirtualGeolocation(walk3, clock))
    clock.advance(0)
    assert.equal(positions.length, 1)
    clock.advance(999)
    assert.equal(positions.length, 1)
    clock.advance(1)
    assert.equal(positions.length, 2)
    clock.advance(2000)
    assert.equal(positions.length, 4)
  })

  test('기기 시각은 감시를 시작한 시각 + 사건 시각이다', () => {
    const clock = new ManualClock(BASE)
    clock.advance(5000)
    const { positions } = collect(createVirtualGeolocation(walk3, clock))
    clock.advance(3000)
    assert.deepEqual(
      positions.map((position) => position.timestamp),
      [BASE + 5000, BASE + 6000, BASE + 7000, BASE + 8000],
    )
  })

  test('수신 지연이 있으면 기기 시각은 그대로이고 도착만 늦어진다', () => {
    const clock = new ManualClock(BASE)
    const geo = createVirtualGeolocation({ ...walk3, deliveryLagMs: 400 }, clock)
    const received: number[] = []
    const { positions } = (() => {
      const positions: PositionLike[] = []
      geo.watchPosition(
        (position) => {
          positions.push(position)
          received.push(clock.now())
        },
        () => {},
      )
      return { positions }
    })()
    clock.advance(399)
    assert.equal(positions.length, 0)
    clock.advance(1)
    assert.equal(positions[0].timestamp, BASE)
    assert.equal(received[0], BASE + 400)
  })

  test('좌표 값은 시나리오 생성기의 결과와 같다', () => {
    const clock = new ManualClock(BASE)
    const { positions } = collect(createVirtualGeolocation(walk3, clock))
    clock.advance(3000)
    const expected = generateVirtualRun(walk3).filter((event): event is VirtualFixEvent => event.kind === 'fix')
    assert.deepEqual(
      positions.map((position) => position.coords),
      expected.map((fix) => ({ latitude: fix.lat, longitude: fix.lng, accuracy: fix.accuracyM })),
    )
  })

  test('오류 사건은 onError로 전달하고, 같은 시각에는 좌표가 먼저이다', () => {
    const clock = new ManualClock(BASE)
    const order: string[] = []
    const geo = createVirtualGeolocation(
      { motion: [{ kind: 'move', durationSec: 3, speedMps: 3 }], conditions: [{ kind: 'error', atSec: 1, code: 1 }] },
      clock,
    )
    geo.watchPosition(
      () => order.push('fix'),
      (error) => order.push(`error${error.code}`),
    )
    clock.advance(1000)
    assert.deepEqual(order, ['fix', 'fix', 'error1'])
  })

  test('시나리오가 끝나면 더 이상 보내지 않고 예약도 남기지 않는다', () => {
    const clock = new ManualClock(BASE)
    const { positions } = collect(createVirtualGeolocation(walk3, clock))
    clock.advance(60_000)
    assert.equal(positions.length, 4)
    assert.equal(clock.pending, 0)
  })

  test('clearWatch 뒤에는 전달하지 않고 예약을 취소한다', () => {
    const clock = new ManualClock(BASE)
    const geo = createVirtualGeolocation(walk3, clock)
    const { id, positions } = collect(geo)
    clock.advance(1000)
    geo.clearWatch(id)
    assert.equal(clock.pending, 0)
    clock.advance(10_000)
    assert.equal(positions.length, 2)
  })

  test('알 수 없는 id나 이미 해제한 id의 clearWatch는 아무 일도 하지 않는다', () => {
    const geo = createVirtualGeolocation(walk3, new ManualClock(BASE))
    const { id } = collect(geo)
    assert.doesNotThrow(() => geo.clearWatch(999))
    geo.clearWatch(id)
    assert.doesNotThrow(() => geo.clearWatch(id))
  })

  test('콜백 안에서 clearWatch를 불러도 그 뒤 사건은 전달하지 않는다', () => {
    const clock = new ManualClock(BASE)
    const geo = createVirtualGeolocation(walk3, clock)
    const positions: PositionLike[] = []
    const id: number = geo.watchPosition(
      (position) => {
        positions.push(position)
        geo.clearWatch(id)
      },
      () => {},
    )
    clock.jump(10_000) // 한꺼번에 밀려도 첫 사건 뒤에 멈춘다
    assert.equal(positions.length, 1)
    assert.equal(clock.pending, 0)
  })

  test('감시는 서로 독립이고 각자 시나리오를 처음부터 시작한다', () => {
    const clock = new ManualClock(BASE)
    const geo = createVirtualGeolocation(walk3, clock)
    const first = collect(geo)
    clock.advance(2000)
    const second = collect(geo)
    clock.advance(1000)
    assert.equal(first.positions.length, 4)
    assert.deepEqual(
      second.positions.map((position) => position.timestamp),
      [BASE + 2000, BASE + 3000],
    )
    geo.clearWatch(first.id)
    clock.advance(5000)
    assert.equal(first.positions.length, 4)
    assert.equal(second.positions.length, 4)
  })

  test('타이머가 늦게 실행돼 여러 사건이 밀려도 순서대로 전달한다', () => {
    const clock = new ManualClock(BASE)
    const geo = createVirtualGeolocation(walk3, clock)
    const received: number[] = []
    const positions: PositionLike[] = []
    geo.watchPosition(
      (position) => {
        positions.push(position)
        received.push(clock.now())
      },
      () => {},
    )
    clock.jump(3000)
    assert.deepEqual(
      positions.map((position) => position.timestamp - BASE),
      [0, 1000, 2000, 3000],
    )
    assert.ok(received.every((time) => time === BASE + 3000))
  })

  test('콜백이 예외를 던져도 예외는 삼키지 않고, 이후 사건은 이어서 전달한다', () => {
    const clock = new ManualClock(BASE)
    const geo = createVirtualGeolocation(walk3, clock)
    let count = 0
    geo.watchPosition(
      () => {
        count += 1
        if (count === 1) throw new Error('boom')
      },
      () => {},
    )
    assert.throws(() => clock.advance(0), /boom/)
    clock.advance(3000)
    assert.equal(count, 4)
  })

  test('잘못된 시나리오는 만들 때 RangeError로 거부한다', () => {
    assert.throws(() => createVirtualGeolocation({ motion: [{ kind: 'stop', durationSec: -1 }] }), RangeError)
  })

  test('기본 시계(실제 시간)로도 전달하고 clearWatch로 멈춘다', async () => {
    const geo = createVirtualGeolocation({ motion: [{ kind: 'move', durationSec: 0.05, speedMps: 3 }], intervalMs: 20 })
    const { id, positions } = collect(geo)
    await sleep(150)
    assert.equal(positions.length, 3) // 0, 20, 40ms
    geo.clearWatch(id)
    await sleep(50)
    assert.equal(positions.length, 3)
  })
})

// ---------------------------------------------------------------------------
// 끝에서 끝까지: 가상 위치 → createGeolocationSource → gpsTracker → metrics
// 실제 GPS와 같은 코드를 지나는지 확인한다. (가상 제공자만 실제 브라우저 위치 대신 꽂혀 있다.)
// ---------------------------------------------------------------------------

function createRig(scenario: VirtualScenario) {
  const clock = new ManualClock(BASE)
  const geolocation = createVirtualGeolocation(scenario, clock)
  const session = startSession(null, BASE, () => 'virtual-session')
  let tracker = createGpsTracker()
  let metrics = createMetrics()
  const raws: RawFix[] = []
  const rejected: RejectReason[] = []
  const errors: GpsErrorReason[] = []
  const source = createGeolocationSource(
    {
      onFix: (fix) => {
        raws.push(fix)
        const processed = processFix(tracker, fix)
        tracker = processed.state
        if (processed.result.accepted) {
          metrics = addFix(metrics, processed.result.fix, session)
        } else {
          rejected.push(processed.result.reason)
        }
      },
      onError: (reason) => {
        errors.push(reason)
        tracker = applyGpsError(tracker, reason)
      },
    },
    { env: () => ({ isSecureContext: true, geolocation }), now: () => clock.now() },
  )
  return {
    clock,
    source,
    raws,
    rejected,
    errors,
    run: (seconds: number) => clock.advance(seconds * 1000),
    get metricsState() {
      return metrics
    },
    summary: () => getMetrics(metrics, session, clock.now()),
    gps: () => getGpsStatus(tracker, clock.now()),
  }
}

describe('끝에서 끝까지: 직진과 정지', () => {
  test('3m/s로 30초: 거리 90m, 유효 시간 30초, 평균·현재 페이스 333초/km', () => {
    const rig = createRig({ motion: [{ kind: 'move', durationSec: 30, speedMps: 3 }] })
    rig.source.start()
    rig.run(30)
    const metrics = rig.summary()
    assert.equal(rig.raws.length, 31)
    assertClose(metrics.distanceM, 90)
    assert.equal(metrics.validMs, 30_000)
    assert.equal(metrics.unmeasuredMs, 0)
    assert.equal(metrics.avgPaceSecPerKm, 333)
    assert.equal(metrics.currentPaceSecPerKm, 333)
    assert.equal(rig.gps(), 'good')
    assert.deepEqual(rig.rejected, [])
  })

  test('실제 경로와 같게 RawFix의 기기 시각과 수신 시각이 구분되어 들어온다', () => {
    const rig = createRig({ motion: [{ kind: 'move', durationSec: 2, speedMps: 3 }], deliveryLagMs: 300 })
    rig.source.start()
    rig.run(3)
    assert.deepEqual(
      rig.raws.map((fix) => [fix.deviceTime - BASE, fix.receivedAt - BASE]),
      [
        [0, 300],
        [1000, 1300],
        [2000, 2300],
      ],
    )
  })

  test('20초 달린 뒤 20초 정지: 거리는 늘지 않고 현재 속도 0, 페이스 null', () => {
    const rig = createRig({
      motion: [
        { kind: 'move', durationSec: 20, speedMps: 3 },
        { kind: 'stop', durationSec: 20 },
      ],
    })
    rig.source.start()
    rig.run(40)
    const metrics = rig.summary()
    assertClose(metrics.distanceM, 60)
    assert.equal(metrics.validMs, 40_000)
    assertClose(metrics.avgSpeedMps, 1.5)
    assert.equal(metrics.currentSpeedMps, 0)
    assert.equal(metrics.currentPaceSecPerKm, null)
  })

  test('정지 중 좌표 흔들림은 거리로 쌓인다 (단순 합산의 알려진 한계. 발표용 시나리오는 흔들림 0)', () => {
    const rig = createRig({ motion: [{ kind: 'stop', durationSec: 60 }], noiseM: 5, seed: 1 })
    rig.source.start()
    rig.run(60)
    assert.ok(rig.summary().distanceM > 50, `거리 ${rig.summary().distanceM}`)
  })
})

describe('끝에서 끝까지: GPS 끊김과 복구', () => {
  const lossRun: VirtualScenario = {
    motion: [{ kind: 'move', durationSec: 60, speedMps: 3 }],
    conditions: [{ kind: 'gps-lost', fromSec: 20, toSec: 35 }],
  }

  test('마지막 좌표(19초) 후 10초까지는 good, 그 뒤에는 lost이고 현재 페이스는 null이다', () => {
    const rig = createRig(lossRun)
    rig.source.start()
    rig.run(29)
    assert.equal(rig.gps(), 'good')
    assert.equal(rig.summary().currentPaceSecPerKm, 333)
    rig.run(1)
    assert.equal(rig.gps(), 'lost')
    assert.equal(rig.summary().currentPaceSecPerKm, null)
    assertClose(rig.summary().distanceM, 57) // 끊겨도 이미 측정한 거리는 유지
  })

  test('복구되면 새 구간이라 끊긴 동안 이동한 먼 거리는 더해지지 않는다', () => {
    const rig = createRig(lossRun)
    rig.source.start()
    rig.run(60)
    const metrics = rig.summary()
    assertClose(metrics.distanceM, 57 + 75) // 0~19초 57m + 35~60초 75m (끊긴 16초 구간 제외)
    assert.equal(metrics.validMs, 19_000 + 25_000)
    assert.equal(metrics.unmeasuredMs, 16_000)
    assert.equal(rig.gps(), 'good')
    assert.equal(metrics.avgPaceSecPerKm, 333)
  })

  test('복구 직후에는 새 구간에 5초가 쌓이기 전까지 현재 페이스가 null이다', () => {
    const rig = createRig(lossRun)
    rig.source.start()
    rig.run(38) // 35초에 복구, 3초분
    assert.equal(rig.summary().currentPaceSecPerKm, null)
    rig.run(2) // 40초: 5초분
    assert.equal(rig.summary().currentPaceSecPerKm, 333)
  })

  test('끊김과 함께 오류(코드 2)를 보내도 감시는 유지되고 이후 좌표가 이어진다', () => {
    const rig = createRig({ ...lossRun, conditions: [{ kind: 'gps-lost', fromSec: 20, toSec: 35, emitError: true }] })
    rig.source.start()
    rig.run(60)
    assert.deepEqual(rig.errors, ['position-unavailable'])
    assert.equal(rig.source.isRunning, true)
    assert.equal(rig.gps(), 'good')
  })
})

describe('끝에서 끝까지: 잘못된 좌표', () => {
  test('1~2초 튐은 걸러지고 거리에 섞이지 않는다', () => {
    const rig = createRig({
      motion: [{ kind: 'move', durationSec: 30, speedMps: 3 }],
      conditions: [{ kind: 'glitch', fromSec: 10, toSec: 12, offsetM: 800 }],
    })
    rig.source.start()
    rig.run(30)
    assert.deepEqual(rig.rejected, ['jump', 'jump'])
    assertClose(rig.summary().distanceM, 90)
  })

  test('5초 튐은 재앵커되어도 먼 거리가 더해지지 않는다 (뛴 거리는 800m가 아님)', () => {
    const rig = createRig({
      motion: [{ kind: 'move', durationSec: 30, speedMps: 3 }],
      conditions: [{ kind: 'glitch', fromSec: 10, toSec: 15, offsetM: 800 }],
    })
    rig.source.start()
    rig.run(30)
    assert.equal(rig.rejected.length, 6)
    assert.ok(rig.rejected.every((reason) => reason === 'jump'))
    const distance = rig.summary().distanceM
    assert.ok(distance > 0 && distance < 100, `거리 ${distance}`)
  })

  test('정확도가 나쁜 좌표는 검증에서 버려지고 거리에 섞이지 않는다', () => {
    const rig = createRig({
      motion: [{ kind: 'move', durationSec: 30, speedMps: 3 }],
      conditions: [{ kind: 'poor-accuracy', fromSec: 10, toSec: 13, accuracyM: 90 }],
    })
    rig.source.start()
    rig.run(30)
    assert.deepEqual(rig.rejected, ['poor-accuracy', 'poor-accuracy', 'poor-accuracy'])
    assertClose(rig.summary().distanceM, 90)
  })

  test('백그라운드 탭처럼 타이머가 한꺼번에 밀려오면 오래된 좌표는 검증에서 버려진다', () => {
    const rig = createRig({ motion: [{ kind: 'move', durationSec: 30, speedMps: 3 }] })
    rig.source.start()
    rig.clock.jump(30_000)
    assert.equal(rig.raws.length, 31)
    assert.equal(rig.rejected.length, 20) // 기기 시각이 10초보다 오래된 0~19초
    assert.ok(rig.rejected.every((reason) => reason === 'stale'))
  })

  test('한꺼번에 밀려온 좌표는 수신 시각이 모두 같아서 지표에는 첫 좌표만 반영된다 (알려진 한계)', () => {
    // 10초 이내로 오래되지 않은 20~30초 좌표 11개가 같은 순간(30초)에 도착한다.
    // 지표는 수신 시각(세션 시간축) 기준이라 같은 시각의 좌표는 거리·시간을 더하지 않는다.
    const rig = createRig({ motion: [{ kind: 'move', durationSec: 30, speedMps: 3 }] })
    rig.source.start()
    rig.clock.jump(30_000)
    const metrics = rig.summary()
    assert.equal(metrics.distanceM, 0)
    assert.equal(metrics.validMs, 0)
    assert.equal(rig.gps(), 'good') // 좌표는 받아들여졌으므로 신호 상태는 정상
  })
})

describe('끝에서 끝까지: 오류와 중지·재시작', () => {
  test('권한 거부 오류가 오면 소스가 정리되고 GPS 상태는 unavailable이며 이후 좌표는 오지 않는다', () => {
    const rig = createRig({
      motion: [{ kind: 'move', durationSec: 10, speedMps: 3 }],
      conditions: [{ kind: 'error', atSec: 0, code: 1 }],
    })
    rig.source.start()
    rig.run(10)
    assert.deepEqual(rig.errors, ['permission-denied'])
    assert.equal(rig.raws.length, 1)
    assert.equal(rig.source.isRunning, false)
    assert.equal(rig.gps(), 'unavailable')
    assert.equal(rig.clock.pending, 0)
  })

  test('중지하면 좌표가 오지 않고, 다시 시작하면 시나리오가 처음부터 다시 시작한다', () => {
    const rig = createRig({ motion: [{ kind: 'move', durationSec: 30, speedMps: 3 }] })
    rig.source.start()
    rig.run(5)
    assert.equal(rig.raws.length, 6)
    rig.source.stop()
    assert.equal(rig.clock.pending, 0)
    rig.run(10)
    assert.equal(rig.raws.length, 6)

    rig.source.start()
    rig.run(2)
    assert.equal(rig.raws.length, 9)
    assert.equal(rig.raws[6].lat, START.lat) // 처음부터
    assert.equal(rig.raws[6].deviceTime, BASE + 15_000)
  })
})

describe('발표용 시나리오 프리셋', () => {
  function runPreset(id: VirtualScenarioId, seconds: number) {
    const rig = createRig(VIRTUAL_SCENARIOS[id])
    rig.source.start()
    rig.run(seconds)
    return rig
  }

  test('steady: 3분, 540m, 평균·현재 페이스 5′33″/km', () => {
    const rig = runPreset('steady', 180)
    const metrics = rig.summary()
    assertClose(metrics.distanceM, 540)
    assert.equal(metrics.validMs, 180_000)
    assert.equal(metrics.avgPaceSecPerKm, 333)
    assert.equal(metrics.currentPaceSecPerKm, 333)
    assert.deepEqual(rig.rejected, [])
  })

  test('stop-and-go: 3분, 470m, 정지 구간을 포함해도 모든 시간이 측정됨', () => {
    const rig = runPreset('stop-and-go', 180)
    const metrics = rig.summary()
    assertClose(metrics.distanceM, 470)
    assert.equal(metrics.validMs, 180_000)
    assert.equal(metrics.unmeasuredMs, 0)
    assert.equal(metrics.avgPaceSecPerKm, 383)
    assert.equal(metrics.currentPaceSecPerKm, 286) // 마지막 15초는 3.5m/s
  })

  test('gps-lost: 70~90초 끊김 → 80초에 lost, 150초에는 거리 387m, 미측정 21초', () => {
    const rig = createRig(VIRTUAL_SCENARIOS['gps-lost'])
    rig.source.start()
    rig.run(80)
    assert.equal(rig.gps(), 'lost')
    assert.equal(rig.summary().currentPaceSecPerKm, null)
    rig.run(70)
    const metrics = rig.summary()
    assertClose(metrics.distanceM, 387)
    assert.equal(metrics.validMs, 129_000)
    assert.equal(metrics.unmeasuredMs, 21_000)
    assert.equal(rig.gps(), 'good')
  })

  test('gps-glitch: 튐 좌표 8개가 걸러지고 거리는 336m (5초 튐 구간은 새 기준점으로 받아들여짐)', () => {
    const rig = runPreset('gps-glitch', 120)
    assert.equal(rig.rejected.length, 8)
    assert.ok(rig.rejected.every((reason) => reason === 'jump'))
    const metrics = rig.summary()
    assertClose(metrics.distanceM, 336)
    assert.equal(metrics.validMs, 112_000)
  })

  test('모든 프리셋은 최소 저장 시간(2분) 이상이다', () => {
    for (const scenario of Object.values(VIRTUAL_SCENARIOS)) {
      const total = scenario.motion.reduce((sum, segment) => sum + segment.durationSec, 0)
      assert.ok(total >= 120, `${total}초`)
    }
  })
})

describe('실제 GPS 입력과 같은 경로를 쓴다', () => {
  test('가상 제공자를 거친 결과와, 같은 좌표를 브라우저 위치(PositionLike → toRawFix)로 직접 넣은 결과가 같다', () => {
    const scenario = VIRTUAL_SCENARIOS['stop-and-go']
    const rig = createRig(scenario)
    rig.source.start()
    rig.run(180)

    // 같은 시나리오를 브라우저 위치 형태로 직접 만들어 같은 검증·계산에 넣는다.
    const session = startSession(null, BASE, () => 'direct-session')
    let tracker = createGpsTracker()
    let metrics = createMetrics()
    for (const event of generateVirtualRun(scenario)) {
      if (event.kind !== 'fix') continue
      const position: PositionLike = {
        coords: { latitude: event.lat, longitude: event.lng, accuracy: event.accuracyM },
        timestamp: BASE + event.offsetMs,
      }
      const processed = processFix(tracker, toRawFix(position, BASE + event.deliverAtMs))
      tracker = processed.state
      if (processed.result.accepted) metrics = addFix(metrics, processed.result.fix, session)
    }
    assert.deepEqual(rig.metricsState, metrics)
  })
})

describe('가상 시나리오 완료 알림 (onComplete)', () => {
  function watchWithComplete(scenario: VirtualScenario, clock: ManualClock) {
    const completions: number[] = []
    const positions: PositionLike[] = []
    const geo = createVirtualGeolocation(scenario, clock, {
      onComplete: () => completions.push(clock.now() - BASE),
    })
    const id = geo.watchPosition(
      (position) => positions.push(position),
      () => {},
    )
    return { geo, id, completions, positions }
  }

  test('마지막 좌표를 전달한 뒤 한 번만 호출한다 (3초 시나리오는 3초에)', () => {
    const clock = new ManualClock(BASE)
    const { completions, positions } = watchWithComplete(walk3, clock)
    clock.advance(2999)
    assert.equal(completions.length, 0)
    clock.advance(1)
    assert.equal(positions.length, 4)
    assert.deepEqual(completions, [3000])
    clock.advance(100_000)
    assert.equal(completions.length, 1)
    assert.equal(clock.pending, 0)
  })

  test('마지막 좌표가 전달된 뒤에 호출된다 (같은 시각이면 좌표가 먼저)', () => {
    const clock = new ManualClock(BASE)
    const order: string[] = []
    createVirtualGeolocation(walk3, clock, { onComplete: () => order.push('complete') }).watchPosition(
      () => order.push('fix'),
      () => {},
    )
    clock.advance(3000)
    assert.deepEqual(order, ['fix', 'fix', 'fix', 'fix', 'complete'])
  })

  test('끝부분이 GPS 끊김이어도 시나리오 길이가 지난 뒤에 호출한다', () => {
    const clock = new ManualClock(BASE)
    const scenario: VirtualScenario = {
      motion: [{ kind: 'move', durationSec: 10, speedMps: 3 }],
      conditions: [{ kind: 'gps-lost', fromSec: 6, toSec: 11 }],
    }
    const { completions, positions } = watchWithComplete(scenario, clock)
    clock.advance(9999)
    assert.equal(completions.length, 0)
    clock.advance(1)
    assert.equal(positions.length, 6)
    assert.deepEqual(completions, [10_000])
  })

  test('수신 지연이 있으면 지연된 마지막 좌표 뒤에 호출한다', () => {
    const clock = new ManualClock(BASE)
    const { completions, positions } = watchWithComplete({ ...walk3, deliveryLagMs: 400 }, clock)
    clock.advance(3399)
    assert.equal(completions.length, 0)
    clock.advance(1)
    assert.equal(positions.length, 4)
    assert.deepEqual(completions, [3400])
  })

  test('빈 시나리오는 곧바로(비동기로) 한 번 호출한다', () => {
    const clock = new ManualClock(BASE)
    const { completions } = watchWithComplete({ motion: [] }, clock)
    assert.equal(completions.length, 0)
    clock.advance(0)
    assert.equal(completions.length, 1)
  })

  test('완료 전에 clearWatch하면 호출하지 않고 예약도 남지 않는다', () => {
    const clock = new ManualClock(BASE)
    const { geo, id, completions } = watchWithComplete(walk3, clock)
    clock.advance(1500)
    geo.clearWatch(id)
    clock.advance(100_000)
    assert.equal(completions.length, 0)
    assert.equal(clock.pending, 0)
  })

  test('onComplete 안에서 clearWatch를 불러도 안전하다', () => {
    const clock = new ManualClock(BASE)
    let geo: ReturnType<typeof createVirtualGeolocation> | null = null
    let calls = 0
    geo = createVirtualGeolocation(walk3, clock, {
      onComplete: () => {
        calls += 1
        geo?.clearWatch(1)
      },
    })
    geo.watchPosition(
      () => {},
      () => {},
    )
    clock.advance(10_000)
    assert.equal(calls, 1)
    assert.equal(clock.pending, 0)
  })

  test('onComplete가 예외를 던져도 삼키지 않고, 다시 호출하지 않는다', () => {
    const clock = new ManualClock(BASE)
    let calls = 0
    createVirtualGeolocation(walk3, clock, {
      onComplete: () => {
        calls += 1
        throw new Error('완료 처리 실패')
      },
    }).watchPosition(
      () => {},
      () => {},
    )
    assert.throws(() => clock.advance(3000), /완료 처리 실패/)
    clock.advance(10_000)
    assert.equal(calls, 1)
    assert.equal(clock.pending, 0)
  })

  test('감시마다 독립적으로 한 번씩 호출한다 (재시작하면 다시 처음부터)', () => {
    const clock = new ManualClock(BASE)
    let calls = 0
    const geo = createVirtualGeolocation(walk3, clock, { onComplete: () => (calls += 1) })
    const first = geo.watchPosition(
      () => {},
      () => {},
    )
    clock.advance(3000)
    assert.equal(calls, 1)
    geo.clearWatch(first)
    geo.watchPosition(
      () => {},
      () => {},
    )
    clock.advance(3000)
    assert.equal(calls, 2)
  })

  test('오류 사건(error 조건)은 완료가 아니다: 오류 뒤에도 시나리오 길이가 지나야 호출한다', () => {
    const clock = new ManualClock(BASE)
    const errors: number[] = []
    let calls = 0
    createVirtualGeolocation(
      { motion: [{ kind: 'move', durationSec: 5, speedMps: 3 }], conditions: [{ kind: 'error', atSec: 2, code: 2 }] },
      clock,
      { onComplete: () => (calls += 1) },
    ).watchPosition(
      () => {},
      (error) => errors.push(error.code),
    )
    clock.advance(2000)
    assert.deepEqual(errors, [2])
    assert.equal(calls, 0)
    clock.advance(3000)
    assert.equal(calls, 1)
  })
})
