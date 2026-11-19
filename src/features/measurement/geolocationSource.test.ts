import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WATCH_OPTIONS,
  checkGeolocationAvailability,
  createGeolocationSource,
  toGpsErrorReason,
  toRawFix,
} from './geolocationSource.ts'
import type {
  GeolocationEnv,
  GeolocationLike,
  GpsSourceDeps,
  PositionErrorLike,
  PositionLike,
} from './geolocationSource.ts'
import { applyGpsError, createGpsTracker, getGpsStatus, processFix } from './gpsTracker.ts'
import type { GpsErrorReason, RawFix } from './types.ts'

// ---------------------------------------------------------------------------
// 가짜 Geolocation
// ---------------------------------------------------------------------------

interface Watch {
  readonly id: number
  readonly onSuccess: (position: PositionLike) => void
  readonly onError: (error: PositionErrorLike) => void
  readonly options: PositionOptions | undefined
}

class FakeGeolocation implements GeolocationLike {
  readonly watches: Watch[] = []
  readonly cleared: number[] = []
  // 첫 watch id. (실제 브라우저는 1부터 주지만, 0이어도 동작해야 한다.)
  firstId = 1
  throwOnWatch: Error | null = null
  throwOnClear: Error | null = null
  // watchPosition이 값을 돌려주기 전에 실행할 동작. 콜백이 동기로 실행되는 상황을 재현한다.
  duringWatch: ((watch: Watch) => void) | null = null

  watchPosition(
    onSuccess: (position: PositionLike) => void,
    onError: (error: PositionErrorLike) => void,
    options?: PositionOptions,
  ): number {
    if (this.throwOnWatch !== null) {
      throw this.throwOnWatch
    }
    const watch: Watch = { id: this.firstId + this.watches.length, onSuccess, onError, options }
    this.watches.push(watch)
    this.duringWatch?.(watch)
    return watch.id
  }

  clearWatch(watchId: number): void {
    this.cleared.push(watchId)
    if (this.throwOnClear !== null) {
      throw this.throwOnClear
    }
  }

  // 해제 여부와 상관없이 index번째 watch의 콜백을 호출한다. (중지 뒤에 늦게 도착하는 콜백을 재현한다.)
  emit(index: number, position: PositionLike): void {
    this.watches[index].onSuccess(position)
  }

  fail(index: number, code: number): void {
    this.watches[index].onError({ code })
  }
}

const BASE = 1_700_000_000_000

function position(overrides: { lat?: number; lng?: number; accuracy?: number; timestamp?: number } = {}): PositionLike {
  return {
    coords: {
      latitude: overrides.lat ?? 37.5665,
      longitude: overrides.lng ?? 126.978,
      accuracy: overrides.accuracy ?? 8,
    },
    timestamp: overrides.timestamp ?? BASE,
  }
}

interface SetupOptions {
  readonly geo?: FakeGeolocation
  readonly env?: () => GeolocationEnv
  readonly deps?: GpsSourceDeps
  readonly onFix?: (fix: RawFix) => void
  readonly onError?: (reason: GpsErrorReason) => void
}

function setup(options: SetupOptions = {}) {
  const geo = options.geo ?? new FakeGeolocation()
  const fixes: RawFix[] = []
  const errors: GpsErrorReason[] = []
  const clock = { now: BASE + 5000 }
  const source = createGeolocationSource(
    {
      onFix: (fix) => {
        fixes.push(fix)
        options.onFix?.(fix)
      },
      onError: (reason) => {
        errors.push(reason)
        options.onError?.(reason)
      },
    },
    {
      env: options.env ?? (() => ({ isSecureContext: true, geolocation: geo })),
      now: () => clock.now,
      ...options.deps,
    },
  )
  return { geo, source, fixes, errors, clock }
}

// 컴파일 시점 확인: 실제 Geolocation과 실행 환경은 타입 단언 없이 주입용 타입에 대입된다.
function acceptRealGeolocation(real: Geolocation): GeolocationLike {
  return real
}
function acceptRealEnv(): GeolocationEnv {
  return { isSecureContext: globalThis.isSecureContext, geolocation: navigator.geolocation }
}

