import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

export interface NavItemConfig {
  label: string
  path: string
  icon: (props: { active: boolean }) => ReactNode
}

// Figma `navigation / bottom`의 아이콘(`icon / navigation rounded / *`)을 그대로 옮겼다.
// 24x24 칸 안에서 Figma 그룹 위치(left/top)에 원래 크기로 놓고, 색은 currentColor로 받아 활성/비활성을 바꾼다.
function NavGlyph({
  width,
  height,
  left,
  top,
  children,
}: {
  width: number
  height: number
  left: number
  top: number
  children: ReactNode
}) {
  return (
    <span className="relative block size-[24px] shrink-0" aria-hidden="true">
      <svg
        className="absolute block max-w-none overflow-visible"
        style={{ left, top }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        preserveAspectRatio="none"
      >
        {children}
      </svg>
    </span>
  )
}

export function HomeIcon() {
  return (
    <NavGlyph width={18.8} height={21.15} left={2.6} top={1.25}>
      <path d="M0.9 8.85C0.9 8.05 1.23333 7.35 1.9 6.75L7.9 1.55C8.9 0.683333 9.9 0.683333 10.9 1.55L16.9 6.75C17.5667 7.35 17.9 8.05 17.9 8.85V18.15C17.9 19.55 17.2 20.25 15.8 20.25H3C1.6 20.25 0.9 19.55 0.9 18.15V8.85Z" />
      <path d="M6.4 20.25V15.25C6.4 14.4544 6.71607 13.6913 7.27868 13.1287C7.84129 12.5661 8.60435 12.25 9.4 12.25C10.1956 12.25 10.9587 12.5661 11.5213 13.1287C12.0839 13.6913 12.4 14.4544 12.4 15.25V20.25" />
    </NavGlyph>
  )
}

export function RunningIcon() {
  return (
    <NavGlyph width={20.3002} height={22.3} left={1.6} top={0.1}>
      <path d="M16.4002 3.4C16.4002 4.78071 15.2809 5.9 13.9002 5.9C12.5195 5.9 11.4002 4.78071 11.4002 3.4C11.4002 2.01929 12.5195 0.9 13.9002 0.9C15.2809 0.9 16.4002 2.01929 16.4002 3.4Z" />
      <path d="M4.40018 10.5C5.80018 7.1 8.30018 6.4 10.5002 8.4L13.8002 10.9C14.5335 11.5 15.5335 11.8 16.8002 11.8H19.4002" />
      <path d="M10.5002 8.4L7.70018 14.3C6.30018 17.4 4.30018 18.7 0.900179 18" />
      <path d="M7.70018 14.3C12.1002 14.6 15.2002 16.9 11.6002 21.4" />
    </NavGlyph>
  )
}

export function RecordsIcon() {
  return (
    <NavGlyph width={19.8} height={20.8} left={2.1} top={1.6}>
      <path d="M4.9 2.9H14.9C17.1091 2.9 18.9 4.69086 18.9 6.9V15.9C18.9 18.1091 17.1091 19.9 14.9 19.9H4.9C2.69086 19.9 0.9 18.1091 0.9 15.9V6.9C0.9 4.69086 2.69086 2.9 4.9 2.9Z" />
      <path d="M1.4 8.4H18.4M5.9 0.9V5.4M13.9 0.9V5.4" />
    </NavGlyph>
  )
}

export function GrowthIcon() {
  return (
    <NavGlyph width={20.8375} height={20.3} left={1.581} top={2.1}>
      <path d="M10.4187 19.4V11.9M10.4187 11.9V11.2M10.4187 11.9C16.9187 11.9 20.2187 7.6 19.9187 0.9C15.1187 0.9 10.4187 4.4 10.4187 11.2M10.4187 11.9C3.91872 11.9 0.618716 8.2 0.918716 1.9C6.21872 1.7 10.4187 4.9 10.4187 11.2" />
    </NavGlyph>
  )
}

export function MyIcon() {
  return (
    <NavGlyph width={19.8} height={21.8} left={2.1} top={0.6}>
      <path d="M13.4 4.4C13.4 6.333 11.833 7.9 9.9 7.9C7.967 7.9 6.4 6.333 6.4 4.4C6.4 2.467 7.967 0.9 9.9 0.9C11.833 0.9 13.4 2.467 13.4 4.4Z" />
      <path d="M2.4 20.9C1.4 20.9 0.9 20.4 0.9 19.4C0.9 14.6 4.7 11.4 9.9 11.4C15.1 11.4 18.9 14.6 18.9 19.4C18.9 20.4 18.4 20.9 17.4 20.9H2.4Z" />
    </NavGlyph>
  )
}

const NAV_ITEMS: readonly NavItemConfig[] = [
  { label: '홈', path: '/home', icon: () => <HomeIcon /> },
  { label: '러닝', path: '/running', icon: () => <RunningIcon /> },
  { label: '기록', path: '/records', icon: () => <RecordsIcon /> },
  { label: '성장', path: '/growth', icon: () => <GrowthIcon /> },
  { label: '마이', path: '/my', icon: () => <MyIcon /> },
]

// Figma `navigation / bottom`: 366x70, 모서리 35, 안쪽 여백 좌우 8·상하 7, 탭 56px, 아이콘 24, 라벨 12/16.
// 위치: 프레임 아래에서 30px(하단 고정 영역 108px = 위 8 + 내비 70 + 홈 인디케이터 영역 30).
export function BottomNavigation() {
  const location = useLocation()

  return (
    <nav
      aria-label="하단 네비게이션"
      className="absolute bottom-[30px] left-3 right-3 z-50 flex h-[70px] items-center rounded-[35px] border border-solid border-white/[0.04] bg-[linear-gradient(to_bottom,#181a15,#141610_50%,#0c0e0a)] px-2 py-[7px] shadow-[-3px_-3px_7px_rgba(255,255,255,0.35),4px_6px_9px_rgba(0,0,0,0.22)]"
    >
      {NAV_ITEMS.map((item) => {
        const isActive =
          location.pathname === item.path ||
          (item.path !== '/' && location.pathname.startsWith(`${item.path}/`))

        return (
          <Link
            key={item.path}
            to={item.path}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex h-[56px] min-w-0 flex-1 select-none flex-col items-center justify-center gap-[5px] font-pace text-[12px] leading-[16px] ${
              isActive
                ? 'rounded-[28px] font-semibold text-lime'
                : 'rounded-[20px] font-medium text-[#b5b7af]'
            }`}
          >
            {item.icon({ active: isActive })}
            <span className="whitespace-nowrap">{item.label}</span>
          </Link>
        )
      })}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_-1px_-3px_4px_rgba(0,0,0,0.35),inset_1px_2px_2px_rgba(255,255,255,0.11)]"
      />
    </nav>
  )
}

export default BottomNavigation
