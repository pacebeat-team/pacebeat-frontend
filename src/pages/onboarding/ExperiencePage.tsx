import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { ChoiceChip } from '../../components/onboarding/ChoiceChip'
import { ExperienceOption } from '../../components/onboarding/ExperienceOption'
import { StepIndicator } from '../../components/onboarding/StepIndicator'
import { canContinueFromExperience } from '../../lib/onboardingFlow'
import { useOnboardingStore } from '../../stores/onboardingStore'
import type { ExperienceLevel, WeeklyRuns } from '../../types/onboarding'

interface ExperienceChoice {
  value: ExperienceLevel
  title: string
  description: string
}

interface WeeklyRunsChoice {
  value: WeeklyRuns
  label: string
}

const EXPERIENCE_CHOICES: readonly ExperienceChoice[] = [
  { value: 'beginner', title: '거의 처음이에요', description: '1 km를 쉬지 않고 달리기 어려워요' },
  { value: 'occasional', title: '가끔 달려요', description: '3 km 정도 달려본 적 있어요' },
  { value: 'regular', title: '꾸준히 달려요', description: '주 2회 이상, 5 km 이상 달려요' },
]

const WEEKLY_RUNS_CHOICES: readonly WeeklyRunsChoice[] = [
  { value: '1', label: '1회' },
  { value: '2', label: '2회' },
  { value: '3+', label: '3회 이상' },
]

export function ExperiencePage() {
  const navigate = useNavigate()
  const experienceLevel = useOnboardingStore((state) => state.experienceLevel)
  const weeklyRuns = useOnboardingStore((state) => state.weeklyRuns)
  const setExperienceLevel = useOnboardingStore((state) => state.setExperienceLevel)
  const setWeeklyRuns = useOnboardingStore((state) => state.setWeeklyRuns)

  const handleBack = useCallback(() => {
    navigate('/onboarding/intro')
  }, [navigate])

  const handleNext = useCallback(() => {
    navigate('/onboarding/permissions')
  }, [navigate])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3">
        <ScreenHeader title="러닝 경험" onBack={handleBack} />

        <div className="mt-3">
          <StepIndicator current={1} total={3} />
        </div>

        <h2 className="mt-3 text-[36px] font-light leading-[46px] tracking-[-1.08px] text-ink">
          러닝은 얼마나
          <br />
          해보셨어요?
        </h2>
        <p className="mt-[10px] text-[14px] leading-5 text-muted">
          첫 목표를 추천할 때만 사용해요.
        </p>

        {/* 경험 수준: 필수 선택 */}
        <div
          role="radiogroup"
          aria-label="러닝 경험 수준"
          className="mt-[22px] flex flex-col divide-y divide-line"
        >
          {EXPERIENCE_CHOICES.map((choice) => (
            <ExperienceOption
              key={choice.value}
              title={choice.title}
              description={choice.description}
              selected={experienceLevel === choice.value}
              onSelect={() => setExperienceLevel(choice.value)}
            />
          ))}
        </div>

        {/* 주당 러닝 횟수: 선택 입력 */}
        <p className="mt-6 text-[16px] font-medium leading-[24px] text-ink">
          일주일에 몇 번 달릴까요?
        </p>
        <p className="mt-1 text-[13px] leading-[18px] text-muted">선택 항목이에요.</p>
        <div
          role="radiogroup"
          aria-label="주당 러닝 횟수"
          className="mt-3 flex w-full gap-3"
        >
          {WEEKLY_RUNS_CHOICES.map((choice) => (
            <ChoiceChip
              key={choice.value}
              label={choice.label}
              selected={weeklyRuns === choice.value}
              onSelect={() => setWeeklyRuns(choice.value)}
            />
          ))}
        </div>
      </div>

      <footer className="px-3 pb-[var(--footer-pb)] pt-2">
        <PrimaryButton label="다음" disabled={!canContinueFromExperience(experienceLevel)} onClick={handleNext} />
      </footer>
    </div>
  )
}

export default ExperiencePage
