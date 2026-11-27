// 프로필 화면(가입 동의, 입력 3단계)이 함께 쓰는 헤더: 44px 높이, 뒤로가기 버튼 + 제목.
// 공통 ScreenHeader(온보딩·측정용)와 모양이 같지 않아 따로 둔다. 뒤로가기 화살표의 크기·선 굵기(1.8)가 다르고,
// 프로필 화면의 기존 디자인을 그대로 유지하기 위해 합치지 않았다. 두 프로필 화면이 같은 구현을 쓰도록 한 곳에 모았다.
export function ProfileHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="sticky top-0 z-20 -mx-[24px] -mt-[12px] flex h-[56px] shrink-0 items-center gap-[8px] bg-[#fefefe]/95 px-[24px] pt-[12px] backdrop-blur-xs">
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

export default ProfileHeader
