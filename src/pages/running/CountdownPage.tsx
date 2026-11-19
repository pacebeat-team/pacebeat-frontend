import { ScreenHeader } from '../../components/common/ScreenHeader'
import { useNavigate } from 'react-router-dom'
import { RUN_PATHS } from '../../features/running/runFlow'
import { useRunSetupStore } from '../../features/running/runSetupStore'

// 카운트다운과 세션 시작은 R3(#46)에서 구현한다. 지금은 시작 신호(모드)가 전달됐는지만 보여 주는 자리이다.
export function CountdownPage() {
  const navigate = useNavigate()
  const mode = useRunSetupStore((state) => state.mode)
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg px-6 pt-3 font-pace">
      <ScreenHeader title="카운트다운" onBack={() => navigate(RUN_PATHS.ready, { replace: true })} />
      <p className="mt-6 text-[16px] leading-6 text-muted">
        카운트다운은 다음 단계에서 구현돼요. (시작 신호: {mode === 'time' ? '시간만 기록' : 'GPS'})
      </p>
    </div>
  )
}

export default CountdownPage
