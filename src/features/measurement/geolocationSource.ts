import type { GpsErrorReason, GpsUnavailableReason, RawFix } from './types.ts'

// 브라우저 Geolocation API로 실제 위치를 수집한다.
// - 이 파일의 책임은 "좌표와 오류를 받아서 RawFix / GpsErrorReason으로 바꿔 전달"하는 것까지이다.
//   좌표가 믿을 만한지(정확도, 튐, 중복 등)는 gpsTracker.ts가 판단하고, 거리·페이스 계산과 저장은 하지 않는다.
// - gpsTracker.ts를 import하지 않는다. 둘을 잇는 일(onFix → processFix, onError → applyGpsError)은 스토어 단계에서 한다.
// - 브라우저 API는 이 파일이 쓰는 부분만 GeolocationLike로 정의해서, 테스트에서 가짜를 쉽게 주입할 수 있다.
//   실제 navigator.geolocation은 타입 단언 없이 그대로 대입된다.

// ---------------------------------------------------------------------------
// 주입용 타입 (브라우저 Geolocation 중 쓰는 부분만)
// ---------------------------------------------------------------------------

export interface PositionLike {
  readonly coords: {
    readonly latitude: number
    readonly longitude: number
    readonly accuracy: number
  }
  readonly timestamp: number
}

export interface PositionErrorLike {
  readonly code: number
}

// 메서드 문법으로 선언해야 실제 Geolocation(콜백 인자가 더 넓은 타입)이 그대로 대입된다.
export interface GeolocationLike {
  watchPosition(
    onSuccess: (position: PositionLike) => void,
    onError: (error: PositionErrorLike) => void,
    options?: PositionOptions,
  ): number
  clearWatch(watchId: number): void
}

export interface GeolocationEnv {
  readonly isSecureContext?: boolean
  readonly geolocation?: GeolocationLike | null
}

export interface GpsSourceHandlers {
  // 좌표를 받을 때마다 호출한다. 예외는 삼키지 않고 그대로 전파된다.
  onFix(fix: RawFix): void
  // 위치 오류를 받을 때마다 호출한다. 예외는 삼키지 않고 그대로 전파된다.
  onError(reason: GpsErrorReason): void
}

export interface GpsSourceDeps {
  // 실행 환경. start()를 호출할 때마다 읽는다. 기본값은 브라우저의 isSecureContext와 navigator.geolocation이다.
  readonly env?: () => GeolocationEnv
  // 좌표를 받은 시각(epoch ms). 세션 사건과 같은 시계여야 한다. 기본값은 Date.now이다.
  readonly now?: () => number
  readonly options?: PositionOptions
}

export interface GpsSource {
  // 위치 감시를 시작한다. 이미 실행 중이면 아무 것도 하지 않는다.
  // 위치를 쓸 수 없는 환경이면 감시를 시작하지 않고 onError로 알린다(이 경우 다시 시작할 수 있다).
  // ⚠️ 사용 불가 오류는 start() 호출 안에서 동기로 onError를 호출한다.
  start(): void
  // 위치 감시를 중지한다. 실행 중이 아니면 아무 것도 하지 않는다. 중지 이후 도착한 콜백은 무시한다.
  stop(): void
  readonly isRunning: boolean
}

// ---------------------------------------------------------------------------
// 순수 변환·판정
// ---------------------------------------------------------------------------

// ⚠️ 제안값이다. timeout은 두지 않는다(위치가 늦어도 감시를 유지하고, 끊김은 gpsTracker가 시간으로 판단한다).
export const DEFAULT_WATCH_OPTIONS: PositionOptions = Object.freeze({
  enableHighAccuracy: true,
  maximumAge: 0,
})

// 브라우저 좌표를 RawFix로 바꾼다. 값이 올바른지는 판단하지 않고 그대로 넘긴다(검증은 gpsTracker).
// 기기 시각(position.timestamp)과 받은 시각(receivedAt)은 구분해서 담는다.
export function toRawFix(position: PositionLike, receivedAt: number): RawFix {
  const { latitude, longitude, accuracy } = position.coords
  return {
    lat: latitude,
    lng: longitude,
    accuracyM: Number.isFinite(accuracy) ? accuracy : null,
    deviceTime: position.timestamp,
    receivedAt,
  }
}

// GeolocationPositionError.code → GpsErrorReason (1: 권한 거부, 2: 위치 확인 불가, 3: 시간 초과).
// 상수를 쓰지 않고 숫자로 비교한다(브라우저가 아닌 환경에서도 동작). 알 수 없는 값은 위치 확인 불가로 본다.
export function toGpsErrorReason(error: PositionErrorLike): GpsErrorReason {
  switch (error.code) {
    case 1:
      return 'permission-denied'
    case 3:
      return 'timeout'
    default:
      return 'position-unavailable'
  }
}

export type GeolocationAvailability =
  | { readonly available: true; readonly geolocation: GeolocationLike }
  | { readonly available: false; readonly reason: GpsUnavailableReason }

