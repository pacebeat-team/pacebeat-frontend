import { Navigate, useNavigate } from 'react-router-dom'
import chevronRight from '../../assets/icons/chevron-right.svg'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { formatClock, formatDistanceKm2, formatDuration, formatPaceOrDash } from '../../features/running/format'
import { RUN_PATHS } from '../../features/running/runFlow'
import { getPaceKeepPercent, getTargetTimeDeltaSec } from '../../features/running/runResult'
import { AchievementCard, DifficultyChips, SaveFooter, SplitRows, Stat } from './ResultShared'
import { useFinishedRun, useSaveAndGo } from './resultHooks'

function deltaText(deltaSec: number, targetSec: number): string {
  const abs = Math.abs(deltaSec)
  const amount = abs < 60 ? `${abs}초` : `${Math.floor(abs / 60)}분 ${abs % 60}초`
  if (deltaSec === 0) return `거리 완주 · 목표 ${formatDuration(targetSec)}에 맞춰 달렸어요.`
  return deltaSec > 0
    ? `거리 완주 · 목표 ${formatDuration(targetSec)}보다 ${amount} 더 달렸어요.`
    : `거리 완주 · 목표 ${formatDuration(targetSec)}보다 ${amount} 빨랐어요.`
}

// Figma `RESULT / Details`: 완주 결과의 구간별 기록과 다음 목표.
export function ResultDetailsPage() {
  const navigate = useNavigate()
  const finished = useFinishedRun()
  if (finished === null || finished.summary.completion !== 'goal') return <Navigate to={RUN_PATHS.result} replace />
  const { summary } = finished
  const goal = summary.goal
  const keep = getPaceKeepPercent(summary)
  const delta = getTargetTimeDeltaSec(summary)
  const targetKm = goal.targetDistanceKm ?? 0
  const targetSec = goal.targetDurationSec ?? 0

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3 [&>*]:shrink-0">
        <ScreenHeader title="구간별 기록" onBack={() => navigate(RUN_PATHS.result, { replace: true })} />
        <h1 className="mt-4 text-[34px] font-light leading-[44px] tracking-[-1.02px]">{targetKm} km, 끝까지!</h1>
        {delta !== null && <p className="mt-4 text-[15px] leading-6 text-muted">{deltaText(delta, targetSec)}</p>}
        <div className="mt-5">
          <AchievementCard>
            <p className="flex items-baseline gap-[6px]">
              <span className="text-[66px] font-light leading-[76px] tracking-[-1.98px]">{formatDistanceKm2(summary.distanceM ?? 0)}</span>
              <span className="text-[22px] leading-[31px]">km</span>
            </p>
            <p className="text-[14px] leading-[22px]">
              목표 {targetKm.toFixed(2)} km · {formatDuration(targetSec)}
            </p>
            <div className="mt-[18px] flex h-[62px] items-center gap-[18px]">
              <Stat label="러닝 시간" value={formatClock(summary.elapsedMs)} />
              <Stat label="평균 페이스" value={formatPaceOrDash(summary.avgPaceSecPerKm)} />
            </div>
          </AchievementCard>
        </div>
        {keep !== null && (
          <>
            <div className="mt-6 flex h-[52px] items-center gap-3">
              <p className="text-[16px] leading-[22px]">목표 페이스 유지</p>
              <span className="flex-1" />
              <p className="text-[30px] font-light leading-9 tracking-[-0.9px]">{keep}%</p>
            </div>
            <p className="text-[13px] leading-[19px] text-muted">목표 범위 안에서 달린 시간의 비율</p>
          </>
        )}
        {summary.splits.length > 0 && (
          <>
            <p className="mt-[22px] text-[17px] font-medium leading-6">구간별 페이스</p>
            <div className="mt-2">
              <SplitRows splits={summary.splits} />
            </div>
          </>
        )}
        <p className="mt-[18px] text-[19px] font-medium leading-[27px]">오늘 러닝은 어땠나요?</p>
        <div className="mt-3">
          <DifficultyChips />
        </div>
        <NextGoal targetKm={targetKm} targetSec={targetSec} />
      </div>
      <SaveFooter />
    </div>
  )
}

// 다음 목표: 같은 목표로 한 번 더. 결과를 저장한 뒤 목표 화면으로 간다(저장 전에 나가면 기록이 사라지기 때문).
function NextGoal({ targetKm, targetSec }: { targetKm: number; targetSec: number }) {
  const saveAndGo = useSaveAndGo()
  return (
    <button
      type="button"
      onClick={() => saveAndGo(RUN_PATHS.goal)}
      className="mt-[22px] flex h-16 w-full cursor-pointer items-center gap-3 text-left"
    >
      <span className="flex-1 text-[16px] leading-6">다음 목표</span>
      <span className="text-[14px] leading-[22px] text-muted">
        {targetKm} km · {formatDuration(targetSec)} 한 번 더
      </span>
      <img src={chevronRight} alt="" aria-hidden="true" className="size-5" />
    </button>
  )
}

export default ResultDetailsPage
