import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import mascot from '../../assets/images/mascot-p.png'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { TextButton } from '../../components/common/TextButton'
import { formatClock, formatWholeMinutes } from '../../features/measurementView/format'
import { useMeasurementView } from '../../features/measurementView/useMeasurementView'

export function GuidePage() {
  const navigate = useNavigate()
  const { view, actions } = useMeasurementView()
  const minutes = formatWholeMinutes(view.guide.targetDurationSec)

  const handleBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

  const handleStart = useCallback(() => {
    actions.start()
    navigate('/measurement/active')
  }, [actions, navigate])

  const handleSkip = useCallback(() => {
    // TODO: Figma는 HOME / Arrival로 이동한다. 해당 화면이 없어 /home으로 이동한다. (목적지 기획 확인 필요)
    navigate('/home')
  }, [navigate])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3">
        <ScreenHeader title="기초 측정" onBack={handleBack} />

        <h2 className="mt-4 text-[36px] font-light leading-[44px] tracking-[-1.08px] text-ink">
          {minutes ? `${minutes}만 편하게` : '편하게'}
          <br />
          달려볼까요?
        </h2>

        {/* Figma hero / baseline duration: 측정 시간 카드 */}
        <section className="relative mt-4 h-[204px] w-full shrink-0 overflow-hidden rounded-[28px] bg-[linear-gradient(152.46deg,#c7fb29_1.09%,#d8ff7f_98.91%)] shadow-[inset_0_-3px_5px_rgba(71,102,13,0.16),inset_0_1.5px_2px_rgba(255,255,232,0.5)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(263px_157px_at_100%_0,rgba(255,255,224,0.38)_0%,rgba(255,255,229,0.12)_55%,rgba(255,255,229,0)_100%)]"
          />
          <p className="absolute left-4 top-[58px] text-[76px] font-light leading-[94px] tracking-[-2.28px] text-ink">
            {formatClock(view.guide.targetDurationSec)}
          </p>
          <img
            src={mascot}
            alt="P! 마스코트"
            className="pointer-events-none absolute right-1 top-[42px] h-[140px] w-[106px] object-contain"
          />
        </section>

        <p className="mt-6 text-[19px] leading-[28px] text-ink">
          대화할 수 있는 속도로
          <br />
          숨이 차면 걸어도 괜찮아요.
        </p>

        <hr className="my-6 border-0 border-t border-line" />

        <ol className="flex flex-col gap-[18px]">
          <li className="flex items-start gap-[14px]">
            <span className="flex size-[24px] shrink-0 items-center justify-center rounded-full bg-soft text-[13px] font-medium leading-[18px] text-ink">
              1
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-[16px] font-medium leading-[24px] text-ink">폰은 손이나 암밴드에</p>
              <p className="text-[14px] leading-5 text-muted">평소 편하게 움직이는 자세로 달려요.</p>
            </div>
          </li>
          <li className="flex items-start gap-[14px]">
            <span className="flex size-[24px] shrink-0 items-center justify-center rounded-full bg-soft text-[13px] font-medium leading-[18px] text-ink">
              2
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-[16px] font-medium leading-[24px] text-ink">
                {minutes ?? '정해진 시간'}이 지나면 자동으로 끝나요
              </p>
              <p className="text-[14px] leading-5 text-muted">중간에 그만둘 수도 있어요.</p>
            </div>
          </li>
        </ol>

        <p className="mt-6 text-[15px] leading-[22px] text-muted">
          기준 페이스와 케이던스를 확인하고
          <br />
          나에게 맞는 첫 목표를 추천받아요.
        </p>

        {/* Figma의 시안 안내 문구이므로 예시 데이터일 때만 보여준다. */}
        {view.isSample && (
          <p className="mt-3 text-[13px] leading-[18px] text-muted">
            이 시안의 측정 시간은 예시 기준이에요.
          </p>
        )}
      </div>

      <footer className="flex flex-col px-3 pb-[9px] pt-2">
        <PrimaryButton label="측정 러닝 시작" onClick={handleStart} />
        <TextButton label="건너뛰고 둘러보기" onClick={handleSkip} />
      </footer>
    </div>
  )
}

export default GuidePage
