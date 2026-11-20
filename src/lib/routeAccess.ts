import { getEntryPath } from './entryPath.ts'

// 직접 URL 입력과 새로고침에도 사용자의 진행 상태에 맞는 화면만 열리게 하는 접근 정책 (순수 함수).
// React, 라우터, Store를 알지 못한다. 상태를 읽어 이 함수에 넘기는 일은 앱 계층(app/entryFlow.ts)이 한다.
//
// 모든 보호 경로의 공통 우선순위
//   1) 온보딩 미완료 → Intro
//   2) 프로필 미완료 → 프로필 이어하기 경로
//   3) 위를 통과한 뒤 경로별 정책
// 경로별 정책
//   - 메인 탭(/home, /running, /running/..., /records, /growth, /my): 기초 측정을 완료했거나 이번 실행에서 Guide를 건너뛰었거나 뒤로 가기로 나왔을 때만 연다. 아니면 Guide.
//   - /measurement/guide, /measurement/active: 1)2)만 확인한다. (기초 측정 진행 중에는 완료 상태가 false인 것이 정상이다.)
//   - /measurement/result: 종료된 측정 세션이 있어야 연다. 없으면 기초 측정 완료 시 Home, 아니면 Guide.
// 이번 실행의 Guide 종료 기록은 메인 탭 접근만 허용한다. 기초 측정 완료로 취급하지 않는다. (결과 화면의 이동에서도 완료로 보지 않는다.)
// 종료된 세션이 있다는 사실도 기초 측정 완료로 인정하지 않는다. 완료는 baselineMeasurementCompleted만 뜻한다.
//
// 리다이렉트 목적지는 같은 상태에서 항상 접근 가능한 경로여서(아래 불변식), 가드끼리 서로 되돌려 보내는 순환이 생기지 않는다.
//   - Intro와 프로필 경로는 이 정책의 보호 대상이 아니다.
//   - Guide는 1)2)를 통과한 상태에서만 목적지가 되고, 그 상태에서 Guide는 항상 열린다.
//   - Home은 기초 측정 완료 상태에서만 목적지가 되고, 그 상태에서 Home은 항상 열린다.

export interface RouteAccessState {
  onboardingCompleted: boolean
  // 영구 저장된 기초 측정 완료 상태. Guide 종료 기록으로 바꾸지 않는다.
  baselineMeasurementCompleted: boolean
  // 프로필 Store에서 계산한 값. null이면 프로필을 완료한 것이다. (getProfileResumePath)
  profileResumePath: string | null
  // 이번 실행에서 Guide를 건너뛰었거나 뒤로 가기로 나왔는가.
  guideLeftThisRun: boolean
  // 종료된(finished) 측정 세션이 있는가.
  hasFinishedSession: boolean
}

export const MAIN_TAB_PATHS = ['/home', '/running', '/records', '/growth', '/my'] as const
export const MEASUREMENT_PATHS = ['/measurement/guide', '/measurement/active', '/measurement/result'] as const

const GUIDE_PATH = '/measurement/guide'
const HOME_PATH = '/home'

export type ProtectedRoute = (typeof MAIN_TAB_PATHS)[number] | (typeof MEASUREMENT_PATHS)[number]

// 라우터가 같은 경로로 인식하는 모양(대소문자, 인코딩, 끝의 "/", 겹친 "/")은 같은 경로로 본다.
// 호출하는 쪽에는 query와 hash를 뺀 pathname만 넘긴다.
function normalizePathname(pathname: string): string {
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // 잘못된 인코딩은 라우터도 일치시키지 못하므로 원문으로 판단한다.
  }
  return decoded.toLowerCase().replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1')
}

// 이 정책이 보호하는 경로이면 정규화한 경로를, 아니면 null을 돌려준다.
export function getProtectedRoute(pathname: string): ProtectedRoute | null {
  const path = normalizePathname(pathname)
  // 러닝 탭은 하위 화면(/running/time 등)이 있다. 직접 주소로 열어도 러닝 탭과 같은 접근 정책을 받는다.
  if (path.startsWith('/running/')) return '/running'
  const all: readonly string[] = [...MAIN_TAB_PATHS, ...MEASUREMENT_PATHS]
  return all.includes(path) ? (path as ProtectedRoute) : null
}

// 이 경로를 지금 상태에서 열 수 있으면 null, 열 수 없으면 대신 갈 경로를 돌려준다.
// 보호 대상이 아닌 경로는 항상 null이다.
export function getRouteRedirect(pathname: string, state: RouteAccessState): string | null {
  const route = getProtectedRoute(pathname)
  if (route === null) return null

  // 1)2) 공통 선행 단계. getEntryPath의 우선순위를 그대로 쓰고, 기초 측정은 완료한 것으로 두어 이 단계만 가려낸다.
  const prerequisite = getEntryPath(
    { onboardingCompleted: state.onboardingCompleted, baselineMeasurementCompleted: true },
    state.profileResumePath,
  )
  if (prerequisite !== HOME_PATH) return prerequisite

  const mainTabAllowed = state.baselineMeasurementCompleted || state.guideLeftThisRun

  switch (route) {
    case '/measurement/guide':
    case '/measurement/active':
      return null
    case '/measurement/result':
      if (state.hasFinishedSession) return null
      return state.baselineMeasurementCompleted ? HOME_PATH : GUIDE_PATH
    default:
      return mainTabAllowed ? null : GUIDE_PATH
  }
}
