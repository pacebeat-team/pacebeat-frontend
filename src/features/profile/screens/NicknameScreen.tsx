import { useNavigate } from 'react-router-dom'
import { PROFILE_ROUTES } from '../routes.ts'

// 임시 화면. 닉네임 입력 화면(Issue C)이 구현되기 전까지 /profile/nickname 경로가 비어 있지 않도록 안내만 보여 준다.
// Store와 동의 데이터는 읽지도 쓰지도 않는다.
// TODO(Issue C): 이 파일의 내용을 실제 닉네임 입력 화면으로 교체한다. 파일명과 export 이름(NicknameScreen)은 유지하면 router.tsx는 그대로 둘 수 있다.
export function NicknameScreen() {
  const navigate = useNavigate()

  function handleBack() {
    // 이전 화면이 있으면 돌아가고, 직접 진입이라 기록이 없으면 동의 화면으로 보낸다.
    const index: unknown = window.history.state?.idx
    if (typeof index === 'number' && index > 0) navigate(-1)
    else navigate(PROFILE_ROUTES.consent, { replace: true })
  }

  return (
    <div className="flex flex-col px-[24px] pb-[24px] pt-[12px]">
      <header className="flex h-[44px] items-center gap-[8px]">
        <button
          type="button"
          onClick={handleBack}
          aria-label="뒤로 가기"
          className="flex size-[44px] shrink-0 cursor-pointer items-center justify-center"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 5L8 12L15 19" stroke="#111111" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>
      <p className="mt-[16px] text-[20px] font-medium leading-[28px] text-[#111111]">닉네임 입력 화면은 준비 중이에요.</p>
    </div>
  )
}

export default NicknameScreen
