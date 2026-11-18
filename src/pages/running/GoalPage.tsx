import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { formatDuration, formatGoalChip, formatPace } from '../../features/running/format'
import {
  GOAL_DISTANCES,
  getDurationRangeSec,
  getTargetPaceSecPerKm,
  stepDurationSec,
} from '../../features/running/goal'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runSetupStore } from '../../features/running/runSetupStore'
import { runStore, useRunStore } from '../../features/running/runStore'

export function GoalPage() {
  const navigate = useNavigate()
  const draft = useRunStore((state) => state.draft)
  const { distanceKm, targetDurationSec, recentGoals } = draft
  const range = getDurationRangeSec(distanceKm)

  // 목표 화면에 들어오면 이후 단계(음악·준비 확인)는 다시 확정해야 한다.
  useEffect(() => {
    runSetupStore.getState().enterGoal()
  }, [])

  const step = useCallback(
    (direction: 1 | -1) => {
      const { draft: current } = runStore.getState()
      runStore.getState().setTargetDuration(stepDurationSec(current.distanceKm, current.targetDurationSec, direction))
    },
    [],
  )

  const handleNext = useCallback(() => {
    runSetupStore.getState().confirmGoal()
    navigate(RUN_PATHS.music)
  }, [navigate])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-4 pt-6">
        <h1 className="text-[36px] font-light leading-[44px] tracking-[-1.08px] text-ink">
          어떻게 달릴까요?
        </h1>

        <div role="radiogroup" aria-label="목표 거리" className="mt-6 flex gap-2">
          {GOAL_DISTANCES.map((km) => (
            <button
              key={km}
              type="button"
              role="radio"
              aria-checked={km === distanceKm}
              onClick={() => runStore.getState().setDistance(km)}
              className={`h-[40px] flex-1 cursor-pointer rounded-full text-[15px] font-medium ${
                km === distanceKm ? 'bg-ink text-app-bg' : 'bg-soft text-ink'
              }`}
            >
              {km} km
            </button>
          ))}
        </div>

        <p className="mt-6 text-[76px] font-light leading-[94px] tracking-[-2.28px] text-ink">
          {distanceKm}
          <span className="ml-2 text-[24px] tracking-normal text-muted">km</span>
        </p>

        <section className="mt-4 rounded-[24px] bg-soft p-4" aria-label="완주 시간">
          <p className="text-[14px] leading-5 text-muted">완주 시간</p>
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="1단위 줄이기"
              disabled={targetDurationSec <= range.min}
              onClick={() => step(-1)}
              className="flex size-[44px] cursor-pointer items-center justify-center rounded-full bg-app-bg text-[24px] text-ink disabled:cursor-not-allowed disabled:text-disabled-text"
            >
              −
            </button>
            <button
              type="button"
              aria-label="완주 시간 선택"
              onClick={() => navigate(RUN_PATHS.time)}
              className="cursor-pointer text-[40px] font-light leading-[48px] text-ink"
            >
              {formatDuration(targetDurationSec)}
            </button>
            <button
              type="button"
              aria-label="1단위 늘리기"
              disabled={targetDurationSec >= range.max}
              onClick={() => step(1)}
              className="flex size-[44px] cursor-pointer items-center justify-center rounded-full bg-app-bg text-[24px] text-ink disabled:cursor-not-allowed disabled:text-disabled-text"
            >
              +
            </button>
          </div>
          <p className="mt-2 text-[14px] leading-5 text-muted">
            목표 페이스{' '}
            <span className="font-medium text-ink">
              {formatPace(getTargetPaceSecPerKm(distanceKm, targetDurationSec))} /km
            </span>
          </p>
        </section>

        {recentGoals.length > 0 && (
          <section className="mt-6" aria-label="최근 목표">
            <h2 className="text-[14px] leading-5 text-muted">최근 목표</h2>
            <ul className="mt-2 flex gap-2">
              {recentGoals.map((goal) => (
                <li key={`${goal.distanceKm}-${goal.targetDurationSec}`}>
                  <button
                    type="button"
                    onClick={() => {
                      runStore.getState().setDistance(goal.distanceKm)
                      runStore.getState().setTargetDuration(goal.targetDurationSec)
                    }}
                    className="h-[36px] cursor-pointer rounded-full border border-line px-4 text-[14px] text-ink"
                  >
                    {formatGoalChip(goal.distanceKm, goal.targetDurationSec)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="px-3 pb-3">
        <PrimaryButton label="다음 · 음악 고르기" onClick={handleNext} />
      </div>
    </div>
  )
}

export default GoalPage
