import type { LocationPermission, MotionFitnessSupport } from '../types/onboarding'

// 앱이 위치 권한 응답을 기다리는 최대 시간(ms).
const LOCATION_REQUEST_TIMEOUT_MS = 15000

// 위치 권한을 브라우저에 요청한다. (Geolocation API)
// - 허용: 'granted' / 거부: 'denied'
// - 권한과 무관한 오류(위치 확인 실패, 타임아웃)는 허용/거부를 판단할 수 없으므로 null을 반환한다.
// - 응답이 없어도 LOCATION_REQUEST_TIMEOUT_MS 이후에는 null로 끝난다.
//   이 제한은 앱의 "대기"만 종료한다. 브라우저 권한 팝업 자체는 앱에서 닫거나 취소할 수 없어서
//   팝업은 남아 있을 수 있고, 이후 도착하는 응답은 이 함수의 결과에 반영되지 않는다.
// - HTTPS가 아닌 환경(비보안 컨텍스트)에서는 브라우저가 팝업 없이 곧바로 거부 오류를 돌려준다.
//   사용자가 실제로 거부한 것이 아니므로 위치를 요청하지 않고 판단 불가(null)로 처리한다.
export function requestLocationPermission(): Promise<LocationPermission> {
  if (!window.isSecureContext) return Promise.resolve(null)

  return new Promise((resolve) => {
    let isSettled = false
    const settle = (result: LocationPermission) => {
      if (isSettled) return
      isSettled = true
      window.clearTimeout(timerId)
      resolve(result)
    }

    const timerId = window.setTimeout(() => settle(null), LOCATION_REQUEST_TIMEOUT_MS)

    if (!('geolocation' in navigator)) {
      // Geolocation 자체를 쓸 수 없으면 위치 없이(시간 전용) 달리는 경우와 같게 취급한다.
      settle('denied')
      return
    }

    navigator.geolocation.getCurrentPosition(
      () => settle('granted'),
      (error) => settle(error.code === error.PERMISSION_DENIED ? 'denied' : null),
      { timeout: 10000 },
    )
  })
}

// 동작 및 피트니스(모션 센서) 지원 여부를 확인한다.
// 웹에는 '동작 및 피트니스' 권한을 직접 요청하는 표준 API가 없어서 권한 요청은 하지 않는다.
// - DeviceMotionEvent가 없으면 센서를 쓸 수 없는 것이 확실하므로 'unsupported'
// - DeviceMotionEvent가 있어도 실제 센서 존재나 권한 허용(iOS는 별도 요청 필요)은 확인할 수 없으므로
//   지원한다고 확정하지 않고 판단 불가(null)로 둔다.
export function checkMotionFitnessSupport(): MotionFitnessSupport {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window ? null : 'unsupported'
}
