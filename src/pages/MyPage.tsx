import { Link } from 'react-router-dom'
import { useStore } from 'zustand'
import profileChevron from '../assets/my/profile-chevron.svg'
import profileLanes from '../assets/my/profile-lanes.svg'
import avatarImage from '../assets/home/avatar.png'
import chevronRight from '../assets/icons/chevron-right.svg'
import { summarizeGuidance } from '../features/my/guidanceSettings'
import { useGuidanceSettings } from '../features/my/guidanceSettingsStore'
import { buildBaselineView, buildProfileLine } from '../features/my/myView'
import { MEASUREMENT_GUIDE_PATH, MY_ROUTES } from '../features/my/routes'
import { profileStore } from '../features/profile/profileStore'
import { useMeasurementStore } from '../stores/measurementStore'
import { useOnboardingStore } from '../stores/onboardingStore'

// Figma `row / …`: 행 간격 63px(행 y 458·521·584·647·710). 구분선 1px은 다음 행의 맨 윗줄에 겹쳐 있으므로
// 첫 행을 뺀 행마다 위 테두리(border-t)로 그려 63px 안에 포함시키고, 글자는 같은 중심(행 위에서 32px)에 둔다.
function MenuRow({ to, label, value, divided = true }: { to: string; label: string; value?: string; divided?: boolean }) {
  return (
    <Link
      to={to}
      className={`flex h-[63px] w-full items-center gap-3 text-left ${divided ? 'border-t border-line' : ''}`}
    >
      <span className="min-w-0 flex-1 text-[16px] leading-[24px] text-ink">{label}</span>
      {value !== undefined && <span className="shrink-0 text-right text-[14px] leading-[22px] text-muted">{value}</span>}
      <img src={chevronRight} alt="" aria-hidden="true" className="size-[20px] shrink-0" />
    </Link>
  )
}

// Figma `MY`(08). 저장된 프로필·온보딩·기초 측정 값으로 채운다. 저장하지 않는 값(케이던스·품질)은 보여 주지 않는다.
// 화면 위쪽 어두운 헤더는 상태바 영역까지 이어지므로 AppLayout이 그 영역을 같은 색으로 채운다.
export function MyPage() {
  const nickname = useStore(profileStore, (state) => state.profile.nickname)
  const experienceLevel = useOnboardingStore((state) => state.experienceLevel)
  const weeklyRuns = useOnboardingStore((state) => state.weeklyRuns)
  const session = useMeasurementStore((state) => state.session)
  const runSource = useMeasurementStore((state) => state.runSource)
  const metrics = useMeasurementStore((state) => state.metrics)
  const beatGuide = useGuidanceSettings((state) => state.beatGuide)
  const voiceGuide = useGuidanceSettings((state) => state.voiceGuide)

  const profileLine = buildProfileLine(experienceLevel, weeklyRuns)
  const baseline = buildBaselineView({ session, runSource, metrics })

  return (
    <div className="flex flex-col bg-app-bg font-pace text-ink [&>*]:shrink-0">
      <Link
        to={MY_ROUTES.profile}
        aria-label="프로필 수정"
        className="relative flex h-[262px] w-full flex-col overflow-hidden rounded-b-[32px] bg-[linear-gradient(132deg,#0a0a09_58.7%,#212121_132.5%)] px-[21px] pb-[21px] pt-[18px] text-app-bg shadow-[inset_0_-3px_5px_rgba(0,0,0,0.4)]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-b-[32px] bg-[radial-gradient(30px_20px_at_100%_0,rgba(217,224,204,0.12)_0%,rgba(217,224,204,0.035)_55%,rgba(217,224,204,0)_100%)]"
        />
        <img src={profileLanes} alt="" aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-[262px] w-[390px] max-w-none" />
        <p className="relative text-[23.5px] font-bold leading-[29px] tracking-[-0.8px]">P!PACE</p>
        <h1 className="relative w-full text-[34px] font-bold leading-[58px] tracking-[-1.2px]">마이</h1>
        <div className="h-[12px]" aria-hidden="true" />
        <div className="relative flex h-[106px] items-center gap-5">
          <span className="relative size-[106px] shrink-0 overflow-hidden rounded-full">
            <img src={avatarImage} alt="" className="absolute inset-0 size-full object-cover" />
          </span>
          <span className="flex h-[90px] min-w-0 flex-1 flex-col justify-center gap-[11px]">
            <span className="flex h-[38px] items-center gap-[10px]">
              <span className="min-w-0 truncate text-[30px] font-semibold leading-[38px] tracking-[-0.8px]">{nickname}</span>
              <span className="flex size-[27px] shrink-0 items-center justify-center rounded-full bg-[#292929]">
                <img src={profileChevron} alt="" aria-hidden="true" className="size-[17px]" />
              </span>
            </span>
            {profileLine !== null && <span className="text-[14px] leading-[20px]">{profileLine}</span>}
          </span>
        </div>
      </Link>

      <div className="flex flex-col px-6 pb-6 pt-[26px]">
        {baseline !== null && (
          <>
            <h2 className="text-[20px] font-medium leading-[28px]">내 기준</h2>
            <div className="mt-4 flex flex-col gap-[7px]">
              <p className="text-[14px] leading-[20px] text-muted">기준 페이스</p>
              <p className="flex items-baseline gap-[6px] text-[26px] leading-[31px]">
                <span>{baseline.paceText}</span>
                <span>/km</span>
              </p>
            </div>
            <p className="mt-[10px] text-[14px] leading-[20px] text-muted">{baseline.measuredText}</p>
          </>
        )}
        <MenuRow
          to={MEASUREMENT_GUIDE_PATH}
          label="기초 측정"
          value={baseline === null ? undefined : '다시 측정'}
          divided={false}
        />
        <MenuRow to={MY_ROUTES.guidance} label="안내 설정" value={summarizeGuidance({ beatGuide, voiceGuide })} />
        <MenuRow to={MY_ROUTES.device} label="스마트 인솔" />
        <MenuRow to={MY_ROUTES.account} label="계정 · 권한" />
        <MenuRow to={MY_ROUTES.data} label="데이터 내보내기 · 삭제" />
      </div>
    </div>
  )
}

export default MyPage
