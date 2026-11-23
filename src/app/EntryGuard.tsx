import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { resolveRouteRedirect } from './entryFlow'

// 메인 탭(/home, /running, /records, /growth, /my)과 측정 경로(/measurement/*)의 접근 제어.
// 직접 URL 입력이나 새로고침으로 지금 진행 상태에 맞지 않는 화면에 들어오면 먼저 마쳐야 할 화면으로 보낸다. (기록을 쌓지 않도록 replace)
// 접근 정책은 lib/routeAccess.ts가 정하고, 이 컴포넌트는 렌더할 때 그 시점의 상태로 판단해 Outlet 또는 Navigate를 돌려줄 뿐이다. (경로 이동 때 다시 판단한다. 같은 경로에서 부모가 다시 그려져도 판단하지만, Store 변화로 다시 그려지는 일은 없다.)
// - Store를 구독하지 않는다. 측정 Store가 갱신되어도(측정 중 매 틱) 다시 판단하지 않아 진행 중인 측정에 영향을 주지 않는다.
// - useBlocker를 쓰지 않는다. 라우터는 blocker를 하나만 지원하며, 그것은 GuidePage의 뒤로 가기 처리가 쓴다.
//   이 가드는 렌더 중 Navigate(REPLACE)만 하므로 그 blocker(POP만 잡는다)와 충돌하지 않는다.
// - 프로필 단계(/profile/...) 화면의 접근 제어는 ProfileStepGuard가 맡는다. 이 가드 아래에는 프로필 경로를 두지 않는다.
// 허용될 때는 자식 화면을 그대로 그리고, 거부될 때는 자식 화면을 그리지 않는다. (화면이 잠깐 보였다 사라지지 않는다.)
// 이동할 때 query와 hash는 유지하지 않는다. (?virtual, ?scenario 모드는 앱이 처음 로드될 때 한 번만 읽는다.)

export interface EntryGuardProps {
  // 렌더 중에 불릴 수 있다(StrictMode에서는 두 번). 부수 효과 없는 순수 함수여야 한다. 생략하면 실제 Store를 읽는다.
  resolveRedirect?: (pathname: string) => string | null
}

export function EntryGuard({ resolveRedirect = resolveRouteRedirect }: EntryGuardProps) {
  const { pathname } = useLocation()
  const target = resolveRedirect(pathname)
  if (target === null) return <Outlet />
  return <Navigate to={target} replace />
}

export default EntryGuard
