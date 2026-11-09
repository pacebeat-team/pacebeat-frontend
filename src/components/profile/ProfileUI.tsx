import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <path
        d="M15 5l-7 7 7 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M9 5l7 7-7 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
      <path
        d="M5 12h13M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BackHeader({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <header className="flex h-11 items-center gap-2">
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="이전 화면"
        className="flex h-11 w-11 items-center justify-center"
      >
        <ChevronLeftIcon />
      </button>
      <span className="text-[16px] font-medium">{title}</span>
    </header>
  );
}

export function StepProgress({
  current,
  optional = false,
}: {
  current: number;
  optional?: boolean;
}) {
  return (
    <div className="flex h-6 items-center justify-between text-[14px] text-[#626174]">
      <span>프로필 · {optional ? "선택" : "필수"}</span>
      <span className="font-poppins text-[13px] font-medium">
        {current} / 3
      </span>
    </div>
  );
}

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}
export function PrimaryButton({
  children,
  disabled,
  ...props
}: PrimaryButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`flex h-16 w-full items-center rounded-full pl-7 pr-3 text-left text-[18px] font-medium ${disabled ? "bg-[#f4f4f6] text-[#626174]" : "bg-[#111] text-white"}`}
      {...props}
    >
      <span className="flex-1">{children}</span>
      {!disabled && (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#111]">
          <ArrowRightIcon />
        </span>
      )}
    </button>
  );
}

export function ProfileFooter({ children }: { children: ReactNode }) {
  return (
    <footer className="mt-auto shrink-0 bg-white px-3 pb-[calc(9px+env(safe-area-inset-bottom,0px))] pt-2">
      {children}
    </footer>
  );
}

export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-end">
      <button
        type="button"
        aria-label="닫기"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <section className="relative w-full rounded-t-[28px] bg-white px-6 pb-7 pt-5">
        <div className="mx-auto h-1 w-9 rounded-full bg-[#dedee5]" />
        <div className="mt-3 flex h-11 items-center justify-between">
          <h2 className="text-[20px] font-medium">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-11 px-2 text-[16px] font-medium"
          >
            완료
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
