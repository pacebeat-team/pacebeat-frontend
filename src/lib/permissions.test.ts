import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { checkMotionFitnessSupport, requestLocationPermission } from './permissions.ts'

type Success = () => void
type Failure = (error: { code: number; PERMISSION_DENIED: number }) => void

const g = globalThis as Record<string, unknown>
let savedWindow: unknown
let savedNavigator: PropertyDescriptor | undefined

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true })
}

function setup(options: { secure?: boolean; geolocation?: { getCurrentPosition: (ok: Success, fail: Failure) => void } | null }) {
  g.window = {
    isSecureContext: options.secure ?? true,
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
  }
  setNavigator(options.geolocation === null ? {} : { geolocation: options.geolocation })
}

beforeEach(() => {
  savedWindow = g.window
  savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
})

afterEach(() => {
  mock.timers.reset()
  if (savedWindow === undefined) delete g.window
  else g.window = savedWindow
  if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator)
  else delete g.navigator
})

describe('requestLocationPermission', () => {
  it('비보안 환경에서는 위치를 요청하지 않고 판단 불가(null)로 끝난다', async () => {
    let requested = false
    setup({ secure: false, geolocation: { getCurrentPosition: () => { requested = true } } })
    assert.equal(await requestLocationPermission(), null)
    assert.equal(requested, false)
  })

  it('Geolocation을 쓸 수 없으면 거부(denied)와 같게 취급한다', async () => {
    setup({ geolocation: null })
    assert.equal(await requestLocationPermission(), 'denied')
  })

  it('허용하면 granted', async () => {
    setup({ geolocation: { getCurrentPosition: (ok) => ok() } })
    assert.equal(await requestLocationPermission(), 'granted')
  })

  it('권한 거부 오류(code 1)는 denied', async () => {
    setup({ geolocation: { getCurrentPosition: (_ok, fail) => fail({ code: 1, PERMISSION_DENIED: 1 }) } })
    assert.equal(await requestLocationPermission(), 'denied')
  })

  it('위치 확인 실패(2)·타임아웃(3) 오류는 거부가 아니라 판단 불가(null)', async () => {
    for (const code of [2, 3]) {
      setup({ geolocation: { getCurrentPosition: (_ok, fail) => fail({ code, PERMISSION_DENIED: 1 }) } })
      assert.equal(await requestLocationPermission(), null)
    }
  })

  it('응답이 15초 안에 없으면 null로 끝나고, 이후 도착한 응답은 결과에 반영되지 않는다', async () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    let late: Success = () => {}
    setup({ geolocation: { getCurrentPosition: (ok) => { late = ok } } })
    const pending = requestLocationPermission()
    mock.timers.tick(14999)
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    assert.equal(settled, false)
    mock.timers.tick(1)
    assert.equal(await pending, null)
    late()
    assert.equal(await pending, null)
  })
})

describe('checkMotionFitnessSupport', () => {
  it('window가 없으면 unsupported', () => {
    delete g.window
    assert.equal(checkMotionFitnessSupport(), 'unsupported')
  })
  it('DeviceMotionEvent가 없으면 unsupported', () => {
    g.window = {}
    assert.equal(checkMotionFitnessSupport(), 'unsupported')
  })
  it('DeviceMotionEvent가 있어도 지원을 확정하지 않고 판단 불가(null)', () => {
    g.window = { DeviceMotionEvent: function DeviceMotionEvent() {} }
    assert.equal(checkMotionFitnessSupport(), null)
  })
})
