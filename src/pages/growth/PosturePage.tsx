import { useLocation, useNavigate } from 'react-router-dom'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { MY_ROUTES } from '../../features/my/routes'

const GROWTH_PATH = '/growth'

// Figma `POSTURE / No data`. 자세 측정 데이터는 아직 저장되지 않으므로 항상 이 화면이다.
export function PosturePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = () => (location.key !== 'default' ? navigate(-1) : navigate(GROWTH_PATH, { replace: true }))
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
        <ScreenHeader title="성장" onBack={goBack} />
        <h2 className="mt-4 w-full text-[34px] font-light leading-[44px] tracking-[-1.02px]">자세 리포트</h2>
        <p className="mt-8 text-[30px] font-light leading-[38px]">
          측정 기록이
          <br />
          아직 없어요.
        </p>
        <p className="mt-4 text-[14px] leading-5 text-muted">스마트 인솔을 연결한 뒤 달리면 지원되는 자세 데이터를 확인할 수 있어요.</p>
      </div>
      <div className="shrink-0 px-3 pb-[9px] pt-2">
        <PrimaryButton label="인솔 연결 확인" onClick={() => navigate(MY_ROUTES.device)} />
      </div>
    </div>
  )
}

export default PosturePage
