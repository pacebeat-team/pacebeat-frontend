import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { haversineMeters } from './geo.ts'
import { generateVirtualRun, getVirtualRunDurationMs } from './virtualRun.ts'
import type { VirtualEvent, VirtualFixEvent, VirtualScenario } from './virtualRun.ts'

const START = { lat: 37.5665, lng: 126.978 }

function assertClose(actual: number, expected: number, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual}은(는) ${expected}에서 ±${tolerance} 안에 있어야 함`,
  )
}

const fixesOf = (events: readonly VirtualEvent[]): VirtualFixEvent[] =>
  events.filter((event): event is VirtualFixEvent => event.kind === 'fix')

const distanceFromStart = (fix: VirtualFixEvent, start = START) =>
  haversineMeters(start.lat, start.lng, fix.lat, fix.lng)

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) deepFreeze(child)
  }
  return Object.freeze(value)
}

const walk10: VirtualScenario = { motion: [{ kind: 'move', durationSec: 10, speedMps: 3 }] }

describe('이동', () => {
  test('3m/s로 10초 가면 기본값대로 1초마다 11개의 좌표가 만들어진다', () => {
    const fixes = fixesOf(generateVirtualRun(walk10))
    assert.equal(fixes.length, 11)
    assert.deepEqual(
      fixes.map((fix) => fix.offsetMs),
      Array.from({ length: 11 }, (_, index) => index * 1000),
    )
    assert.ok(fixes.every((fix) => fix.deliverAtMs === fix.offsetMs && fix.accuracyM === 5))
  })

  test('첫 좌표는 시작점이고, 좌표마다 3m씩 멀어진다', () => {
    const fixes = fixesOf(generateVirtualRun(walk10))
    assert.equal(fixes[0].lat, START.lat)
    assert.equal(fixes[0].lng, START.lng)
    fixes.forEach((fix, index) => assertClose(distanceFromStart(fix), 3 * index))
    for (let index = 1; index < fixes.length; index += 1) {
      assertClose(haversineMeters(fixes[index - 1].lat, fixes[index - 1].lng, fixes[index].lat, fixes[index].lng), 3)
    }
  })

  test('기본 방향은 북쪽이라 위도만 늘어난다', () => {
    const fixes = fixesOf(generateVirtualRun(walk10))
    assert.ok(fixes[10].lat > fixes[0].lat)
    assertClose(fixes[10].lng, START.lng, 1e-12)
  })

  test('방향을 동쪽(90°)으로 하면 경도만 늘어난다', () => {
    const fixes = fixesOf(generateVirtualRun({ motion: [{ kind: 'move', durationSec: 10, speedMps: 3, headingDeg: 90 }] }))
    assert.ok(fixes[10].lng > fixes[0].lng)
    assertClose(fixes[10].lat, START.lat, 1e-9)
    assertClose(distanceFromStart(fixes[10]), 30, 0.02)
  })

  test('남쪽(180°)으로 가면 위도가 줄어든다', () => {
    const fixes = fixesOf(generateVirtualRun({ motion: [{ kind: 'move', durationSec: 10, speedMps: 3, headingDeg: 180 }] }))
    assert.ok(fixes[10].lat < fixes[0].lat)
    assertClose(distanceFromStart(fixes[10]), 30)
  })

  test('속도가 다른 구간을 이어 붙이면 구간별 거리가 더해진다 (10초 2m/s + 10초 4m/s = 60m)', () => {
    const fixes = fixesOf(
      generateVirtualRun({
        motion: [
          { kind: 'move', durationSec: 10, speedMps: 2 },
          { kind: 'move', durationSec: 10, speedMps: 4 },
        ],
      }),
    )
    assert.equal(fixes.length, 21)
    assertClose(distanceFromStart(fixes[10]), 20)
    assertClose(distanceFromStart(fixes[20]), 60)
  })

  test('정지 구간에서는 좌표가 계속 오지만 위치는 그대로이다', () => {
    const fixes = fixesOf(
      generateVirtualRun({
        motion: [
          { kind: 'move', durationSec: 10, speedMps: 3 },
          { kind: 'stop', durationSec: 10 },
        ],
      }),
    )
    assert.equal(fixes.length, 21)
    for (let index = 11; index <= 20; index += 1) {
      assert.equal(fixes[index].lat, fixes[10].lat)
      assert.equal(fixes[index].lng, fixes[10].lng)
    }
    assertClose(distanceFromStart(fixes[20]), 30)
  })

  test('정지 뒤 다시 이동하면 정지한 곳에서 이어진다', () => {
    const fixes = fixesOf(
      generateVirtualRun({
        motion: [
          { kind: 'move', durationSec: 10, speedMps: 3 },
          { kind: 'stop', durationSec: 5 },
          { kind: 'move', durationSec: 10, speedMps: 3 },
        ],
      }),
    )
    assertClose(distanceFromStart(fixes[fixes.length - 1]), 60)
  })

  test('시작 좌표, 좌표 간격, 기본 정확도를 바꿀 수 있다', () => {
    const start = { lat: 35.1796, lng: 129.0756 }
    const events = generateVirtualRun({ ...walk10, start, intervalMs: 2500, accuracyM: 12 })
    const fixes = fixesOf(events)
    assert.deepEqual(
      fixes.map((fix) => fix.offsetMs),
      [0, 2500, 5000, 7500, 10000],
    )
    assert.equal(fixes[0].lat, start.lat)
    assert.ok(fixes.every((fix) => fix.accuracyM === 12))
  })

  test('첫 좌표 지연: 늦게 시작하지만 그 시각의 실제 위치를 보낸다', () => {
    const fixes = fixesOf(generateVirtualRun({ ...walk10, firstFixDelayMs: 3000 }))
    assert.equal(fixes[0].offsetMs, 3000)
    assertClose(distanceFromStart(fixes[0]), 9)
    assert.equal(fixes.length, 8) // 3, 4, ..., 10초
  })

  test('수신 지연: 기기 시각은 그대로이고 도착 시각만 늦어진다', () => {
    const fixes = fixesOf(generateVirtualRun({ ...walk10, deliveryLagMs: 400 }))
    assert.deepEqual(fixes[0].offsetMs, 0)
    assert.ok(fixes.every((fix) => fix.deliverAtMs === fix.offsetMs + 400))
  })

  test('이동이 하나도 없으면 빈 목록이고, 길이가 0이면 시작점 좌표 하나만 만든다', () => {
    assert.deepEqual(generateVirtualRun({ motion: [] }), [])
    const single = fixesOf(generateVirtualRun({ motion: [{ kind: 'stop', durationSec: 0 }] }))
    assert.equal(single.length, 1)
  })

  test('시나리오 전체 길이는 이동 구간 길이의 합이다', () => {
    assert.equal(
      getVirtualRunDurationMs({
        motion: [
          { kind: 'move', durationSec: 10, speedMps: 3 },
          { kind: 'stop', durationSec: 5.5 },
        ],
      }),
      15_500,
    )
    assert.equal(getVirtualRunDurationMs({ motion: [] }), 0)
  })
})

describe('좌표 흔들림', () => {
  const still: VirtualScenario = { motion: [{ kind: 'stop', durationSec: 60 }], noiseM: 5 }

  test('흔들림 반경(5m) 안에서만 흔들린다', () => {
    const fixes = fixesOf(generateVirtualRun(still))
    assert.ok(fixes.every((fix) => distanceFromStart(fix) <= 5 + 1e-6))
    assert.ok(fixes.some((fix) => distanceFromStart(fix) > 1), '흔들림이 전혀 없음')
  })

  test('시드가 같으면 같은 흔들림, 다르면 다른 흔들림이다', () => {
    assert.deepEqual(generateVirtualRun({ ...still, seed: 7 }), generateVirtualRun({ ...still, seed: 7 }))
    assert.notDeepEqual(generateVirtualRun({ ...still, seed: 7 }), generateVirtualRun({ ...still, seed: 8 }))
  })

  test('흔들림이 없으면(기본) 정확히 같은 좌표이다', () => {
    const fixes = fixesOf(generateVirtualRun({ motion: [{ kind: 'stop', durationSec: 5 }] }))
    assert.ok(fixes.every((fix) => fix.lat === START.lat && fix.lng === START.lng))
  })

  test('GPS 끊김 같은 문제 상황을 넣어도 나머지 좌표의 흔들림은 변하지 않는다', () => {
    const base: VirtualScenario = { motion: [{ kind: 'move', durationSec: 40, speedMps: 3 }], noiseM: 4, seed: 3 }
    const without = fixesOf(generateVirtualRun(base))
    const withLoss = fixesOf(generateVirtualRun({ ...base, conditions: [{ kind: 'gps-lost', fromSec: 10, toSec: 20 }] }))
    for (const fix of withLoss) {
      assert.deepEqual(fix, without.find((other) => other.offsetMs === fix.offsetMs))
    }
  })
})

describe('문제 상황', () => {
  const run60: VirtualScenario = { motion: [{ kind: 'move', durationSec: 60, speedMps: 3 }] }

  test('GPS 끊김: 구간 [20초, 35초)에는 좌표가 없고, 경계는 시작은 포함·끝은 제외이다', () => {
    const fixes = fixesOf(generateVirtualRun({ ...run60, conditions: [{ kind: 'gps-lost', fromSec: 20, toSec: 35 }] }))
    const offsets = fixes.map((fix) => fix.offsetMs / 1000)
    assert.ok(offsets.includes(19))
    assert.ok(!offsets.includes(20))
    assert.ok(!offsets.includes(34))
    assert.ok(offsets.includes(35))
    assert.equal(fixes.length, 61 - 15)
  })

  test('GPS 끊김 동안에도 실제 위치는 계속 이동해서, 복구된 좌표는 멀리 있다', () => {
    const fixes = fixesOf(generateVirtualRun({ ...run60, conditions: [{ kind: 'gps-lost', fromSec: 20, toSec: 35 }] }))
    const before = fixes.find((fix) => fix.offsetMs === 19_000)
    const after = fixes.find((fix) => fix.offsetMs === 35_000)
    assert.ok(before !== undefined && after !== undefined)
    assertClose(haversineMeters(before.lat, before.lng, after.lat, after.lng), 3 * 16)
  })

  test('GPS 끊김은 기본으로 오류를 보내지 않고, emitError를 켜면 구간 시작에 오류 코드 2를 보낸다', () => {
    const silent = generateVirtualRun({ ...run60, conditions: [{ kind: 'gps-lost', fromSec: 20, toSec: 35 }] })
    assert.ok(silent.every((event) => event.kind === 'fix'))
    const loud = generateVirtualRun({
      ...run60,
      conditions: [{ kind: 'gps-lost', fromSec: 20, toSec: 35, emitError: true }],
    })
    const errors = loud.filter((event) => event.kind === 'error')
    assert.deepEqual(errors, [{ kind: 'error', deliverAtMs: 20_000, code: 2 }])
  })

  test('튐: 구간의 좌표만 동쪽으로 offsetM만큼 어긋나고, 나머지는 그대로이다', () => {
    const base = fixesOf(generateVirtualRun(run60))
    const glitched = fixesOf(
      generateVirtualRun({ ...run60, conditions: [{ kind: 'glitch', fromSec: 10, toSec: 13, offsetM: 800 }] }),
    )
    assert.equal(glitched.length, base.length)
    glitched.forEach((fix, index) => {
      const inRange = fix.offsetMs >= 10_000 && fix.offsetMs < 13_000
      const gap = haversineMeters(base[index].lat, base[index].lng, fix.lat, fix.lng)
      assertClose(gap, inRange ? 800 : 0, 0.5)
      if (inRange) assert.ok(fix.lng > base[index].lng, '동쪽이 아님')
    })
  })

  test('정확도 저하: 구간의 정확도만 바뀌고 위치는 그대로이다', () => {
    const base = fixesOf(generateVirtualRun(run60))
    const poor = fixesOf(
      generateVirtualRun({ ...run60, conditions: [{ kind: 'poor-accuracy', fromSec: 5, toSec: 8, accuracyM: 90 }] }),
    )
    poor.forEach((fix, index) => {
      assert.equal(fix.accuracyM, fix.offsetMs >= 5000 && fix.offsetMs < 8000 ? 90 : 5)
      assert.equal(fix.lat, base[index].lat)
    })
  })

  test('오류 사건은 정해진 시각에 한 번 들어간다', () => {
    const events = generateVirtualRun({ ...run60, conditions: [{ kind: 'error', atSec: 30, code: 1 }] })
    const errors = events.filter((event) => event.kind === 'error')
    assert.deepEqual(errors, [{ kind: 'error', deliverAtMs: 30_000, code: 1 }])
  })

  test('같은 시각의 사건은 좌표가 먼저, 오류가 나중이다', () => {
    const events = generateVirtualRun({ ...run60, conditions: [{ kind: 'error', atSec: 30, code: 3 }] })
    const at30 = events.filter((event) => event.deliverAtMs === 30_000)
    assert.deepEqual(
      at30.map((event) => event.kind),
      ['fix', 'error'],
    )
  })

  test('겹치면 GPS 끊김이 우선이고, 튐과 정확도 저하는 함께 적용된다', () => {
    const fixes = fixesOf(
      generateVirtualRun({
        ...run60,
        conditions: [
          { kind: 'glitch', fromSec: 10, toSec: 20, offsetM: 500 },
          { kind: 'poor-accuracy', fromSec: 10, toSec: 20, accuracyM: 70 },
          { kind: 'gps-lost', fromSec: 15, toSec: 20 },
        ],
      }),
    )
    const inRange = fixes.filter((fix) => fix.offsetMs >= 10_000 && fix.offsetMs < 20_000)
    assert.deepEqual(
      inRange.map((fix) => fix.offsetMs / 1000),
      [10, 11, 12, 13, 14],
    )
    assert.ok(inRange.every((fix) => fix.accuracyM === 70))
  })
})

describe('순수성', () => {
  test('같은 시나리오는 항상 같은 결과이고, 입력을 바꾸지 않는다', () => {
    const scenario = deepFreeze<VirtualScenario>({
      motion: [
        { kind: 'move', durationSec: 20, speedMps: 3 },
        { kind: 'stop', durationSec: 5 },
      ],
      conditions: [
        { kind: 'gps-lost', fromSec: 5, toSec: 8 },
        { kind: 'error', atSec: 10, code: 2 },
      ],
      noiseM: 2,
      seed: 11,
    })
    assert.deepEqual(generateVirtualRun(scenario), generateVirtualRun(scenario))
  })

  test('사건은 도착 시각 순서이다 (여러 문제 상황이 섞여도)', () => {
    const events = generateVirtualRun({
      motion: [{ kind: 'move', durationSec: 60, speedMps: 3 }],
      conditions: [
        { kind: 'error', atSec: 45, code: 3 },
        { kind: 'gps-lost', fromSec: 10, toSec: 20, emitError: true },
        { kind: 'error', atSec: 5, code: 2 },
      ],
      deliveryLagMs: 300,
    })
    for (let index = 1; index < events.length; index += 1) {
      assert.ok(events[index].deliverAtMs >= events[index - 1].deliverAtMs)
    }
  })
})

describe('잘못된 시나리오는 RangeError로 거부한다', () => {
  const bad = (scenario: VirtualScenario) => () => generateVirtualRun(scenario)

  test('좌표 간격, 정확도', () => {
    assert.throws(bad({ ...walk10, intervalMs: 0 }), RangeError)
    assert.throws(bad({ ...walk10, intervalMs: -1 }), RangeError)
    assert.throws(bad({ ...walk10, intervalMs: Number.NaN }), RangeError)
    assert.throws(bad({ ...walk10, accuracyM: 0 }), RangeError)
  })

  test('시작 좌표', () => {
    assert.throws(bad({ ...walk10, start: { lat: 91, lng: 0 } }), RangeError)
    assert.throws(bad({ ...walk10, start: { lat: 0, lng: Number.NaN } }), RangeError)
  })

  test('지연, 흔들림, 시드', () => {
    assert.throws(bad({ ...walk10, firstFixDelayMs: -1 }), RangeError)
    assert.throws(bad({ ...walk10, deliveryLagMs: -1 }), RangeError)
    assert.throws(bad({ ...walk10, noiseM: -1 }), RangeError)
    assert.throws(bad({ ...walk10, seed: Number.POSITIVE_INFINITY }), RangeError)
  })

  test('이동 구간의 길이, 속도, 방향', () => {
    assert.throws(bad({ motion: [{ kind: 'stop', durationSec: -1 }] }), RangeError)
    assert.throws(bad({ motion: [{ kind: 'move', durationSec: Number.NaN, speedMps: 3 }] }), RangeError)
    assert.throws(bad({ motion: [{ kind: 'move', durationSec: 5, speedMps: -3 }] }), RangeError)
    assert.throws(bad({ motion: [{ kind: 'move', durationSec: 5, speedMps: 3, headingDeg: Number.NaN }] }), RangeError)
  })

  test('문제 상황의 구간과 값', () => {
    assert.throws(bad({ ...walk10, conditions: [{ kind: 'gps-lost', fromSec: 5, toSec: 3 }] }), RangeError)
    assert.throws(bad({ ...walk10, conditions: [{ kind: 'gps-lost', fromSec: -1, toSec: 3 }] }), RangeError)
    assert.throws(bad({ ...walk10, conditions: [{ kind: 'glitch', fromSec: 1, toSec: 3, offsetM: Number.NaN }] }), RangeError)
    assert.throws(bad({ ...walk10, conditions: [{ kind: 'poor-accuracy', fromSec: 1, toSec: 3, accuracyM: 0 }] }), RangeError)
    assert.throws(bad({ ...walk10, conditions: [{ kind: 'error', atSec: -1, code: 1 }] }), RangeError)
  })
})
