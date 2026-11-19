import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { resolveRunRedirect } from '../../features/running/runFlow'
import { useRunSetupStore } from '../../features/running/runSetupStore'

// /running/* 접근 규칙: 선행 단계를 거치지 않은 직접 접근은 목표 화면으로 보낸다.
export function RunFlowGuard() {
  const { pathname } = useLocation()
  const level = useRunSetupStore((state) => state.level)
  const redirect = resolveRunRedirect(pathname, level)
  if (redirect !== null) return <Navigate to={redirect} replace />
  return <Outlet />
}

export default RunFlowGuard
