import { Link } from 'react-router-dom'
import { useStore } from 'zustand'
import chevronRight from '../../assets/icons/chevron-right.svg'
import { MY_ROUTES } from '../../features/my/routes'
import { useMyBack } from '../../features/my/useMyBack'
import { profileStore } from '../../features/profile/profileStore'
import { auth, useAuthState } from '../../lib/auth'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { DeviceScreen } from './DeviceParts'

function Row({ label, value, to }: { label: string; value?: string; to?: string }) {
  const content = (
    <>
      <span className="min-w-0 flex-1 text-[16px] leading-6">{label}</span>
      {value !== undefined && <span className="shrink-0 text-right text-[14px] leading-[22px] text-muted">{value}</span>}
      {to !== undefined && <img src={chevronRight} alt="" aria-hidden="true" className="size-[20px] shrink-0" />}
    </>
  )
  const cls = 'flex h-[64px] w-full items-center gap-3 text-left'
  return to === undefined ? <div className={cls}>{content}</div> : <Link to={to} className={cls}>{content}</Link>
}

const Line = () => <div className="h-px bg-line" aria-hidden="true" />

// Figma `MY / Account and permissions`.
// - 위치 권한은 온보딩에서 확인해 저장한 값을 보여 준다. 동작 및 피트니스 권한 상태는 읽을 수 없어 값을 만들지 않는다.
// - 계정 연결: Supabase 설정이 없으면(인증 꺼짐) 누를 수 없는 행, 로그아웃 상태면 로그인 화면으로 가는 행, 로그인 상태면 "연결됨"과 로그아웃을 보여 준다.
//   "연결됨"은 Supabase 로그인 상태이며, 백엔드 서버와의 연동이 확인됐다는 뜻이 아니다.
export function AccountPage() {
  const authStatus = useAuthState((state) => state.status)
  const goBack = useMyBack(MY_ROUTES.root)
  const nickname = useStore(profileStore, (state) => state.profile.nickname)
  const location = useOnboardingStore((state) => state.locationPermission)
  const locationText = location === 'granted' ? '허용' : location === 'denied' ? '허용 안 함' : undefined

  return (
    <DeviceScreen title="계정 · 권한" onBack={goBack} onConfirm={() => goBack()} confirmLabel="마이로 돌아가기">
      <div className="mt-4 flex flex-col">
        <Row to={MY_ROUTES.profile} label="프로필" value={nickname} />
        <Line />
        {authStatus === 'disabled' ? (
          <Row label="계정 연결" value="연결 안 됨" />
        ) : authStatus === 'signedIn' ? (
          <>
            <Row label="계정 연결" value="연결됨" />
            <Line />
            <button type="button" onClick={() => void auth.signOut()} className="flex h-[64px] w-full items-center gap-3 text-left">
              <span className="min-w-0 flex-1 text-[16px] leading-6">로그아웃</span>
            </button>
          </>
        ) : (
          <Row to={MY_ROUTES.accountLogin} label="계정 연결" value={authStatus === 'expired' ? '다시 로그인 필요' : '연결 안 됨'} />
        )}
      </div>
      {authStatus === 'signedIn' && <p className="mt-3 text-[14px] leading-[20px] text-muted">로그아웃해도 이 기기의 러닝 기록은 지워지지 않아요.</p>}
      <h3 className="mt-7 text-[20px] font-medium leading-7">기기 권한</h3>
      <div className="mt-3 flex flex-col">
        <Row label="위치" value={locationText} />
        <Line />
        <Row label="동작 및 피트니스" />
        <Line />
        <Row label="알림" value="기기 설정에서 관리" />
      </div>
      <p className="mt-6 text-[16px] leading-[22px]">위치는 거리와 페이스 기록에 필요해요. 허용하지 않아도 시간만 기록하며 달릴 수 있어요.</p>
      <p className="mt-4 text-[14px] leading-[20px] text-muted">
        동작 및 피트니스는 지원 기기에서 케이던스를 측정하는 선택 권한이에요. 실제 권한은 기기 설정에서 변경해요.
      </p>
      <p className="mt-6 text-[14px] leading-[20px] text-muted">기기 권한은 이 앱에서 변경하지 않아요.</p>
    </DeviceScreen>
  )
}

export default AccountPage
