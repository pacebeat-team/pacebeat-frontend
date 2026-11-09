import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import homeMascot from '../../assets/images/home-mascot.webp'
import {
  BackHeader,
  CheckCircleIcon,
  FixedFooter,
  PrimaryButton,
  StepProgress,
} from '../../components/onboarding/OnboardingUI'
import {
  type RunningExperience,
  type WeeklyFrequency,
  useOnboardingStore,
} from '../../features/onboarding/onboardingStore'

const EXPERIENCES: Array<{
  value: RunningExperience
  title: string
  description: string
}> = [
  { value: 'beginner', title: '거의 처음이에요', description: '1 km를 쉬지 않고 달리기 어려워요' },
  { value: 'occasional', title: '가끔 달려요', description: '3 km 정도 달려본 적 있어요' },
  { value: 'regular', title: '꾸준히 달려요', description: '주 2회 이상, 5 km 이상 달려요' },
]

const FREQUENCIES: Array<{ value: WeeklyFrequency; label: string }> = [
  { value: 1, label: '1회' },
  { value: 2, label: '2회' },
  { value: '3+', label: '3회 이상' },
]

function Instruction({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex gap-3.5">
      <span className="font-poppins flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f4f4f6] text-[13px] font-medium">
        {number}
      </span>
      <div>
        <p className="text-[16px] font-medium leading-6">{title}</p>
        <p className="mt-1 text-[14px] leading-5 text-[#626174]">{description}</p>
      </div>
    </div>
  )
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <path d="M4 18v2M8 14v6M12 10v10M16 6v14M20 3v17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function RunningIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <circle cx="15.5" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12.5 8l3 2.5 3.5.5M13 9l-3 4-4-1M12 13l3 3-1 5M10 13l-3 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M4 10v4h4l5 4V6L8 10H4zM17 9a4 4 0 010 6M19 6a8 8 0 010 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MusicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M9 18V6l10-2v12M9 9l10-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6.5" cy="18" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16.5" cy="16" r="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function OnboardingIntroPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-full w-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-[calc(24px+env(safe-area-inset-top,0px))]">
        <p className="font-poppins text-[23.5px] font-bold leading-[29px]">P!PACE</p>
        <h1 className="mt-5 text-[42px] font-light leading-[52px] tracking-[-1.26px]">
          처음부터,
          <br />
          내 페이스로.
        </h1>

        <section className="relative mt-6 h-[430px] overflow-hidden rounded-[32px] bg-[radial-gradient(circle_at_100%_0%,rgba(255,255,224,0.38),rgba(255,255,229,0.12)_32%,transparent_62%),linear-gradient(132deg,#c7fb29_0%,#d8ff7f_100%)] p-3 shadow-[inset_0_-3px_5px_rgba(71,102,13,0.16),inset_0_1.5px_2px_rgba(255,255,232,0.5),0_6px_14px_-4px_rgba(71,102,13,0.12)]">
          <img
            src={homeMascot}
            alt="P!PACE 캐릭터"
            className="absolute right-3 top-[18px] h-[282px] w-[214px] object-contain"
          />
          <p className="absolute left-[22px] top-[286px] text-[19px] font-medium leading-[27px]">
            목표를 정하고,
            <br />
            무리 없이 완주해요.
          </p>
          <button
            type="button"
            onClick={() => navigate('/onboarding/experience')}
            className="absolute bottom-3 left-3 right-3 flex h-16 items-center rounded-full bg-[#111] pl-7 pr-3 text-left text-[18px] font-medium text-white active:scale-[0.99]"
          >
            <span className="flex-1">시작하기</span>
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-2xl text-[#111]">→</span>
          </button>
        </section>

        <div className="mt-7 space-y-[18px]">
          <Instruction number={1} title="내 페이스 찾기" description="편하게 달린 기록으로 기준을 만들어요." />
          <Instruction number={2} title="박자와 음성으로 달리기" description="내 페이스에 맞는 음악을 골라요." />
          <Instruction number={3} title="완주 기록 쌓기" description="작은 목표를 이룬 경험이 쌓여요." />
        </div>

        <p className="mt-6 text-[14px] leading-5 text-[#626174]">
          계정 없이 먼저 둘러볼 수 있어요.
          <br />
          가입할 때 필요한 동의를 따로 안내해요.
        </p>
      </div>
      <FixedFooter>
        <button type="button" className="h-11 w-full text-[14px] text-[#626174]">계정 만들기</button>
      </FixedFooter>
    </div>
  )
}

