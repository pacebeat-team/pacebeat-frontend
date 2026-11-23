import { useEffect, useRef } from 'react'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { formatPace } from '../../features/running/format'
import { REFLECTION_MEMO_MAX } from '../../features/running/reflection'
import { runResultStore, useRunResultStore } from '../../features/running/runResultStore'
import type { ReflectionDifficulty, ReflectionReason, RunReflection, RunSplit } from '../../features/running/types'
import { DIFFICULTY_OPTIONS, REASON_OPTIONS, useSaveAndGo } from './resultHooks'

// 결과 화면 공용 조각(#47). Figma `RESULT / *` 의 같은 요소를 한 번만 만든다.

export function SaveFooter({ label = '저장하고 홈으로', destination = '/home', inset = false }: { label?: string; destination?: string; inset?: boolean }) {
  const saveAndGo = useSaveAndGo()
  const saving = useRunResultStore((state) => state.saving)
  return (
    <div className={`flex shrink-0 flex-col pt-2 ${inset ? 'px-6 pb-[max(0px,calc(31px-env(safe-area-inset-bottom,0px)))]' : 'px-3 pb-[max(0px,calc(36px-env(safe-area-inset-bottom,0px)))]'}`}>
      <PrimaryButton label={label} disabled={saving} onClick={() => saveAndGo(destination)} />
    </div>
  )
}

