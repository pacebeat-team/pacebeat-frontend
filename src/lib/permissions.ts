import type { LocationPermission, MotionFitnessSupport } from '../types/onboarding'

// 위치 권한을 브라우저에 요청한다. (Geolocation API)
// - 허용: 'granted' / 거부: 'denied'
// - 권한과 무관한 오류(위치 확인 실패, 타임아웃)는 허용/거부를 판단할 수 없으므로 null을 반환한다.
export function requestLocationPermission(): Promise<LocationPermission> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      // Geolocation 자체를 쓸 수 없으면 위치 없이(시간 전용) 달리는 경우와 같게 취급한다.
      resolve('denied')
      return
    }

    navigator.geolocation.getCurrentPosition(
      () => resolve('granted'),
      (error) => resolve(error.code === error.PERMISSION_DENIED ? 'denied' : null),
      { timeout: 10000 },
    )
  })
}

// 동작 및 피트니스(모션 센서) 지원 여부만 확인한다.
// 웹에는 '동작 및 피트니스' 권한을 직접 요청하는 표준 API가 없어서 권한 요청은 하지 않는다.
export function checkMotionFitnessSupport(): MotionFitnessSupport {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window
    ? 'supported'
    : 'unsupported'
}
