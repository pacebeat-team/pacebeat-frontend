import { useLayoutEffect, useState, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNavigation } from '../common/BottomNavigation'

export interface AppLayoutProps {
  children?: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation()
  const [resultScale, setResultScale] = useState(1)
  const isSplash = location.pathname === '/'
  const isResult = location.pathname.startsWith('/result')

  useLayoutEffect(() => {
    if (!isResult) return

    const fitResultToViewport = () => {
      const availableWidth = Math.max(1, window.innerWidth - 16)
      const availableHeight = Math.max(1, window.innerHeight - 24)
      setResultScale(Math.min(1, availableWidth / 390, availableHeight / 844))
    }

    fitResultToViewport()
    window.addEventListener('resize', fitResultToViewport)
    return () => window.removeEventListener('resize', fitResultToViewport)
  }, [isResult])

  if (isResult) {
    return (
      <div className="relative mx-auto shrink-0" style={{ width: 390 * resultScale, height: 844 * resultScale }}>
        <div
          className="absolute left-0 top-0 flex h-[844px] w-[390px] origin-top-left flex-col overflow-hidden rounded-[32px] bg-[#FEFEFE] shadow-[0_14px_45px_rgba(0,0,0,0.08)]"
          style={{ transform: `scale(${resultScale})` }}
        >
          <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
            {children ?? <Outlet />}
          </main>
        </div>
      </div>
    )
  }

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