// 위치를 쓸 수 있는 환경인가. 보안 컨텍스트(HTTPS, localhost)가 아니면 geolocation 객체가 있어도 브라우저가
// 곧바로 거부하므로 보안 컨텍스트를 먼저 확인한다. (src/lib/permissions.ts와 같은 기준)
export function checkGeolocationAvailability(env: GeolocationEnv): GeolocationAvailability {
  if (!env.isSecureContext) {
    return { available: false, reason: 'insecure-context' }
  }
  if (!env.geolocation) {
    return { available: false, reason: 'unsupported' }
  }
  return { available: true, geolocation: env.geolocation }
}

function readBrowserEnv(): GeolocationEnv {
  return {
    isSecureContext: globalThis.isSecureContext === true,
    geolocation: typeof navigator === 'undefined' ? null : navigator.geolocation,
  }
}

// ---------------------------------------------------------------------------
// 위치 수집
// ---------------------------------------------------------------------------

// watchPosition 한 번의 수명. 시작할 때마다 새로 만들어서, 이전 watch의 늦은 콜백이 새 세션으로 섞이지 않게 한다.
interface WatchSession {
  active: boolean
  // watchPosition이 값을 돌려주기 전(동기 콜백 중)에는 null이다.
  watchId: number | null
  readonly geolocation: GeolocationLike
}

export function createGeolocationSource(handlers: GpsSourceHandlers, deps: GpsSourceDeps = {}): GpsSource {
  const getEnv = deps.env ?? readBrowserEnv
  const now = deps.now ?? Date.now
  const options = deps.options ?? DEFAULT_WATCH_OPTIONS

  // 실행 중인 세션. null이면 실행 중이 아니다. (watch id가 0이어도 안전하도록 id가 아니라 세션으로 판단한다.)
  let current: WatchSession | null = null

  // 세션을 끝낸다. 상태를 먼저 정리한 뒤 watch를 해제하므로, clearWatch가 예외를 던져도 상태는 일관된다.
  // watch id를 아직 모르면(watchPosition이 돌아오기 전) 해제는 start()가 돌아온 뒤에 한다.
  function release(session: WatchSession): void {
    session.active = false
    if (current === session) {
      current = null
    }
    if (session.watchId !== null) {
      session.geolocation.clearWatch(session.watchId)
    }
  }

  function start(): void {
    if (current !== null) {
      return
    }

    const availability = checkGeolocationAvailability(getEnv())
    if (!availability.available) {
      handlers.onError(availability.reason)
      return
    }

    const session: WatchSession = { active: true, watchId: null, geolocation: availability.geolocation }
    // watchPosition 호출 전에 실행 중으로 표시한다. 콜백이 동기로 실행되어도 상태가 꼬이지 않고,
    // 그 안에서 start()를 다시 불러도 무시된다.
    current = session

    // 핸들러가 던진 예외는 삼키지 않는다. watchPosition 호출 중 동기 콜백에서 핸들러가 던진 경우에도
    // "watchPosition 자체가 실패"로 오인하지 않도록 구분한다.
    let handlerThrew = false
    const callHandler = (call: () => void): void => {
      try {
        call()
      } catch (error) {
        handlerThrew = true
        throw error
      }
    }

    const onSuccess = (position: PositionLike): void => {
      if (!session.active) {
        return
      }
      const fix = toRawFix(position, now())
      callHandler(() => handlers.onFix(fix))
    }

    const onError = (error: PositionErrorLike): void => {
      if (!session.active) {
        return
      }
      const reason = toGpsErrorReason(error)
      if (reason === 'permission-denied') {
        // 권한 거부는 감시가 사실상 끝난 것이다. 정리한 뒤(핸들러가 isRunning=false를 보고 다시 시작할 수 있게) 알린다.
        try {
          release(session)
        } finally {
          callHandler(() => handlers.onError(reason))
        }
        return
      }
      // position-unavailable, timeout은 일시적일 수 있으므로 감시를 유지한다.
      callHandler(() => handlers.onError(reason))
    }

    let watchId: number
    try {
      watchId = session.geolocation.watchPosition(onSuccess, onError, options)
    } catch (error) {
      session.active = false
      if (current === session) {
        current = null
      }
      if (handlerThrew) {
        throw error
      }
      // watchPosition 자체가 예외를 던지는 경우(드묾): 위치를 쓸 수 없는 환경으로 본다.
      handlers.onError('unsupported')
      return
    }

    if (!session.active) {
      // watchPosition이 돌아오기 전에 이미 끝난 세션(동기 콜백 중 권한 거부, 핸들러의 stop()).
      // 새 watch를 남기지 않도록 지금 해제한다.
      session.geolocation.clearWatch(watchId)
      return
    }
    session.watchId = watchId
  }

  function stop(): void {
    if (current === null) {
      return
    }
    release(current)
  }

  return {
    start,
    stop,
    get isRunning() {
      return current !== null
    },
  }
}
