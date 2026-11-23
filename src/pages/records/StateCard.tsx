import { Link } from 'react-router-dom'
import heroArrow from '../../assets/home/hero-arrow.svg'

// 기록 조회 중 카드 (Figma RECORDS / Loading, feedback State=Loading). 트랙 4px, 채움 96px은 시안 그대로 고정이다.
export function LoadingCard() {
  return (
    <section role="status" aria-live="polite" className="flex w-full flex-col gap-2 rounded-[24px] bg-soft p-6">
      <h2 className="text-[20px] font-semibold leading-[30px] text-ink">기록을 불러오는 중</h2>
      <p className="h-[42px] text-[14px] leading-[21px] text-muted">잠시만 기다려 주세요.</p>
      <div aria-hidden="true" className="flex h-[4px] w-full overflow-clip rounded-[2px] bg-[#dedee5]">
        <div className="h-[4px] w-[96px] rounded-[2px] bg-ink" />
      </div>
    </section>
  )
}

// Empty·Error 공통 카드 (Figma RECORDS Empty/Error)
export function StateCard({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action: { label: string; to?: string; onClick?: () => void }
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1 text-[16px] font-medium leading-[24px] text-app-bg">{action.label}</span>
      <span className="flex size-[44px] shrink-0 items-center justify-center rounded-full bg-lime">
        <img src={heroArrow} alt="" aria-hidden="true" className="size-[24px] brightness-0" />
      </span>
    </>
  )
  const className =
    'mt-4 flex h-[64px] w-full cursor-pointer items-center rounded-full bg-ink pl-[28px] pr-[12px] text-left transition-opacity active:opacity-[0.78]'
  return (
    <section className="flex w-full flex-col gap-2 rounded-[24px] bg-soft p-6">
      <h2 className="text-[20px] font-semibold leading-[30px] text-ink">{title}</h2>
      <p className="text-[14px] leading-[21px] text-muted">{body}</p>
      {action.to !== undefined ? (
        <Link to={action.to} className={className}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={action.onClick} className={className}>
          {content}
        </button>
      )}
    </section>
  )
}
