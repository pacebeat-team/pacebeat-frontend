import { useNavigate } from 'react-router-dom'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { TextButton } from '../../components/common/TextButton'
import { formatClock, formatDistanceKm2 } from '../../features/running/format'
import { canSaveRun } from '../../features/running/policy'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runLive, selectLiveMetrics, useRunLive } from '../../features/running/runLive'
import { runSetupStore } from '../../features/running/runSetupStore'
import { useRunStore } from '../../features/running/runStore'
import { RunFooter } from './RunFooter'
import { useRunClock } from './useRunClock'

// Figma `RUN / End confirm`. 종료 확인: 기록을 남기고 결과로 가거나, 계속 달린다.
// 60초 미만이면 기록을 남길 수 없으므로 계속 달리기 또는 저장하지 않고 종료만 고를 수 있다.
export function EndConfirmPage() {
  const navigate = useNavigate()
  const active = useRunStore((state) => state.activeSession)
  const gps = useRunLive((state) => state.gps)
  const now = useRunLive((state) => state.now)
  useRunClock(active?.session.status === 'running')

  if (active === null) return null
  const metrics = selectLiveMetrics(active, gps, now)
  if (metrics === null) return null
  const isTime = active.mode === 'time'
  const saveable = canSaveRun(metrics.elapsedMs)

  const keepRunning = () => navigate(RUN_PATHS.active, { replace: true })
  const finish = () => {
    runLive.stop('user')
    navigate(RUN_PATHS.result, { replace: true })
  }
  const discard = () => {
    runLive.discard()
    runSetupStore.getState().reset()
    navigate(RUN_PATHS.goal, { replace: true })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3 [&>*]:shrink-0">
        <ScreenHeader title="러닝 종료" onBack={keepRunning} />
        <h1 className="mt-4 text-[34px] font-light leading-[44px] tracking-[-1.02px]">
          여기까지
          <br />
          기록할까요?
        </h1>
        <p className="mt-10 flex items-baseline gap-[6px]">
          {isTime ? (
            <span className="text-[72px] font-light leading-[83px] tracking-[-2.16px]">{formatClock(metrics.elapsedMs)}</span>
          ) : (
            <>
              <span className="text-[72px] font-light leading-[83px] tracking-[-2.16px]">{formatDistanceKm2(metrics.distanceM ?? 0)}</span>
              <span className="text-[24px] leading-[29px]">km</span>
            </>
          )}
        </p>
        {saveable ? (
          <>
            <p className="mt-[18px] text-[22px] leading-[34px]">
              오늘 달린 만큼도
              <br />
              충분히 의미 있는 한 걸음이에요.
            </p>
            <p className="mt-5 text-[14px] leading-[23px] text-muted">종료하면 이번 러닝을 다시 이어갈 수 없어요.</p>
          </>
        ) : (
          <>
            <p className="mt-[18px] text-[22px] leading-[34px]">1분보다 짧은 러닝은 기록으로 남기지 않아요.</p>
            <p className="mt-5 text-[14px] leading-[23px] text-muted">조금 더 달리거나, 저장하지 않고 종료할 수 있어요.</p>
          </>
        )}
      </div>
      <RunFooter hasSecondary>
        {saveable ? (
          <>
            <PrimaryButton label="종료하고 기록 남기기" onClick={finish} />
            <TextButton label="아직 더 달릴게요" onClick={keepRunning} />
          </>
        ) : (
          <>
            <PrimaryButton label="종료하고 기록 남기기" disabled />
            <TextButton label="계속 달리기" onClick={keepRunning} className="!font-medium !text-ink" />
            <TextButton label="저장하지 않고 종료" onClick={discard} />
          </>
        )}
      </RunFooter>
    </div>
  )
}

export default EndConfirmPage
