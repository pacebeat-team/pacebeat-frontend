// 프로필 화면(가입 동의, 입력 3단계)이 함께 쓰는 하단 CTA 버튼.
// 활성 모양은 공통 PrimaryButton과 거의 같지만, 비활성 모양이 다르다.
// 이 화면들의 비활성은 Figma `button / primary / disabled`(#f4f4f6, 글자 #626174, 화살표 원 없음)를 따르고,
// 공통 PrimaryButton의 비활성은 다른 색(#e7e8e3, #74766f)에 화살표 원이 있다. 디자인을 바꾸지 않기 위해 합치지 않았다.
export function ProfileCta({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
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

export default ProfileCta
