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
      className={`relative flex flex-col w-full max-w-[390px] min-h-dvh mx-auto overflow-x-hidden ${
        isSplash
          ? 'pt-0 pb-0 bg-black'
          : 'pt-[env(safe-area-inset-top,0px)] pb-[calc(102px+env(safe-area-inset-bottom,0px))] bg-[#FEFEFE]'
      }`}
    >
      <main className="flex-1 w-full flex flex-col">
        {children ?? <Outlet />}
      </main>
      {!isSplash && <BottomNavigation />}
    </div>
  )
}

export default AppLayout