export function OnboardingExperiencePage() {
  const navigate = useNavigate()
  const { experience, weeklyFrequency, setExperience, setWeeklyFrequency } = useOnboardingStore()

  return (
    <div className="flex min-h-full w-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-[calc(12px+env(safe-area-inset-top,0px))]">
        <BackHeader title="러닝 경험" />
        <div className="mt-3"><StepProgress current={1} /></div>
        <h1 className="mt-3 text-[36px] font-light leading-[46px] tracking-[-1.08px]">
          러닝은 얼마나
          <br />
          해보셨어요?
        </h1>
        <p className="mt-2.5 text-[14px] leading-5 text-[#626174]">첫 목표를 추천할 때만 사용해요.</p>

        <div className="mt-[22px]">
          {EXPERIENCES.map((option, index) => {
            const selected = experience === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setExperience(option.value)}
                className={`flex h-[84px] w-full items-center gap-3.5 text-left ${index ? 'border-t border-[#dedee5]' : ''}`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-[#baff2a] bg-[#baff2a]' : 'border-[#dedee5]'}`}>
                  {selected && <span className="h-3 w-3 rounded-full bg-[#253000]" />}
                </span>
                <span>
                  <span className="block text-[18px] font-medium leading-6">{option.title}</span>
                  <span className="mt-[5px] block text-[14px] leading-5 text-[#626174]">{option.description}</span>
                </span>
              </button>
            )
          })}
        </div>

        <p className="mt-6 text-[16px] font-medium leading-6">일주일에 몇 번 달릴까요?</p>
        <p className="mt-1 text-[13px] leading-[18px] text-[#626174]">선택 항목이에요.</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {FREQUENCIES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setWeeklyFrequency(option.value)}
              className={`h-11 rounded-full text-[14px] font-medium ${weeklyFrequency === option.value ? 'bg-[#baff2a]' : 'bg-[#f4f4f6]'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <FixedFooter>
        <PrimaryButton disabled={!experience} onClick={() => navigate('/onboarding/permissions')}>다음</PrimaryButton>
      </FixedFooter>
    </div>
  )
}

export function OnboardingPermissionsPage() {
  const navigate = useNavigate()
  const setPermissionsReviewed = useOnboardingStore((state) => state.setPermissionsReviewed)

  const continueToMeasurement = (reviewed: boolean) => {
    setPermissionsReviewed(reviewed)
    navigate('/onboarding/measurement')
  }

  return (
    <div className="flex min-h-full w-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto px-6 pb-5 pt-[calc(12px+env(safe-area-inset-top,0px))]">
        <BackHeader title="권한 안내" />
        <div className="mt-3"><StepProgress current={2} /></div>
        <h1 className="mt-3 text-[36px] font-light leading-[46px] tracking-[-1.08px]">
          달리는 동안
          <br />
          필요한 것들
        </h1>
        <p className="mt-2.5 text-[14px] leading-5 text-[#626174]">허용하지 않아도 앱은 쓸 수 있어요.</p>

        <div className="mt-6 divide-y divide-[#dedee5]">
          <div className="flex gap-5 pb-6">
            <LocationIcon />
            <div>
              <p className="text-[18px] font-medium leading-6">위치</p>
              <p className="mt-2 text-[13px] leading-[18px] text-[#626174]">거리·페이스 기록에 필요</p>
              <p className="mt-3 text-[14px] leading-[22px] text-[#626174]">
                러닝 중 이동한 거리와 페이스를 계산해요.
                <br />허용하지 않으면 시간만 기록해요.
              </p>
            </div>
          </div>
          <div className="flex gap-5 py-6">
            <RunningIcon />
            <div>
              <p className="text-[18px] font-medium leading-6">동작 및 피트니스</p>
              <p className="mt-2 text-[13px] leading-[18px] text-[#626174]">선택 · 지원 기기에서만</p>
              <p className="mt-3 text-[14px] leading-[22px] text-[#626174]">
                발걸음으로 케이던스를 측정해요.
                <br />지원하지 않는 기기에서는 생략돼요.
              </p>
            </div>
          </div>
        </div>

        <p className="mt-5 text-[13px] leading-5 text-[#626174]">
          위치 기록은 러닝 중에만 남겨요.
          <br />마이의 데이터 관리에서 조회하거나 지울 수 있어요.
        </p>
        <p className="mt-4 flex items-center gap-2 text-[13px] leading-5 text-[#626174]">
          <VolumeIcon />음악·음성 안내는 앱 안에서 설정해요.
        </p>
      </div>
      <FixedFooter>
        <PrimaryButton onClick={() => continueToMeasurement(true)}>권한 확인하고 계속</PrimaryButton>
        <button type="button" onClick={() => continueToMeasurement(false)} className="mt-1 h-11 w-full text-[14px] text-[#626174]">
          나중에 할게요
        </button>
      </FixedFooter>
    </div>
  )
}

export function MeasurementGuidePage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-full w-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto px-6 pb-5 pt-[calc(12px+env(safe-area-inset-top,0px))]">
        <BackHeader title="기초 측정" />
        <h1 className="mt-5 text-[36px] font-light leading-[46px] tracking-[-1.08px]">
          10분만 편하게
          <br />달려볼까요?
        </h1>

        <section className="relative mt-5 h-[204px] overflow-hidden rounded-[32px] bg-[radial-gradient(circle_at_100%_0%,rgba(255,255,224,0.45),transparent_58%),linear-gradient(132deg,#c7fb29,#d8ff7f)] px-4 py-5 shadow-[inset_0_-3px_5px_rgba(71,102,13,0.16),0_6px_14px_-4px_rgba(71,102,13,0.14)]">
          <span className="font-poppins text-[70px] font-light leading-none tracking-[-4px]">10:00</span>
          <img src={homeMascot} alt="" className="absolute right-4 top-7 h-[126px] w-[96px] object-contain" />
        </section>

        <p className="mt-6 text-[18px] font-medium leading-7">
          대화할 수 있는 속도로
          <br />숨이 차면 걸어도 괜찮아요.
        </p>

        <div className="mt-6 space-y-5 border-t border-[#dedee5] pt-5">
          <Instruction number={1} title="폰은 손이나 암밴드에" description="평소 편하게 움직이는 자세로 달려요." />
          <Instruction number={2} title="10분이 지나면 자동으로 끝나요" description="중간에 그만둘 수도 있어요." />
        </div>
        <p className="mt-7 text-[14px] leading-5 text-[#626174]">기준 페이스와 케이던스를 확인하고 첫 목표를 추천해요.</p>
      </div>
      <FixedFooter>
        <PrimaryButton onClick={() => navigate('/onboarding/measurement/active')}>측정 러닝 시작</PrimaryButton>
        <button type="button" onClick={() => navigate('/home')} className="mt-1 h-11 w-full text-[14px] text-[#626174]">건너뛰고 둘러보기</button>
      </FixedFooter>
    </div>
  )
}

export function MeasurementActivePage() {
  const navigate = useNavigate()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((value) => Math.min(value + 1, 600)), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (elapsed >= 600) navigate('/onboarding/measurement/result', { replace: true })
  }, [elapsed, navigate])

  const formattedTime = useMemo(() => {
    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0')
    const seconds = (elapsed % 60).toString().padStart(2, '0')
    return `${minutes}:${seconds}`
  }, [elapsed])

  const distance = Math.max(0, elapsed * 0.00225)
  const progress = Math.min(100, (elapsed / 600) * 100)

  return (
    <div className="relative flex min-h-full w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_100%_0%,rgba(255,255,224,0.55),transparent_55%),linear-gradient(145deg,#baff2a,#d8ff7f)] px-6 pb-[calc(24px+env(safe-area-inset-bottom,0px))] pt-[calc(28px+env(safe-area-inset-top,0px))] text-[#111]">
      <div className="flex items-center justify-between text-[14px]">
        <span className="font-medium">●&nbsp; 기초 측정 중</span>
        <span>GPS 양호</span>
      </div>

      <div className="mt-14">
        <span className="font-poppins text-[78px] font-light leading-none tracking-[-4px]">{formattedTime}</span>
        <p className="font-poppins mt-3 text-[24px] font-light">/ 10:00</p>
        <div className="mt-7 h-1 w-full overflow-hidden rounded-full bg-white/70">
          <div className="h-full rounded-full bg-[#111] transition-[width] duration-1000" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mt-10 flex items-center gap-7">
        <img src={homeMascot} alt="" className="h-[88px] w-[68px] object-contain" />
        <p className="text-[18px] font-medium leading-7">대화할 수 있을 정도로<br />편하게 달려 주세요.</p>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-y-7">
        <div>
          <p className="text-[13px]">거리</p>
          <p className="font-poppins mt-2 text-[32px] font-light">{distance.toFixed(2)} <span className="text-[14px]">km</span></p>
        </div>
        <div>
          <p className="text-[13px]">현재 페이스</p>
          <p className="font-poppins mt-2 text-[32px] font-light">7′24″ <span className="text-[14px]">/km</span></p>
        </div>
        <div>
          <p className="text-[13px]">케이던스</p>
        </div>
        <p className="font-poppins text-right text-[20px]">156 spm</p>
      </div>

      <div className="mt-7 border-t border-[#111] pt-4">
        <p className="flex items-center gap-3 text-[15px] font-medium"><MusicIcon />박자 안내 꺼짐</p>
        <p className="mt-2 pl-8 text-[12px]">측정 중에는 박자를 맞추지 않아요.</p>
      </div>

      <button type="button" onClick={() => navigate('/onboarding/measurement/result')} className="mt-auto h-11 text-[14px] text-[#626174]">측정 그만하기</button>
      <p className="text-[12px]">2분 이상 기록부터 저장 · 예시 기준</p>
    </div>
  )
}

export function MeasurementResultPage() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-full w-full flex-col bg-white">
      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-[calc(12px+env(safe-area-inset-top,0px))]">
        <BackHeader title="기초 측정 결과" />
        <h1 className="mt-5 text-[36px] font-light leading-[46px] tracking-[-1.08px]">나의 기준을<br />찾았어요.</h1>

        <section className="mt-5 rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_100%_0%,rgba(255,255,255,0.12),transparent_55%),linear-gradient(145deg,#151712,#0b0d09)] px-6 py-5 text-white shadow-[0_7px_12px_-3px_rgba(0,0,0,0.24),inset_0_2px_3px_rgba(255,255,255,0.18)]">
          <p className="text-[14px]">기준 페이스</p>
          <p className="font-poppins mt-2 text-[54px] font-light leading-none">7′20″ <span className="text-[22px]">/km</span></p>
          <div className="mt-5 h-[3px] rounded-full bg-[#baff2a]" />
        </section>

        <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-7">
          <div><p className="text-[13px] text-[#626174]">달린 거리</p><p className="font-poppins mt-2 text-[31px] font-light">1.34 <span className="text-[14px]">km</span></p></div>
          <div><p className="text-[13px] text-[#626174]">소요 시간</p><p className="font-poppins mt-2 text-[31px] font-light">9:48</p></div>
          <div><p className="text-[13px] text-[#626174]">케이던스</p><p className="font-poppins mt-2 text-[31px] font-light">158 <span className="text-[14px]">spm</span></p></div>
          <div><p className="text-[13px] text-[#626174]">평균 보폭</p><p className="font-poppins mt-2 text-[31px] font-light">0.83 <span className="text-[14px]">m</span></p></div>
        </div>

        <p className="mt-5 flex items-center gap-2 text-[12px] text-[#626174]"><CheckCircleIcon className="h-5 w-5" />예시 측정 · 품질 양호 · GPS 안정</p>
        <div className="mt-6 border-t border-[#dedee5] pt-5">
          <p className="text-[13px] text-[#626174]">첫 목표</p>
          <p className="font-poppins mt-2 text-[27px] font-light">3 km · 22:00</p>
        </div>
      </div>
      <FixedFooter>
        <PrimaryButton onClick={() => navigate('/running')}>이 목표로 시작</PrimaryButton>
      </FixedFooter>
    </div>
  )
}
