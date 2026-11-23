import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import mascot from '../../assets/images/mascot-p.png'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { TextButton } from '../../components/common/TextButton'
import { PROFILE_ROUTES } from '../../features/profile/routes'

interface Instruction {
  title: string
  description: string
}

const INSTRUCTIONS: readonly Instruction[] = [
  { title: '내 페이스 찾기', description: '편하게 달린 기록으로 기준을 만들어요.' },
  { title: '박자와 음성으로 달리기', description: '내 페이스에 맞는 음악을 골라요.' },
  { title: '완주 기록 쌓기', description: '작은 목표를 이룬 경험이 쌓여요.' },
]

export function IntroPage() {
  const navigate = useNavigate()

  const handleStart = useCallback(() => {
    navigate('/onboarding/experience')
  }, [navigate])

  // Figma: "계정 만들기"는 프로필 가입 동의 화면으로 이어진다. 인증은 아직 없어서 프로필 가입 흐름으로 들어가는 버튼으로 쓴다.
  // 동의 화면은 가입 전이면 항상 열 수 있어 온보딩을 마치기 전에도 막히지 않는다. 뒤로 가면 Intro로 돌아온다.
  const handleCreateAccount = useCallback(() => {
    navigate(PROFILE_ROUTES.consent)
  }, [navigate])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3">
        <p className="text-[23.5px] font-bold leading-[29px] text-ink">P!PACE</p>

        <h1 className="mt-5 text-[42px] font-light leading-[52px] tracking-[-1.26px] text-ink">
          처음부터,
          <br />
          내 페이스로.
        </h1>

        {/* Figma hero / introduction: 라임 그라데이션 카드 */}
        <section className="relative mt-6 h-[430px] w-full shrink-0 overflow-hidden rounded-[32px] bg-[linear-gradient(132.29deg,#c7fb29_1.09%,#d8ff7f_98.91%)] shadow-[inset_0_-3px_5px_rgba(71,102,13,0.16),inset_0_1.5px_2px_rgba(255,255,232,0.5)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(263px_331px_at_100%_0,rgba(255,255,224,0.38)_0%,rgba(255,255,229,0.12)_55%,rgba(255,255,229,0)_100%)]"
          />
          <img
            src={mascot}
            alt="P! 마스코트"
            className="pointer-events-none absolute right-4 top-[18px] h-[282px] w-[214px] object-contain"
          />
          <p className="absolute left-[22px] top-[286px] text-[19px] font-medium leading-[27px] text-ink">
            목표를 정하고,
            <br />
            무리 없이 완주해요.
          </p>
          <div className="absolute inset-x-3 bottom-3">
            <PrimaryButton label="시작하기" onClick={handleStart} />
          </div>
        </section>

        <ol className="mt-7 flex flex-col gap-[18px]">
          {INSTRUCTIONS.map((instruction, index) => (
            <li key={instruction.title} className="flex items-start gap-[14px]">
              <span className="flex size-[24px] shrink-0 items-center justify-center rounded-full bg-soft text-[13px] font-medium leading-[18px] text-ink">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[16px] font-medium leading-[24px] text-ink">
                  {instruction.title}
                </p>
                <p className="text-[14px] leading-5 text-muted">{instruction.description}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-6 text-[14px] leading-5 text-muted">
          계정 없이 먼저 둘러볼 수 있어요.
          <br />
          가입할 때 필요한 동의를 따로 안내해요.
        </p>
      </div>

      <footer className="px-3 pb-[9px] pt-2">
        <TextButton label="계정 만들기" onClick={handleCreateAccount} />
      </footer>
    </div>
  )
}

export default IntroPage
