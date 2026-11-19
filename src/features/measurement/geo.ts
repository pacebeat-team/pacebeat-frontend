// 좌표 계산 (순수 함수).
// - 좌표가 믿을 만한지 판단하는 데 필요한 거리 계산만 둔다.
// - 거리를 누적하는 정책(정지 중 흔들림 무시 등)은 다음 단계(거리·페이스)의 책임이다.

const EARTH_RADIUS_M = 6_371_000

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

// 위도 −90~90, 경도 −180~180 범위의 유한한 값인지 확인한다.
export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

// 두 좌표 사이의 거리(m, 대원 거리). 유효한 좌표(isValidCoordinate)만 넣는다.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const deltaLat = toRadians(lat2 - lat1)
  const deltaLng = toRadians(lng2 - lng1)
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLng / 2) ** 2
  // 부동소수점 오차로 a가 1을 아주 조금 넘어도 NaN이 되지 않게 한다.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}
