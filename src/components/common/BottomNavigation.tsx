import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

export interface NavItemConfig {
  label: string
  path: string
  icon: (props: { active: boolean; className?: string }) => ReactNode
}

// Figma 디자인 에셋 기반 네비게이션 아이콘 (nav-rounded-*.svg)
export function HomeIcon({ className = '' }: { active?: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 10.1 Q3.5 8.9 4.5 8 L10.5 2.8 Q12 1.5 13.5 2.8 L19.5 8 Q20.5 8.9 20.5 10.1 V19.4 Q20.5 21.5 18.4 21.5 H5.6 Q3.5 21.5 3.5 19.4 Z" />
      <path d="M9 21.5 V16.5 A3 3 0 0 1 15 16.5 V21.5" />
    </svg>
  )
}

export function RunningIcon({ className = '' }: { active?: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="15.5" cy="3.5" r="2.5" />
      <path d="M6 10.6 C7.4 7.2 9.9 6.5 12.1 8.5 L15.4 11 Q16.5 11.9 18.4 11.9 H21" />
      <path d="M12.1 8.5 L9.3 14.4 C7.9 17.5 5.9 18.8 2.5 18.1" />
      <path d="M9.3 14.4 C13.7 14.7 16.8 17 13.2 21.5" />
    </svg>
  )
}

export function RecordsIcon({ className = '' }: { active?: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4.5" width="18" height="17" rx="4" />
      <path d="M3.5 10 H20.5 M8 2.5 V7 M16 2.5 V7" />
    </svg>
  )
}

export function GrowthIcon({ className = '' }: { active?: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21.5 V13.3 C12 6.5 16.7 3 21.5 3 C21.8 9.7 18.5 14 12 14 C5.5 14 2.2 10.3 2.5 4 C7.8 3.8 12 7 12 13.3" />
    </svg>
  )
}

export function MyIcon({ className = '' }: { active?: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="3.5" />
      <path d="M4.5 21.5 Q3 21.5 3 20 C3 15.2 6.8 12 12 12 C17.2 12 21 15.2 21 20 Q21 21.5 19.5 21.5 Z" />
    </svg>
  )
}

const NAV_ITEMS: readonly NavItemConfig[] = [
  {
    label: '홈',
    path: '/home',
    icon: (props) => <HomeIcon {...props} />,
  },
  {
    label: '러닝',
    path: '/running',
    icon: (props) => <RunningIcon {...props} />,
  },
  {
    label: '기록',
    path: '/records',
    icon: (props) => <RecordsIcon {...props} />,
  },
  {
    label: '성장',
    path: '/growth',
    icon: (props) => <GrowthIcon {...props} />,
  },
  {
    label: '마이',
    path: '/my',
    icon: (props) => <MyIcon {...props} />,
  },
]

export function BottomNavigation() {
  const location = useLocation()

  return (
    <nav
      aria-label="하단 네비게이션"
      className="absolute bottom-[calc(16px+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 w-[calc(100%-24px)] max-w-[366px] h-[70px] bg-[#1E1E22] rounded-[35px] shadow-[0_8px_30px_rgba(0,0,0,0.2)] z-50"
    >
      <div className="flex items-center justify-around h-full px-2">
        {NAV_ITEMS.map((item) => {
          const isActive =
            location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(`${item.path}/`))

          const IconComponent = item.icon

          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={isActive ? 'page' : undefined}
              className={`flex flex-col items-center justify-center flex-1 h-full select-none transition-colors ${
                isActive
                  ? 'text-[#C6F135]'
                  : 'text-[#8E8E93] hover:text-[#B0B0B5]'
              }`}
            >
              <div className="w-[24px] h-[24px] flex items-center justify-center">
                <IconComponent active={isActive} className="w-[24px] h-[24px]" />
              </div>
              <span className="text-[12px] leading-[16px] font-medium tracking-tight mt-[5px]">
                {item.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export default BottomNavigation
