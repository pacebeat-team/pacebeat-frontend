import type { ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { BottomNavigation } from '../common/BottomNavigation'

export interface AppLayoutProps {
  children?: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="relative flex flex-col w-full max-w-[390px] min-h-dvh mx-auto bg-[#FEFEFE] overflow-x-hidden pt-[env(safe-area-inset-top,0px)] pb-[calc(102px+env(safe-area-inset-bottom,0px))]">
      <main className="flex-1 w-full flex flex-col">
        {children ?? <Outlet />}
      </main>
      <BottomNavigation />
    </div>
  )
}

export default AppLayout
