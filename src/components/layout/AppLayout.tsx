import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNavigation } from '../common/BottomNavigation'

export interface AppLayoutProps {
  children?: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const isSplash = location.pathname === '/'
  const isRunning = location.pathname.startsWith('/running')
  const usesStandaloneLayout = isSplash || isRunning

  useLayoutEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 })
  }, [location.pathname])

  return (
    <div
      className={`relative flex flex-col w-full max-w-[390px] h-[844px] max-h-[calc(100dvh-24px)] mx-auto bg-[#FEFEFE] rounded-[44px] shadow-[0_14px_45px_rgba(0,0,0,0.08)] border border-neutral-200/70 overflow-hidden ${
        usesStandaloneLayout
          ? 'pt-0 pb-0'
          : 'pt-[env(safe-area-inset-top,0px)] pb-[calc(102px+env(safe-area-inset-bottom,0px))]'
      }`}
    >
      <main ref={mainRef} className={`flex min-h-0 w-full flex-1 flex-col ${usesStandaloneLayout ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {children ?? <Outlet />}
      </main>
      {!usesStandaloneLayout && <BottomNavigation />}
    </div>
  )
}

export default AppLayout

