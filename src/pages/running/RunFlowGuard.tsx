import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getRunSessionPhase, resolveRunRedirect } from '../../features/running/runFlow'
import { useRunStore } from '../../features/running/runStore'
import { useArrivalPending, useRunSaved } from '../../features/running/useRunPhase'
import { useRunSetupStore } from '../../features/running/runSetupStore'

// /running/* 접근 규칙: 선행 단계를 거치지 않은 직접 접근은 목표 화면으로 보낸다.
// 활성 세션이 있으면 세션 화면만 열린다(러닝 탭을 다시 누르면 진행·일시정지 화면으로 돌아온다).
export function RunFlowGuard() {
  const { pathname } = useLocation()
  const level = useRunSetupStore((state) => state.level)
  const phase = useRunStore((state) => getRunSessionPhase(state.activeSession?.session ?? null))
  const saved = useRunSaved()
  const arrivalPending = useArrivalPending()
  const redirect = resolveRunRedirect(pathname, level, phase, arrivalPending, saved)
  if (redirect !== null) return <Navigate to={redirect} replace />
  return <Outlet />
}

export default RunFlowGuard
