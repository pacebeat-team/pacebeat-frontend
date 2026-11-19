import type { ReactNode } from 'react'
import { useKeyboardInset } from '../keyboardInset.ts'

// 프로필 입력 3단계 화면의 공통 틀 (Figma PROFILE / Nickname · Demographics · Body).
// 위쪽은 스크롤되는 콘텐츠(헤더, 진행 표시, 제목, 설명, 입력 영역)이고, 아래쪽 푸터(CTA, 건너뛰기)는 항상 보인다.
// 부모(AppLayout의 main)가 높이를 정해 주므로, 이 컴포넌트는 그 높이를 채우고 안쪽만 스크롤한다.

// TODO(PR #30 병합 후): 아래 ProfileHeader를 공통 ScreenHeader로, ProfileCta를 공통 PrimaryButton으로 교체한다.
// 공통 컴포넌트가 이 브랜치에 없어서 임시로 둔 구현이며, 색은 Figma 값을 직접 쓴다.
function ProfileHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="flex h-[44px] items-center gap-[8px]">
      <button
        type="button"
        onClick={onBack}
        aria-label="뒤로 가기"
        className="flex size-[44px] shrink-0 cursor-pointer items-center justify-center"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M15 5L8 12L15 19" stroke="#111111" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <h1 className="text-[16px] font-medium leading-[22px] text-[#111111]">{title}</h1>
    </header>
  )
}

function ProfileCta({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className="flex h-[64px] w-full cursor-not-allowed items-center rounded-full bg-[#f4f4f6] pl-[28px] pr-[12px] text-left text-[18px] font-medium leading-[26px] text-[#626174]"
      >
        {label}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[64px] w-full cursor-pointer items-center gap-[12px] rounded-full bg-[#111111] py-[10px] pl-[28px] pr-[12px] text-left text-[18px] font-medium leading-[26px] text-[#fefefe] transition-opacity active:opacity-[0.78]"
    >
      <span className="min-w-0 flex-1">{label}</span>
      <span className="flex size-[44px] shrink-0 items-center justify-center rounded-full bg-[#fefefe]" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M5 12H19M13 6L19 12L13 18" stroke="#111111" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}

export interface ProfileStepLayoutProps {
  // 3단계 중 몇 번째인가
  step: 1 | 2 | 3
  // 필수 단계인가. 진행 표시의 "프로필 · 필수/선택"을 정한다.
  required: boolean
  // 줄바꿈이 필요하면 <br />을 넣어 넘긴다.
  title: ReactNode
  description: string
  onBack: () => void
  ctaLabel: string
  ctaDisabled?: boolean
  onCta: () => void
  // 넘기면 CTA 아래에 "건너뛰기"를 보여 준다.
  onSkip?: () => void
  children: ReactNode
}

export function ProfileStepLayout({
  step,
  required,
  title,
  description,
  onBack,
  ctaLabel,
  ctaDisabled = false,
  onCta,
  onSkip,
  children,
}: ProfileStepLayoutProps) {
  // Figma에서 첫 단계(닉네임)만 헤더 아래 간격 10px, 설명 14px/20px, 입력 영역 앞 26px이다. 나머지 단계는 12px, 15px/22px, 28px이다.
  const first = step === 1
  // iOS Safari는 키보드가 화면 아래를 덮기만 하고 레이아웃을 줄이지 않는다. 가려지는 높이만큼 아래를 비워 CTA를 키보드 위로 올린다.
  const keyboardInset = useKeyboardInset()
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={keyboardInset > 0 ? { paddingBottom: keyboardInset } : undefined}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[24px] pb-[24px] pt-[12px]">
        <ProfileHeader title="프로필 만들기" onBack={onBack} />

        <div className={`flex h-[24px] items-center gap-[12px] text-[#626174] ${first ? 'mt-[10px]' : 'mt-[12px]'}`}>
          <p className="min-w-0 flex-1 text-[14px] font-normal leading-[20px]">프로필 · {required ? '필수' : '선택'}</p>
          <p className="text-[13px] font-medium leading-[20px]">
            <span aria-hidden="true">{step} / 3</span>
            <span className="sr-only">3단계 중 {step}단계</span>
          </p>
        </div>

        <h2 className="mt-[14px] text-[34px] font-light leading-[44px] tracking-[-1.02px] text-[#111111]">{title}</h2>
        <p
          className={`mt-[10px] font-normal text-[#626174] ${first ? 'text-[14px] leading-[20px]' : 'text-[15px] leading-[22px]'}`}
        >
          {description}
        </p>

        <div className={first ? 'mt-[26px]' : 'mt-[28px]'}>{children}</div>
      </div>

      <footer className="flex shrink-0 flex-col items-stretch px-[12px] pb-[9px] pt-[8px]">
        <ProfileCta label={ctaLabel} disabled={ctaDisabled} onClick={onCta} />
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="flex h-[44px] w-full cursor-pointer items-center justify-center text-[14px] font-normal leading-[20px] text-[#626174]"
          >
            건너뛰기
          </button>
        )}
      </footer>
    </div>
  )
}

export default ProfileStepLayout
