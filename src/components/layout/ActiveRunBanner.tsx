import { Link } from 'react-router-dom'
import { formatClock } from '../../features/running/format'
import { getRunReturnPath, getRunSessionPhase } from '../../features/running/runFlow'
import { selectLiveMetrics, useRunLive } from '../../features/running/runLive'
import { useRunStore } from '../../features/running/runStore'
import { useRunClock } from '../../pages/running/useRunClock'

// 다른 메인 탭에 있는 동안 러닝 세션이 진행 중임을 알리고 돌아갈 수 있게 하는 상단 바.
export function ActiveRunBanner() {
  const active = useRunStore((state) => state.activeSession)
  const gps = useRunLive((state) => state.gps)
  const now = useRunLive((state) => state.now)
  const phase = getRunSessionPhase(active?.session ?? null)
  useRunClock(phase === 'active' && active?.session.status === 'running')
  if (active === null || phase === 'none') return null
  const metrics = selectLiveMetrics(active, gps, now)
  const label = phase === 'finished' ? '러닝 종료' : active.session.status === 'paused' ? '일시정지' : '러닝 중'
  return (
    <Link
      to={getRunReturnPath(phase)}
      aria-label={`${label}, 경과 시간 ${formatClock(metrics?.elapsedMs ?? 0)}, 돌아가기`}
      className="mx-3 mb-1 mt-1 flex h-[40px] shrink-0 items-center justify-between rounded-full bg-lime px-4 font-pace text-[14px] font-medium leading-5 text-ink"
    >
      <span>
        {label} · {formatClock(metrics?.elapsedMs ?? 0)}
      </span>
      <span>돌아가기</span>
    </Link>
  )
}

export default ActiveRunBanner
