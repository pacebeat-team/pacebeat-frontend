import { useEffect, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNavigation } from '../common/BottomNavigation'
import { isFinishedPath, isRunNavVisible, isRunPath, RUN_PATHS, normalizeRunPath } from '../../features/running/runFlow'
import { isGoalCompletion } from '../../features/running/runResult'
import { runResultStore, useRunResultStore } from '../../features/running/runResultStore'
import { useRunStore } from '../../features/running/runStore'

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
  // 기록 저장에 성공한 뒤 결과 흐름을 벗어나면 끝난 세션을 정리한다.
  const saved = useRunResultStore((state) => state.saved)
  const inFinishedFlow = isFinishedPath(location.pathname)
  useEffect(() => {
    if (saved && !inFinishedFlow) runResultStore.getState().finalize()
  }, [saved, inFinishedFlow])
  const goalDone = useRunStore((state) => isGoalCompletion(state.activeSession))
  const sessionStatus = useRunStore((state) => state.activeSession?.session.status ?? null)
  const isRunHidden = isRun && !isRunNavVisible(location.pathname, sessionStatus)
  // 카운트다운과 진행 화면은 라임 배경을 상태바 영역까지 채운다.
  const runPath = normalizeRunPath(location.pathname)
  // 도착·완주 화면은 어두운 배경을 상태바 영역까지 채운다.
  const isDark = goalDone && (runPath === RUN_PATHS.arrival || runPath === RUN_PATHS.result)
  const isLime = runPath === RUN_PATHS.countdown || (runPath === RUN_PATHS.active && sessionStatus === 'running')
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
      className={`relative flex flex-col w-full max-w-[390px] h-[844px] max-h-[calc(100dvh-24px)] mx-auto ${isDark ? 'bg-[linear-gradient(143.9deg,#000_22.3%,#1a1a1a_103.1%)]' : isLime ? 'bg-[linear-gradient(155.4deg,#c4fa3f_32.8%,#e4ffa5_108.5%)]' : 'bg-[#FEFEFE]'} rounded-[44px] shadow-[0_14px_45px_rgba(0,0,0,0.08)] overflow-hidden ${shell} ${padding}`}
    >
      <main className="flex-1 w-full flex flex-col overflow-y-auto">
        {children ?? <Outlet />}
      </main>
      {!hideNavigation && <BottomNavigation />}
    </div>
  )
}

export default AppLayout