export function DifficultyChips() {
  const difficulty = useRunResultStore((state) => state.applied.difficulty)
  return (
    <div role="radiogroup" aria-label="체감 난이도" className="flex h-[44px] w-full gap-3">
      {DIFFICULTY_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={difficulty === option.value}
          onClick={() => runResultStore.getState().setDifficulty(option.value)}
          className={`flex h-[44px] min-w-0 flex-1 cursor-pointer items-center justify-center rounded-full text-[14px] font-medium leading-5 text-ink ${
            difficulty === option.value ? 'bg-lime' : 'bg-soft'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function splitLabel(split: RunSplit): string {
  return split.distanceM >= 1000 ? `${split.index} km` : `마지막 ${(split.distanceM / 1000).toFixed(2)} km`
}

export function SplitRows({ splits }: { splits: readonly RunSplit[] }) {
  return (
    <ul aria-label="구간별 페이스">
      {splits.map((split) => (
        <li key={split.index} className="flex h-[42px] items-center gap-3">
          <p className="min-w-0 flex-1 text-[14px] leading-5 text-muted">{splitLabel(split)}</p>
          <p className="text-[16px] leading-[22px] text-ink">
            {split.paceSecPerKm === null ? '—' : `${formatPace(split.paceSecPerKm)} /km`}
          </p>
        </li>
      ))}
    </ul>
  )
}

// 라임 카드(Figma `result / primary achievement`)
export function AchievementCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="러닝 결과 요약"
      className="relative flex w-full shrink-0 flex-col overflow-hidden rounded-[34px] bg-[linear-gradient(150deg,#c7fb29_1.09%,#d8ff7f_98.91%)] p-6 shadow-[inset_0_-3px_5px_rgba(71,102,13,0.16),inset_0_1.5px_2px_rgba(255,255,232,0.5)]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(263px_224px_at_100%_0,rgba(255,255,224,0.38)_0%,rgba(255,255,229,0.12)_55%,rgba(255,255,229,0)_100%)]"
      />
      <div className="relative flex flex-col">{children}</div>
    </section>
  )
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-[138px] flex-col gap-[2px]">
      <p className="text-[13px] leading-[18px] text-ink">{label}</p>
      <p className="text-[28px] leading-[34px] text-ink">{value}</p>
    </div>
  )
}

// 결과 화면의 리포트 시트: 결과 입력 상태(store)에 연결한다.
export function ReflectionSheet() {
  const open = useRunResultStore((state) => state.sheetOpen)
  const draft = useRunResultStore((state) => state.draft)
  const api = runResultStore.getState()
  return (
    <ReflectionSheetView
      open={open}
      draft={draft}
      subtitle="오늘의 러닝 리포트"
      onClose={api.closeSheet}
      onDifficulty={api.setDraftDifficulty}
      onToggleReason={api.toggleDraftReason}
      onMemo={api.setDraftMemo}
      onSave={api.applySheet}
    />
  )
}

export interface ReflectionSheetViewProps {
  open: boolean
  draft: RunReflection
  subtitle: string
  // 저장 실패 안내 등 저장 버튼 위에 보일 문구
  error?: string | null
  saving?: boolean
  onClose: () => void
  onDifficulty: (difficulty: ReflectionDifficulty) => void
  onToggleReason: (reason: ReflectionReason) => void
  onMemo: (memo: string) => void
  onSave: () => void
}

// 리포트 시트(Figma `RESULT / Reflection sheet`, `RECORD / Reflection`). 저장해야만 반영하고, 닫기·바깥 탭은 반영하지 않는다.
export function ReflectionSheetView({
  open,
  draft,
  subtitle,
  error = null,
  saving = false,
  onClose,
  onDifficulty,
  onToggleReason,
  onMemo,
  onSave,
}: ReflectionSheetViewProps) {
  // 닫기 함수가 바뀌어도 열려 있는 동안의 포커스 가두기·inert 처리를 다시 하지 않도록 ref로 최신 값을 쓴다.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const ref = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // 시트가 열려 있는 동안: 포커스를 시트 안에 가두고(Tab 순환), 뒤 화면은 상호작용·스크린리더에서 제외하고(inert),
  // 닫으면 시트를 연 버튼으로 포커스를 되돌린다.
  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const wrapper = wrapperRef.current
    const dimmed: HTMLElement[] = []
    if (wrapper?.parentElement) {
      for (const sibling of Array.from(wrapper.parentElement.children)) {
        if (sibling !== wrapper && sibling instanceof HTMLElement && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '')
          dimmed.push(sibling)
        }
      }
    }
    // 시트가 <main> 안에 있으면 main 밖의 하단 내비게이션도 뒤 화면이므로 함께 제외한다.
    const main = wrapper?.closest('main')
    if (main?.parentElement) {
      for (const sibling of Array.from(main.parentElement.children)) {
        if (sibling !== main && sibling instanceof HTMLElement && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '')
          dimmed.push(sibling)
        }
      }
    }
    ref.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || ref.current === null) return
      const focusable = Array.from(
        ref.current.querySelectorAll<HTMLElement>('button, textarea, [href], input, [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => !element.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const current = document.activeElement
      if (event.shiftKey && (current === first || current === ref.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      for (const element of dimmed) element.removeAttribute('inert')
      if (opener !== null && opener.isConnected) opener.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div ref={wrapperRef} className="absolute inset-0 z-[60] flex flex-col justify-end">
      <button
        type="button"
        aria-label="리포트 닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/[0.32]"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="오늘 러닝 리포트"
        tabIndex={-1}
        className="relative flex max-h-full min-h-[min(724px,100%)] flex-col overflow-y-auto rounded-t-[28px] bg-app-bg p-6 pb-[max(24px,env(safe-area-inset-bottom,0px))] font-pace text-ink outline-none"
      >
        <div className="mx-auto h-1 w-9 shrink-0 rounded-full bg-line" />
        <h2 className="mt-5 text-[28px] font-medium leading-9">오늘 러닝 리포트</h2>
        <p className="mt-1 text-[14px] leading-5 text-muted">{subtitle}</p>

        <p className="mt-6 text-[16px] font-medium leading-[22px]">체감 난이도</p>
        <div role="radiogroup" aria-label="체감 난이도" className="mt-3 flex h-[44px] w-full gap-3">
          {DIFFICULTY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={draft.difficulty === option.value}
              onClick={() => onDifficulty(option.value)}
              className={`flex h-[44px] min-w-0 flex-1 cursor-pointer items-center justify-center rounded-full text-[14px] font-medium leading-5 ${
                draft.difficulty === option.value ? 'bg-lime' : 'bg-soft'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="mt-6 text-[16px] font-medium leading-[22px]">힘들었던 이유 · 선택</p>
        <div role="group" aria-label="힘들었던 이유" className="mt-3 flex h-[44px] w-full gap-3">
          {REASON_OPTIONS.map((option) => {
            const selected = draft.reasons.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onToggleReason(option.value)}
                className={`flex h-[44px] min-w-0 flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded-full text-[14px] font-medium leading-5 ${
                  selected ? 'bg-lime' : 'bg-soft'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        <label htmlFor="reflection-memo" className="mt-6 text-[16px] font-medium leading-[22px]">
          메모 · 선택
        </label>
        <textarea
          id="reflection-memo"
          value={draft.memo}
          maxLength={REFLECTION_MEMO_MAX}
          onChange={(event) => onMemo(event.target.value)}
          placeholder="오늘의 페이스를 기억해요."
          className="mt-3 h-[72px] w-full resize-none rounded-2xl bg-soft p-4 text-[16px] leading-6 text-ink outline-none placeholder:text-muted/70"
        />
        <p className="mt-[6px] text-right text-[13px] leading-[18px] text-muted" aria-live="polite">
          {draft.memo.length} / {REFLECTION_MEMO_MAX}
        </p>
        {error !== null && (
          <p role="alert" className="mt-3 text-[13px] leading-[18px] text-muted">
            {error}
          </p>
        )}
        <div className="mt-5">
          <PrimaryButton label="저장" disabled={saving} onClick={onSave} />
        </div>
      </div>
    </div>
  )
}
