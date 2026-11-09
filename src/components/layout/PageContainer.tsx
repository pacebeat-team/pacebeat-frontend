import type { HTMLAttributes, ReactNode } from 'react'

export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  className?: string
}

export function PageContainer({
  children,
  className = '',
  ...props
}: PageContainerProps) {
  return (
    <div
      className={`w-full px-[12px] ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export default PageContainer
