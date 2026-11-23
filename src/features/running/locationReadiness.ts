import { checkGeolocationAvailability } from '../measurement/geolocationSource.ts'
import type { GeolocationAvailability, GeolocationEnv } from '../measurement/geolocationSource.ts'

// 준비 확인 화면에서 쓰는 위치 사용 가능 여부.
// 위치 권한을 요청하지 않는다(확인만 한다). 실제 권한 요청은 러닝을 시작할 때의 위치 수집이 한다.
// 온보딩 Store의 시간 전용 값(timeOnlyMode)은 읽지 않는다.

export type LocationUnavailableReason = Extract<GeolocationAvailability, { available: false }>['reason'] | 'denied'

export type LocationReadiness =
  | { readonly available: true }
  | { readonly available: false; readonly reason: LocationUnavailableReason }

export interface PermissionsLike {
  query(descriptor: { name: 'geolocation' }): Promise<{ readonly state: string }>
}

export interface LocationReadinessDeps {
  readonly env?: GeolocationEnv
  readonly permissions?: PermissionsLike | null
}

function readBrowserEnv(): GeolocationEnv {
  return {
    isSecureContext: globalThis.isSecureContext === true,
    geolocation: typeof navigator === 'undefined' ? null : navigator.geolocation,
  }
}

function readBrowserPermissions(): PermissionsLike | null {
  if (typeof navigator === 'undefined') return null
  return (navigator.permissions as PermissionsLike | undefined) ?? null
}

// 비보안 환경·미지원 환경·거부된 권한은 사용 불가. 권한 상태를 알 수 없으면(미지원, 조회 실패) 사용 가능으로 본다.
export async function queryLocationReadiness(deps: LocationReadinessDeps = {}): Promise<LocationReadiness> {
  const availability = checkGeolocationAvailability(deps.env ?? readBrowserEnv())
  if (!availability.available) return { available: false, reason: availability.reason }

  const permissions = deps.permissions === undefined ? readBrowserPermissions() : deps.permissions
  if (permissions === null) return { available: true }
  try {
    const status = await permissions.query({ name: 'geolocation' })
    return status.state === 'denied' ? { available: false, reason: 'denied' } : { available: true }
  } catch {
    return { available: true }
  }
}

export interface LocationRowText {
  readonly status: string
  readonly detail: string
}

// 사용 불가 원인별 준비 화면 문구. 원인(비보안·미지원·거부)은 코드로 이미 구분되어 있지만, 원인별 문구는 아직 확정되지 않았다.
// 그래서 세 원인 모두 현재 화면의 문구를 그대로 가리킨다. 디자인 문구표가 오면 이 표의 값만 바꾼다.
// TODO: 사용 불가 문구는 임시 문구(디자인 확인 필요)
const UNAVAILABLE_ROW_TEXT: Readonly<Record<LocationUnavailableReason, LocationRowText>> = {
  'insecure-context': { status: '사용할 수 없어요', detail: '시간만 기록할 수 있어요.' },
  unsupported: { status: '사용할 수 없어요', detail: '시간만 기록할 수 있어요.' },
  // 'permission-denied'는 엔진 쪽 이름이고, 이 화면의 권한 조회는 'denied'를 쓴다. 지금은 둘 다 같은 문구이다.
  'permission-denied': { status: '사용할 수 없어요', detail: '시간만 기록할 수 있어요.' },
  denied: { status: '사용할 수 없어요', detail: '시간만 기록할 수 있어요.' },
}

// 확인 중이면(null) 사용 가능으로 단정하지 않는다.
export function describeLocationReadiness(readiness: LocationReadiness | null): LocationRowText {
  if (readiness === null) return { status: '확인 중', detail: '위치 상태를 확인하고 있어요.' }
  if (readiness.available) return { status: '양호', detail: '거리와 페이스를 기록할 수 있어요.' }
  return UNAVAILABLE_ROW_TEXT[readiness.reason]
}

export interface ReadyActions {
  // 위치를 확인하기 전에는 러닝 시작을 누를 수 없다.
  readonly startDisabled: boolean
  // 위치를 쓸 수 없으면 "GPS 없이 시간만 기록"을 주된 버튼으로 강조한다. 자동으로 시작하지는 않는다.
  readonly timeEmphasized: boolean
}

export function getReadyActions(readiness: LocationReadiness | null): ReadyActions {
  return {
    startDisabled: readiness === null || !readiness.available,
    timeEmphasized: readiness !== null && !readiness.available,
  }
}
