import type { GpsStatus } from './types.ts'

// 측정 중 화면의 상태별 문구. 상태 → 문구 연결을 한곳에 모아 테스트할 수 있게 한 것이고, 문구 값은 기존 화면 그대로이다.
// TODO: Figma에는 "GPS 양호"만 디자인되어 있다. 나머지 상태의 문구는 임시이며 디자인 확인이 필요하다.
// 참고: 엔진은 'weak'를 만들지 않고(판정 기준 미정), 'unavailable'은 권한 거부·비보안·미지원을 구분하지 않는다.
export const GPS_ACTIVE_LABELS: Readonly<Record<GpsStatus, string>> = {
  good: '양호',
  weak: '약함',
  lost: '끊김',
  unavailable: '사용 불가',
}

// 상태가 없으면(검색 중) null: 호출한 쪽이 자리표시자를 보인다.
export function describeActiveGps(status: GpsStatus | null): string | null {
  return status === null ? null : GPS_ACTIVE_LABELS[status]
}

// 새로고침으로 복원된 세션의 GPS 재확인 안내. (TODO: Figma에 없는 상태라 문구는 임시)
export const RESTORE_HINT = {
  ready: 'GPS가 확인됐어요. 이어서 달릴 수 있어요.',
  waiting: 'GPS가 확인되면 이어갈 수 있어요.',
} as const

export function describeRestoreHint(canResume: boolean): string {
  return canResume ? RESTORE_HINT.ready : RESTORE_HINT.waiting
}
