import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getProfileResumePath, getStepFromPath, isStepAccessible } from '../profileFlow.ts'
import { profileStore } from '../profileStore.ts'
import { resolveProfileNextPath } from '../routes.ts'

// 프로필 가입 화면(/profile/...)의 접근 제어.
// 지금 상태에서 열 수 없는 단계에 들어오면(주소 직접 입력, 새로고침, 오래된 기록) 먼저 마쳐야 할 단계로 보낸다. (기록을 쌓지 않도록 replace)
// - 가입을 완료한 사용자는 어느 단계도 열 수 없다. 가입 뒤에 갈 곳으로 보낸다. (완료 후 뒤로 가기로 입력 화면에 다시 들어오지 못하게 한다.)
// - 가입 도중에는 동의 화면도 연다. 닉네임 화면에서 뒤로 가기로 돌아올 수 있어야 하기 때문이다.
// 가입 뒤에 갈 곳은 resolveNextPath로 받는다. 생략하면 임시 경로(resolveProfileNextPath)다. (Issue #42 D-2에서 실제 경로를 넘긴다.)
// Store는 화면이 열릴 때마다 최신 값을 읽는다. 단계를 이동하면 새 위치로 다시 판단한다.

export interface ProfileRouteProps {
  // 렌더 중에 불릴 수 있다(StrictMode에서는 두 번). 부수 효과 없는 순수 함수여야 한다.
  resolveNextPath?: () => string
}

export function ProfileStepGuard({ resolveNextPath = resolveProfileNextPath }: ProfileRouteProps) {
  const { pathname } = useLocation()
  const step = getStepFromPath(pathname)
  // 프로필 단계 경로가 아니면 이 가드가 판단하지 않는다. (이 가드 아래에는 프로필 단계 화면만 둔다.)
  if (step === null) return <Outlet />

  const state = profileStore.getState()
  if (isStepAccessible(step, state)) return <Outlet />
  return <Navigate to={getProfileResumePath(state) ?? resolveNextPath()} replace />
}

// /profile 로 들어오면 지금 상태에 맞는 화면으로 보낸다. 가입을 완료했으면 가입 뒤에 갈 곳이다.
export function ProfileEntryRedirect({ resolveNextPath = resolveProfileNextPath }: ProfileRouteProps) {
  return <Navigate to={getProfileResumePath(profileStore.getState()) ?? resolveNextPath()} replace />
}

export default ProfileStepGuard