describe('타입 호환', () => {
  test('실제 Geolocation은 타입 단언 없이 GeolocationLike로 쓸 수 있다 (tsc가 확인)', () => {
    assert.equal(typeof acceptRealGeolocation, 'function')
    assert.equal(typeof acceptRealEnv, 'function')
  })
})

// ---------------------------------------------------------------------------
// 순수 변환·판정
// ---------------------------------------------------------------------------

describe('toRawFix', () => {
  test('좌표, 정확도, 기기 시각을 옮기고 받은 시각은 따로 담는다', () => {
    const fix = toRawFix(position({ lat: 37.1, lng: 127.2, accuracy: 12.5, timestamp: BASE + 100 }), BASE + 900)
    assert.deepEqual(fix, { lat: 37.1, lng: 127.2, accuracyM: 12.5, deviceTime: BASE + 100, receivedAt: BASE + 900 })
  })

  test('정확도가 숫자가 아니면 null로 둔다', () => {
    for (const accuracy of [Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(toRawFix(position({ accuracy }), BASE).accuracyM, null)
    }
  })

  test('값이 올바른지는 판단하지 않고 그대로 넘긴다 (검증은 gpsTracker)', () => {
    const fix = toRawFix(position({ lat: 999, lng: -999, accuracy: 0, timestamp: Number.NaN }), BASE)
    assert.equal(fix.lat, 999)
    assert.equal(fix.lng, -999)
    assert.equal(fix.accuracyM, 0)
    assert.ok(Number.isNaN(fix.deviceTime))
  })
})

describe('toGpsErrorReason', () => {
  test('코드 1, 2, 3과 알 수 없는 코드를 바꾼다', () => {
    assert.equal(toGpsErrorReason({ code: 1 }), 'permission-denied')
    assert.equal(toGpsErrorReason({ code: 2 }), 'position-unavailable')
    assert.equal(toGpsErrorReason({ code: 3 }), 'timeout')
    assert.equal(toGpsErrorReason({ code: 0 }), 'position-unavailable')
    assert.equal(toGpsErrorReason({ code: 99 }), 'position-unavailable')
  })
})

describe('checkGeolocationAvailability', () => {
  const geo = new FakeGeolocation()

  test('보안 컨텍스트가 아니면 geolocation이 있어도 사용할 수 없다', () => {
    assert.deepEqual(checkGeolocationAvailability({ isSecureContext: false, geolocation: geo }), {
      available: false,
      reason: 'insecure-context',
    })
    assert.deepEqual(checkGeolocationAvailability({ geolocation: geo }), {
      available: false,
      reason: 'insecure-context',
    })
  })

  test('geolocation이 없으면(null, undefined) 지원하지 않는 환경이다', () => {
    for (const geolocation of [null, undefined]) {
      assert.deepEqual(checkGeolocationAvailability({ isSecureContext: true, geolocation }), {
        available: false,
        reason: 'unsupported',
      })
    }
  })

  test('둘 다 없으면 보안 컨텍스트 문제를 먼저 알린다', () => {
    assert.deepEqual(checkGeolocationAvailability({}), { available: false, reason: 'insecure-context' })
  })

  test('사용할 수 있으면 같은 geolocation 객체를 돌려준다', () => {
    const result = checkGeolocationAvailability({ isSecureContext: true, geolocation: geo })
    assert.equal(result.available, true)
    assert.equal(result.available && result.geolocation, geo)
  })
})

// ---------------------------------------------------------------------------
// 시작과 중지
// ---------------------------------------------------------------------------

describe('시작', () => {
  test('watchPosition을 한 번 호출하고 실행 중이 된다', () => {
    const { geo, source } = setup()
    assert.equal(source.isRunning, false)
    source.start()
    assert.equal(geo.watches.length, 1)
    assert.equal(source.isRunning, true)
  })

  test('기본 옵션은 고정밀, 캐시 사용 안 함이고 timeout은 없다', () => {
    const { geo, source } = setup()
    source.start()
    assert.deepEqual(geo.watches[0].options, { enableHighAccuracy: true, maximumAge: 0 })
    assert.equal('timeout' in DEFAULT_WATCH_OPTIONS, false)
    assert.equal(Object.isFrozen(DEFAULT_WATCH_OPTIONS), true)
  })

  test('옵션을 주입할 수 있다', () => {
    const custom = { enableHighAccuracy: false, maximumAge: 1000, timeout: 5000 }
    const { geo, source } = setup({ deps: { options: custom } })
    source.start()
    assert.deepEqual(geo.watches[0].options, custom)
  })

  test('이미 실행 중이면 다시 시작해도 watch를 만들지 않는다', () => {
    const { geo, source } = setup()
    source.start()
    source.start()
    source.start()
    assert.equal(geo.watches.length, 1)
  })

  test('받은 좌표는 받은 시각(now)과 기기 시각을 구분해 전달한다', () => {
    const { geo, source, fixes, clock } = setup()
    source.start()
    clock.now = BASE + 1000
    geo.emit(0, position({ timestamp: BASE + 400 }))
    clock.now = BASE + 2500
    geo.emit(0, position({ timestamp: BASE + 2400 }))
    assert.deepEqual(
      fixes.map((fix) => [fix.deviceTime, fix.receivedAt]),
      [
        [BASE + 400, BASE + 1000],
        [BASE + 2400, BASE + 2500],
      ],
    )
  })

  test('now를 주입하지 않으면 Date.now를 쓴다', () => {
    const geo = new FakeGeolocation()
    const fixes: RawFix[] = []
    const source = createGeolocationSource(
      { onFix: (fix) => fixes.push(fix), onError: () => {} },
      { env: () => ({ isSecureContext: true, geolocation: geo }) },
    )
    source.start()
    const before = Date.now()
    geo.emit(0, position())
    const after = Date.now()
    assert.ok(fixes[0].receivedAt >= before && fixes[0].receivedAt <= after)
  })
})

describe('중지', () => {
  test('watch를 한 번 해제하고 실행 중이 아니게 된다', () => {
    const { geo, source } = setup()
    source.start()
    source.stop()
    assert.deepEqual(geo.cleared, [1])
    assert.equal(source.isRunning, false)
  })

  test('여러 번 중지해도 해제는 한 번만 한다', () => {
    const { geo, source } = setup()
    source.start()
    source.stop()
    source.stop()
    assert.deepEqual(geo.cleared, [1])
  })

  test('시작하기 전의 중지는 아무 일도 하지 않는다', () => {
    const { geo, source } = setup()
    assert.doesNotThrow(() => source.stop())
    assert.deepEqual(geo.cleared, [])
  })

  test('watch id가 0이어도 해제한다', () => {
    const geo = new FakeGeolocation()
    geo.firstId = 0
    const { source } = setup({ geo })
    source.start()
    assert.equal(source.isRunning, true)
    source.stop()
    assert.deepEqual(geo.cleared, [0])
    assert.equal(source.isRunning, false)
  })

  test('중지 뒤에 늦게 도착한 좌표와 오류는 무시한다', () => {
    const { geo, source, fixes, errors } = setup()
    source.start()
    source.stop()
    geo.emit(0, position())
    geo.fail(0, 2)
    geo.fail(0, 1)
    assert.equal(fixes.length, 0)
    assert.equal(errors.length, 0)
  })

  test('clearWatch가 예외를 던져도 상태는 정리되고, 예외는 삼키지 않는다', () => {
    const { geo, source } = setup()
    source.start()
    geo.throwOnClear = new Error('clear failed')
    assert.throws(() => source.stop(), /clear failed/)
    assert.equal(source.isRunning, false)
    geo.throwOnClear = null
    source.start()
    assert.equal(source.isRunning, true)
  })
})

describe('중지 후 재시작', () => {
  test('이전 watch의 늦은 콜백은 새 세션에 전달되지 않고, 새 watch의 콜백만 전달된다', () => {
    const { geo, source, fixes, errors } = setup()
    source.start()
    source.stop()
    source.start()
    assert.equal(geo.watches.length, 2)
    assert.equal(source.isRunning, true)

    geo.emit(0, position({ lat: 11 })) // 이전 watch
    geo.fail(0, 2)
    assert.equal(fixes.length, 0)
    assert.equal(errors.length, 0)

    geo.emit(1, position({ lat: 22 })) // 새 watch
    assert.deepEqual(
      fixes.map((fix) => fix.lat),
      [22],
    )
  })

  test('재시작 뒤 중지하면 새 watch만 해제한다', () => {
    const { geo, source } = setup()
    source.start()
    source.stop()
    source.start()
    source.stop()
    assert.deepEqual(geo.cleared, [1, 2])
  })
})

// ---------------------------------------------------------------------------
// 오류 처리
// ---------------------------------------------------------------------------

describe('일시적인 위치 오류', () => {
  test('position-unavailable과 timeout은 알리지만 감시는 유지한다', () => {
    const { geo, source, errors, fixes } = setup()
    source.start()
    geo.fail(0, 2)
    geo.fail(0, 3)
    assert.deepEqual(errors, ['position-unavailable', 'timeout'])
    assert.equal(source.isRunning, true)
    assert.deepEqual(geo.cleared, [])
    geo.emit(0, position())
    assert.equal(fixes.length, 1)
  })

  test('알 수 없는 오류 코드는 position-unavailable로 알린다', () => {
    const { geo, source, errors } = setup()
    source.start()
    geo.fail(0, 42)
    assert.deepEqual(errors, ['position-unavailable'])
  })
})

describe('권한 거부', () => {
  test('알리고, watch를 정리하고, 실행 중이 아니게 된다', () => {
    const { geo, source, errors } = setup()
    source.start()
    geo.fail(0, 1)
    assert.deepEqual(errors, ['permission-denied'])
    assert.deepEqual(geo.cleared, [1])
    assert.equal(source.isRunning, false)
  })

  test('핸들러가 호출될 때는 이미 실행 중이 아닌 상태이다', () => {
    const observed: boolean[] = []
    const t = setup({ onError: () => observed.push(t.source.isRunning) })
    t.source.start()
    t.geo.fail(0, 1)
    assert.deepEqual(observed, [false])
  })

  test('권한을 허용한 뒤 다시 시작할 수 있다', () => {
    const { geo, source, fixes } = setup()
    source.start()
    geo.fail(0, 1)
    source.start()
    assert.equal(geo.watches.length, 2)
    assert.equal(source.isRunning, true)
    geo.emit(1, position())
    assert.equal(fixes.length, 1)
  })

  test('핸들러 안에서 바로 다시 시작해도 된다', () => {
    const t = setup({
      onError: (reason) => {
        if (reason === 'permission-denied') t.source.start()
      },
    })
    t.source.start()
    t.geo.fail(0, 1)
    assert.equal(t.geo.watches.length, 2)
    assert.equal(t.source.isRunning, true)
  })

  test('거부된 watch의 늦은 콜백은 무시한다', () => {
    const { geo, source, fixes, errors } = setup()
    source.start()
    geo.fail(0, 1)
    geo.emit(0, position())
    geo.fail(0, 1)
    assert.equal(fixes.length, 0)
    assert.deepEqual(errors, ['permission-denied'])
  })
})

describe('위치를 쓸 수 없는 환경', () => {
  test('보안 컨텍스트가 아니면 watch를 시작하지 않고 insecure-context를 알린다', () => {
    const geo = new FakeGeolocation()
    const { source, errors } = setup({ geo, env: () => ({ isSecureContext: false, geolocation: geo }) })
    source.start()
    assert.deepEqual(errors, ['insecure-context'])
    assert.equal(geo.watches.length, 0)
    assert.equal(source.isRunning, false)
  })

  test('Geolocation이 없으면 unsupported를 알린다', () => {
    const { source, errors } = setup({ env: () => ({ isSecureContext: true, geolocation: null }) })
    source.start()
    assert.deepEqual(errors, ['unsupported'])
    assert.equal(source.isRunning, false)
  })

  test('시작할 때마다 환경을 다시 읽어서, 환경이 바뀌면 다시 시작할 수 있다', () => {
    const geo = new FakeGeolocation()
    let secure = false
    const { source, errors } = setup({ geo, env: () => ({ isSecureContext: secure, geolocation: geo }) })
    source.start()
    source.start()
    assert.deepEqual(errors, ['insecure-context', 'insecure-context']) // 실행 중이 아니므로 매번 알린다
    secure = true
    source.start()
    assert.equal(geo.watches.length, 1)
    assert.equal(source.isRunning, true)
  })

  test('주입하지 않은 기본 환경(Node)에서도 예외 없이 사용 불가로 알린다', () => {
    const errors: GpsErrorReason[] = []
    const source = createGeolocationSource({ onFix: () => {}, onError: (reason) => errors.push(reason) })
    assert.doesNotThrow(() => source.start())
    assert.equal(errors.length, 1)
    assert.ok(errors[0] === 'insecure-context' || errors[0] === 'unsupported')
    assert.equal(source.isRunning, false)
  })

  test('watchPosition 자체가 예외를 던지면 unsupported로 알리고 다시 시작할 수 있다', () => {
    const { geo, source, errors } = setup()
    geo.throwOnWatch = new Error('SecurityError')
    source.start()
    assert.deepEqual(errors, ['unsupported'])
    assert.equal(source.isRunning, false)
    geo.throwOnWatch = null
    source.start()
    assert.equal(source.isRunning, true)
  })
})

// ---------------------------------------------------------------------------
// watchPosition이 값을 돌려주기 전에 콜백이 동기로 실행되는 경우
// ---------------------------------------------------------------------------

describe('동기 콜백', () => {
  test('동기로 받은 좌표를 전달하고, 이후에도 정상적으로 실행 중이며 중지할 수 있다', () => {
    const { geo, source, fixes } = setup()
    geo.duringWatch = (watch) => watch.onSuccess(position())
    source.start()
    assert.equal(fixes.length, 1)
    assert.equal(source.isRunning, true)
    source.stop()
    assert.deepEqual(geo.cleared, [1])
    assert.equal(source.isRunning, false)
  })

  test('동기로 권한이 거부되면 알리고, 돌아온 뒤 새 watch를 해제하며, 이후 콜백은 무시한다', () => {
    const { geo, source, errors, fixes } = setup()
    geo.duringWatch = (watch) => watch.onError({ code: 1 })
    source.start()
    assert.deepEqual(errors, ['permission-denied'])
    assert.equal(source.isRunning, false)
    assert.deepEqual(geo.cleared, [1])

    geo.emit(0, position())
    geo.fail(0, 2)
    assert.equal(fixes.length, 0)
    assert.deepEqual(errors, ['permission-denied'])

    geo.duringWatch = null
    source.start() // 다시 시작할 수 있다
    assert.equal(geo.watches.length, 2)
    assert.equal(source.isRunning, true)
  })

  test('동기 콜백 안에서 핸들러가 중지하면, 돌아온 뒤 watch를 해제하고 실행 중이 아니다', () => {
    const t = setup({ onFix: () => t.source.stop() })
    t.geo.duringWatch = (watch) => {
      watch.onSuccess(position())
      watch.onSuccess(position()) // 이미 중지되었으므로 무시된다
    }
    t.source.start()
    assert.equal(t.fixes.length, 1)
    assert.equal(t.source.isRunning, false)
    assert.deepEqual(t.geo.cleared, [1])
  })

  test('동기 콜백 안에서 start()를 다시 불러도 무시된다', () => {
    const t = setup({ onFix: () => t.source.start() })
    t.geo.duringWatch = (watch) => watch.onSuccess(position())
    t.source.start()
    assert.equal(t.geo.watches.length, 1)
    assert.equal(t.source.isRunning, true)
  })
})

// ---------------------------------------------------------------------------
// 핸들러 예외
// ---------------------------------------------------------------------------

describe('핸들러 예외는 삼키지 않고 전파한다', () => {
  test('onFix 예외는 콜백 호출자에게 전파되고, 감시는 유지된다', () => {
    const { geo, source } = setup({
      onFix: () => {
        throw new Error('boom')
      },
    })
    source.start()
    assert.throws(() => geo.emit(0, position()), /boom/)
    assert.equal(source.isRunning, true)
  })

  test('onError 예외도 전파되고, 일시 오류에서는 감시가 유지된다', () => {
    const { geo, source } = setup({
      onError: () => {
        throw new Error('boom')
      },
    })
    source.start()
    assert.throws(() => geo.fail(0, 3), /boom/)
    assert.equal(source.isRunning, true)
  })

  test('권한 거부를 알리는 핸들러가 던져도 정리는 끝나 있고 예외는 전파된다', () => {
    const { geo, source } = setup({
      onError: () => {
        throw new Error('boom')
      },
    })
    source.start()
    assert.throws(() => geo.fail(0, 1), /boom/)
    assert.equal(source.isRunning, false)
    assert.deepEqual(geo.cleared, [1])
  })

  test('사용 불가를 알리는 핸들러가 던져도 예외가 전파된다', () => {
    const { source } = setup({
      env: () => ({ isSecureContext: false }),
      onError: () => {
        throw new Error('boom')
      },
    })
    assert.throws(() => source.start(), /boom/)
    assert.equal(source.isRunning, false)
  })

  test('동기 콜백에서 핸들러가 던지면 start()가 그 예외를 던지고, unsupported로 오인하지 않는다', () => {
    const { geo, source, errors, fixes } = setup({
      onFix: () => {
        throw new Error('boom')
      },
    })
    geo.duringWatch = (watch) => watch.onSuccess(position())
    assert.throws(() => source.start(), /boom/)
    assert.deepEqual(errors, [])
    assert.equal(source.isRunning, false)

    geo.emit(0, position()) // 끝난 세션의 콜백은 무시한다
    assert.equal(fixes.length, 1)
  })
})

// ---------------------------------------------------------------------------
// gpsTracker와의 연결 (스토어가 할 일을 테스트 안에서 흉내)
// ---------------------------------------------------------------------------

describe('gpsTracker와 연결', () => {
  test('좌표는 processFix로, 오류는 applyGpsError로 이어진다', () => {
    let state = createGpsTracker()
    const t = setup({
      onFix: (fix) => {
        state = processFix(state, fix).state
      },
      onError: (reason) => {
        state = applyGpsError(state, reason)
      },
    })
    t.source.start()
    t.clock.now = BASE + 1000
    t.geo.emit(0, position({ timestamp: BASE + 900 }))
    assert.equal(state.acceptedCount, 1)
    assert.equal(getGpsStatus(state, BASE + 1000), 'good')

    t.geo.fail(0, 2) // 일시 오류는 상태를 바꾸지 않는다
    assert.equal(getGpsStatus(state, BASE + 1000), 'good')

    t.geo.fail(0, 1)
    assert.equal(getGpsStatus(state, BASE + 1000), 'unavailable')
  })

  test('정확도를 알 수 없는 좌표는 검증 단계에서 버려진다', () => {
    let rejected = ''
    const t = setup({
      onFix: (fix) => {
        const processed = processFix(createGpsTracker(), fix)
        if (!processed.result.accepted) rejected = processed.result.reason
      },
    })
    t.source.start()
    t.geo.emit(0, position({ accuracy: Number.NaN }))
    assert.equal(rejected, 'poor-accuracy')
  })
})
