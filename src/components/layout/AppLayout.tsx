import type { ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNavigation } from '../common/BottomNavigation'
import { isRunNavVisible, isRunPath } from '../../features/running/runFlow'

export interface AppLayoutProps {
  children?: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation()
  const isSplash = location.pathname === '/'
  const isOnboarding = location.pathname.startsWith('/onboarding')
  const isMeasurement = location.pathname.startsWith('/measurement')
  // 러닝 준비 흐름에서는 목표·음악 화면에서만 하단 네비를 보인다.
  const isRun = isRunPath(location.pathname)
  const isRunHidden = isRun && !isRunNavVisible(location.pathname)
  const hideNavigation = isSplash || isOnboarding || isMeasurement || isRunHidden

  // 러닝 화면은 Figma 프레임(390x844, 상태바 44px 포함)과 같은 기하로 그린다.
  // - 테두리를 두지 않아 안쪽 폭이 390px이고, 좁은 화면(430px 이하)에서는 화면 전체를 채운다.
  // - 위쪽은 상태바 영역 44px(기기 Safe Area가 더 크면 그 값)을 비운다.
  const shell = isRun
    ? 'max-[431px]:fixed max-[431px]:inset-0 max-[431px]:h-auto max-[431px]:max-h-none max-[431px]:max-w-none max-[431px]:rounded-none max-[431px]:shadow-none'
    : 'border border-neutral-200/70'
  const padding = isRun
    ? hideNavigation
      ? 'pt-[max(44px,env(safe-area-inset-top,0px))] pb-[env(safe-area-inset-bottom,0px)]'
      : 'pt-[max(44px,env(safe-area-inset-top,0px))] pb-[108px]'
    : hideNavigation
      ? isSplash
        ? 'pt-0 pb-0'
        : 'pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]'
      : 'pt-[env(safe-area-inset-top,0px)] pb-[calc(108px+env(safe-area-inset-bottom,0px))]'

  return (
    <div
      className={`relative flex flex-col w-full max-w-[390px] h-[844px] max-h-[calc(100dvh-24px)] mx-auto bg-[#FEFEFE] rounded-[44px] shadow-[0_14px_45px_rgba(0,0,0,0.08)] overflow-hidden ${shell} ${padding}`}
    >
      <main className="flex-1 w-full flex flex-col overflow-y-auto">
        {children ?? <Outlet />}
      </main>
      {!hideNavigation && <BottomNavigation />}
    </div>
  )
}

export default AppLayout
