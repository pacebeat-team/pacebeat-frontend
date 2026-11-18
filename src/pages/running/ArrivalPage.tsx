import { useEffect } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { RUN_PATHS } from '../../features/running/runFlow'
import { useFinishedRun } from './resultHooks'
import { GoalResult } from './ResultPage'

const ARRIVAL_MS = 800

// Figma `GOAL / Arrival`: 거리 목표를 채우고 끝났을 때 0.8초 동안 보여 주는 도착 화면. 이후 완주 결과로 넘어간다.
export function ArrivalPage() {
  const navigate = useNavigate()
  const finished = useFinishedRun()
  const arrived = finished !== null && finished.summary.completion === 'goal'
  useEffect(() => {
    if (!arrived) return undefined
    const id = window.setTimeout(() => navigate(RUN_PATHS.result, { replace: true }), ARRIVAL_MS)
    return () => window.clearTimeout(id)
  }, [arrived, navigate])
  if (finished === null) return <Navigate to={RUN_PATHS.goal} replace />
  if (!arrived) return <Navigate to={RUN_PATHS.result} replace />
  return <GoalResult summary={finished.summary} arrival />
}

export default ArrivalPage
