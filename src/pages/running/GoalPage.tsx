import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import runMinus from '../../assets/icons/run-minus.svg'
import runPlus from '../../assets/icons/run-plus.svg'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { useRecommended3KmGoal } from '../../features/home/useRecommendedGoal'
import { formatDistanceKm, formatDuration, formatGoalChip, formatPace } from '../../features/running/format'
import {
  GOAL_DISTANCES,
  getDurationRangeSec,
  getTargetPaceSecPerKm,
  stepDurationSec,
} from '../../features/running/goal'
import { buildStagePacePlan } from '../../features/running/recommendationPolicy'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runSetupStore } from '../../features/running/runSetupStore'
import { runStore, useRunStore } from '../../features/running/runStore'

const BASIS_LABELS = {
  recent_runs: '최근 28일 러닝 기록(60%) + 기준 페이스(40%) 반영',
  baseline: '기초 측정 기준 페이스(100%) 반영',
  onboarding: '온보딩 러닝 경험 · 주간 횟수 맞춤 추천',
  default_starter: 'P!PACE 기본 스타터 추천(7:00/km)',
} as const

// Figma `RUN / Goal`. P!PACE 4단계 추천 목표와 3구간(몸풀기·리듬 유지·후반 스퍼트) 목표 페이스 계획을 함께 안내한다.
export function GoalPage() {
  const navigate = useNavigate()
  const draft = useRunStore((state) => state.draft)
  const { distanceKm, targetDurationSec, recentGoals } = draft
  const range = getDurationRangeSec(distanceKm)
  const recommended = useRecommended3KmGoal()
  const targetPaceSec = getTargetPaceSecPerKm(distanceKm, targetDurationSec)
  const stagePlan = buildStagePacePlan(targetPaceSec)

  // 목표 화면에 들어오면 이후 단계(음악·준비 확인)는 다시 확정해야 한다.
  useEffect(() => {
    runSetupStore.getState().enterGoal()
  }, [])

  const applyRecommendedGoal = useCallback(() => {
    runStore.getState().setDistance(recommended.distanceKm)
    runStore.getState().setTargetDuration(recommended.targetDurationSec)
  }, [recommended.distanceKm, recommended.targetDurationSec])

  const step = useCallback((direction: 1 | -1) => {
    const { draft: current } = runStore.getState()
    runStore.getState().setTargetDuration(stepDurationSec(current.distanceKm, current.targetDurationSec, direction))
  }, [])

  const handleNext = useCallback(() => {
    runSetupStore.getState().confirmGoal()
    navigate(RUN_PATHS.music)
  }, [navigate])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3 [&>*]:shrink-0">
        <header className="sticky top-0 z-20 -mx-6 -mt-3 bg-app-bg/95 px-6 pb-2 pt-3 backdrop-blur-xs">
          <p className="text-[23.5px] font-bold leading-[29px] text-ink">P!PACE</p>
        </header>
        <h1 className="mt-2 text-[32px] font-light leading-[44px] tracking-[-0.96px] text-ink">어떻게 달릴까요?</h1>

        <section
          aria-label="목표 설정"
          className="relative mt-4 flex w-full shrink-0 flex-col overflow-hidden rounded-[34px] bg-[linear-gradient(143.35deg,#c7fb29_1.09%,#d8ff7f_98.91%)] p-[22px] shadow-[inset_0_-3px_5px_rgba(71,102,13,0.16),inset_0_1.5px_2px_rgba(255,255,232,0.5)]"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(263px_224px_at_100%_0,rgba(255,255,224,0.38)_0%,rgba(255,255,229,0.12)_55%,rgba(255,255,229,0)_100%)]"
          />
          <div role="radiogroup" aria-label="목표 거리" className="relative flex h-[44px] gap-2">
            {GOAL_DISTANCES.map((km) => (
              <button
                key={km}
                type="button"
                role="radio"
                aria-checked={km === distanceKm}
                onClick={() => runStore.getState().setDistance(km)}
                className={`flex h-[44px] flex-1 cursor-pointer items-center justify-center rounded-[22px] text-[15px] font-medium leading-[21px] ${
                  km === distanceKm ? 'bg-ink text-app-bg' : 'bg-app-bg text-ink'
                }`}
              >
                {km} km
              </button>
            ))}
          </div>

          <p className="relative mt-[18px] flex h-[81px] items-baseline gap-[6px] text-ink">
            <span className="inline-block min-w-[93px] text-[70px] font-light leading-[81px] tracking-[-2.1px]">{formatDistanceKm(distanceKm)}</span>
            <span className="text-[24px] leading-[29px]">km</span>
          </p>

          <div className="relative mt-[10px] flex h-[54px] items-center gap-[10px]">
            <p className="text-[15px] leading-[21px] text-ink">완주 시간</p>
            <div className="flex-1" />
            <button
              type="button"
              aria-label="완주 시간 줄이기"
              disabled={targetDurationSec <= range.min}
              onClick={() => step(-1)}
              className="flex size-[44px] shrink-0 cursor-pointer items-center justify-center rounded-[22px] bg-app-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <img src={runMinus} alt="" className="size-[22px]" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="완주 시간 선택"
              onClick={() => navigate(RUN_PATHS.time)}
              className="cursor-pointer text-[29px] font-medium leading-[40px] text-ink"
            >
              {formatDuration(targetDurationSec)}
            </button>
            <button
              type="button"
              aria-label="완주 시간 늘리기"
              disabled={targetDurationSec >= range.max}
              onClick={() => step(1)}
              className="flex size-[44px] shrink-0 cursor-pointer items-center justify-center rounded-[22px] bg-app-bg disabled:cursor-not-allowed disabled:opacity-40"
            >
              <img src={runPlus} alt="" className="size-[22px]" aria-hidden="true" />
            </button>
          </div>

          <p className="relative mt-[14px] whitespace-pre text-[17px] font-medium leading-[26px] text-ink">
            {`목표 페이스  ${formatPace(targetPaceSec)} /km`}
          </p>

          <div className="relative mt-3 rounded-[18px] bg-white/55 px-3.5 py-2.5 text-[13px] leading-[19px] text-ink">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{BASIS_LABELS[recommended.basis]}</span>
              {(distanceKm !== recommended.distanceKm || targetDurationSec !== recommended.targetDurationSec) && (
                <button
                  type="button"
                  onClick={applyRecommendedGoal}
                  className="shrink-0 cursor-pointer rounded-full bg-ink px-2.5 py-0.5 text-[12px] font-medium text-app-bg"
                >
                  추천 {formatGoalChip(recommended.distanceKm, recommended.targetDurationSec)} 적용
                </button>
              )}
            </div>
            <p className="mt-1 text-[12px] text-[#455116]">
              3구간 계획: 몸풀기(0~15%) {formatPace(stagePlan.warmupPaceSecPerKm)}/km · 리듬(15~85%) {formatPace(stagePlan.rhythmPaceSecPerKm)}/km · 85% 이후 실시간 페이스
            </p>
          </div>
        </section>

        <PrimaryButton label="다음 · 음악 고르기" onClick={handleNext} className="mt-[18px] shrink-0" />

        {recentGoals.length > 0 && (
          <section aria-label="최근 목표" className="mt-5">
            <h2 className="text-[15px] font-medium leading-[21px] text-ink">최근 목표</h2>
            <ul className="flex gap-[10px]">
              {recentGoals.map((goal) => (
                <li key={`${goal.distanceKm}-${goal.targetDurationSec}`} className="flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      runStore.getState().setDistance(goal.distanceKm)
                      runStore.getState().setTargetDuration(goal.targetDurationSec)
                    }}
                    className="flex h-[44px] w-full cursor-pointer items-center justify-center rounded-[22px] bg-soft text-[15px] font-medium leading-[21px] text-ink"
                  >
                    {formatGoalChip(goal.distanceKm, goal.targetDurationSec)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

export default GoalPage
