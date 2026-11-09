import type { ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNavigation } from '../common/BottomNavigation'

export interface AppLayoutProps {
  children?: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation()
  const isSplash = location.pathname === '/'

  return (
    <div
      className={`relative flex flex-col w-full max-w-[390px] h-[844px] max-h-[calc(100dvh-24px)] mx-auto bg-[#FEFEFE] rounded-[44px] shadow-[0_14px_45px_rgba(0,0,0,0.08)] border border-neutral-200/70 overflow-hidden ${
        isSplash
          ? 'pt-0 pb-0'
          : 'pt-[env(safe-area-inset-top,0px)] pb-[calc(102px+env(safe-area-inset-bottom,0px))]'
      }`}
    >
      <main className="flex-1 w-full flex flex-col overflow-y-auto">
        {children ?? <Outlet />}
      </main>
      {!isSplash && <BottomNavigation />}
    </div>
  )
}

export default AppLayout
