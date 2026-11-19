import { useEffect, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNavigation } from '../common/BottomNavigation'
import { isFinishedPath, isRunNavVisible, isRunPath, RUN_PATHS, normalizeRunPath } from '../../features/running/runFlow'
import { isGoalCompletion } from '../../features/running/runResult'
import { runResultStore, useRunResultStore } from '../../features/running/runResultStore'
import { useRunStore } from '../../features/running/runStore'
import { isMyNavHidden } from '../../features/my/routes'

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
  // '/profile'와 그 하위 경로('/profile/...')만 프로필 경로다. '/profiles', '/profile-x' 같은 경로는 포함하지 않는다.
  const isProfile = location.pathname === '/profile' || location.pathname.startsWith('/profile/')
  // 마이(08)는 Home처럼 390x844 프레임이다. 가입을 마친 사용자의 프로필 수정(/my/profile)은 입력 화면이라 하단 네비를 숨긴다.
  const myPath = location.pathname.replace(/\/+$/, '')
  const isMy = myPath === '/my' || myPath.startsWith('/my/')
  const isMyHome = myPath === '/my'
  const hideNavigation = isSplash || isOnboarding || isMeasurement || isProfile || isRunHidden || isMyNavHidden(myPath)

  // 러닝 화면은 Figma 프레임(390x844, 상태바 44px 포함)과 같은 기하로 그린다.
  // - 테두리를 두지 않아 안쪽 폭이 390px이고, 좁은 화면(430px 이하)에서는 화면 전체를 채운다.
  // - 위쪽은 상태바 영역 44px(기기 Safe Area가 더 크면 그 값)을 비운다.
  // Home(03)도 같은 390x844 프레임(상태바 44px 포함, 하단 내비 108px)이므로 같은 기하를 쓴다.
  const isFramed = isRun || normalizeRunPath(location.pathname) === '/home' || isMy
  const shell = isFramed
    ? 'max-[431px]:fixed max-[431px]:inset-0 max-[431px]:h-auto max-[431px]:max-h-none max-[431px]:max-w-none max-[431px]:rounded-none max-[431px]:shadow-none'
    : 'border border-neutral-200/70'
  const padding = isFramed
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
      // 마이 메인은 위쪽 어두운 헤더가 상태바 영역까지 이어진다.
      style={isMyHome ? { background: 'linear-gradient(#0a0a09,#0a0a09) top / 100% max(44px, env(safe-area-inset-top, 0px)) no-repeat, #FEFEFE' } : undefined}
      className={`relative flex flex-col w-full max-w-[390px] h-[844px] max-h-[calc(100dvh-24px)] mx-auto ${isMyHome ? '' : isDark ? 'bg-[linear-gradient(143.9deg,#000_22.3%,#1a1a1a_103.1%)]' : isLime ? 'bg-[linear-gradient(155.4deg,#c4fa3f_32.8%,#e4ffa5_108.5%)]' : 'bg-[#FEFEFE]'} rounded-[44px] shadow-[0_14px_45px_rgba(0,0,0,0.08)] overflow-hidden ${shell} ${padding}`}
    >
      <main className="flex-1 w-full flex flex-col overflow-y-auto">
        {children ?? (
          isRun ? (
            // 러닝 화면 전환은 Figma의 DISSOLVE 0.15초. 도착 → 완주는 도착 화면이 직접 움직이므로 다시 깜빡이지 않는다.
            <div
              key={location.pathname}
              className={`flex min-h-0 flex-1 flex-col ${(location.state as { fromArrival?: boolean } | null)?.fromArrival ? '' : 'route-dissolve'}`}
            >
              <Outlet />
            </div>
          ) : (
            <Outlet />
          )
        )}
      </main>
      {!hideNavigation && <BottomNavigation />}
    </div>
  )
}

export default AppLayout
