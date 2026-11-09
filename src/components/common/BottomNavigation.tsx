import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

export interface NavItemConfig {
  label: string
  path: string
  icon: (props: { active: boolean; className?: string }) => ReactNode
}

// 임시 플레이스홀더 아이콘 (이후 Figma 정식 SVG 에셋으로 쉽게 교체 가능하도록 개별 컴포넌트로 분리)
export function HomeIcon({ className = '' }: { active?: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 001 1h12a1 1 0 001-1V9.5" />
      <path d="M10 21v-7h4v7" />
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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="14" cy="4" r="2" />
      <path d="M16 8l-4 3 2 4 4 1" />
      <path d="M10 11l-3 3-4-1" />
      <path d="M12 11l-2 5-3 4" />
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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 20h18" />
      <path d="M6 16l5-5 4 4 6-7" />
      <path d="M17 8h4v4" />
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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
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
      className="fixed bottom-[calc(16px+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 w-[calc(100%-24px)] max-w-[366px] h-[70px] bg-[#1E1E22] rounded-[35px] shadow-[0_8px_30px_rgba(0,0,0,0.2)] z-50"
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
