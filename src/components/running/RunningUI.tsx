import type { ReactNode } from 'react'

export function StatusBar({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`flex h-11 shrink-0 items-center justify-between px-7 font-poppins text-[16px] font-medium ${dark ? 'text-white' : 'text-[#111]'}`}>
      <span>9:41</span>
      <div className="flex items-center gap-1.5" aria-hidden="true">
        <span className="flex h-[14px] items-end gap-[2px]">
          {[4, 7, 10, 14].map((height) => <i key={height} className="block w-[2px] rounded-full bg-current" style={{ height }} />)}
        </span>
        <svg className="size-[20px]" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2.5 7.5c4.2-3.8 10.8-3.8 15 0M5.3 10.4c2.6-2.4 6.8-2.4 9.4 0M8.3 13.2c.9-.8 2.5-.8 3.4 0" /><circle cx="10" cy="16" r="1" fill="currentColor" stroke="none" /></svg>
        <span className={`relative block h-[11px] w-[19px] rounded-[3px] border ${dark ? 'border-white' : 'border-[#111]'}`}><i className="absolute -right-[3px] top-[3px] h-[5px] w-[2px] rounded-r bg-current" /></span>
      </div>
    </div>
  )
}

export function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex h-11 items-center gap-2">
      <button type="button" onClick={onBack} className="flex size-11 items-center justify-center rounded-full text-[31px] font-light" aria-label="뒤로 가기">‹</button>
      <span className="text-[16px] font-medium">{title}</span>
    </div>
  )
}

export function PrimaryButton({ children, onClick, testId }: { children: ReactNode; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex h-16 w-full shrink-0 items-center justify-between rounded-full bg-[#111] py-2 pl-7 pr-3 text-left text-[18px] font-medium text-white active:scale-[0.99]"
    >
      <span>{children}</span>
      <span className="flex size-11 items-center justify-center rounded-full bg-white text-[31px] font-light text-[#111]">→</span>
    </button>
  )
}

export function Brand() {
  return <div className="font-poppins text-[23.5px] font-bold leading-[29px] tracking-[-0.8px]">P!PACE</div>
}

