import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { RUN_PATHS } from '../../features/running/runFlow'
import { useFinishedRun } from './resultHooks'
import { ARRIVAL_SETTLE_MS, GoalResult } from './ResultPage'

const ARRIVAL_MS = 800

// Figma `GOAL / Arrival`: 거리 목표를 채우고 끝났을 때 0.8초 동안 보여 주는 도착 화면.
// 이후 0.4초(스마트 애니메이트, ease-in-out) 동안 마스코트·색종이가 완주 화면 자리로 움직이고, 끝나면 완주 결과로 넘어간다.
export function ArrivalPage() {
  const navigate = useNavigate()
  const finished = useFinishedRun()
  const arrived = finished !== null && finished.summary.completion === 'goal'
  const [settling, setSettling] = useState(false)
  useEffect(() => {
    if (!arrived) return undefined
    const settle = window.setTimeout(() => setSettling(true), ARRIVAL_MS)
    const leave = window.setTimeout(
      () => navigate(RUN_PATHS.result, { replace: true, state: { fromArrival: true } }),
      ARRIVAL_MS + ARRIVAL_SETTLE_MS,
    )
    return () => {
      window.clearTimeout(settle)
      window.clearTimeout(leave)
    }
  }, [arrived, navigate])
  if (finished === null) return <Navigate to={RUN_PATHS.goal} replace />
  if (!arrived) return <Navigate to={RUN_PATHS.result} replace />
  return <GoalResult summary={finished.summary} arrival={!settling} />
}

export default ArrivalPage
