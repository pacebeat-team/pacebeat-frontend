import { useId, useLayoutEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { clampIndex } from '../pickerOptions.ts'
import { useSheetAccessibility } from '../useSheetAccessibility.ts'

// 휠 선택 바텀시트 (Figma PROFILE / Height picker). 출생연도·키·몸무게가 함께 쓴다.
// 목록을 스크롤해 가운데 줄에 멈춘 값이 선택값이다. 선택값은 시트 안에서만 들고 있다가,
// "완료"를 눌렀을 때만 onConfirm으로 부모에 넘긴다. 닫기(딤 클릭, Escape)는 아무 값도 넘기지 않는다.
// 열릴 때 시작 위치는 initialValue이며, 열 때마다 새로 시작한다.
// 키보드: 열리면 목록으로 포커스가 가고 ↑/↓(1칸), PageUp/PageDown(5칸), Home/End로 값을 바꾸며 Enter로 완료한다.
// 포커스·Tab 순환·배경 inert·Escape·포커스 복귀는 useSheetAccessibility가 맡는다.

const ITEM_HEIGHT = 40
const PAGE_STEP = 5

export interface PickerSheetProps {
  title: string
  // 보여 줄 값 목록. 위에서 아래 순서 그대로 표시한다.
  options: readonly number[]
  // 처음 선택해 둘 값. options 안에 없으면 첫 번째 값에서 시작한다.
  initialValue: number
  unit: string
  onConfirm: (value: number) => void
  onClose: () => void
}

export function PickerSheet({ title, options, initialValue, unit, onConfirm, onClose }: PickerSheetProps) {
  const { rootRef, dialogRef, initialFocusRef: listRef } = useSheetAccessibility<HTMLDivElement>(onClose)
  const [initialIndex] = useState(() => Math.max(0, options.indexOf(initialValue)))
  const [index, setIndex] = useState(initialIndex)
  const titleId = useId()
  const listId = useId()

  // 처음 위치로 스크롤해 둔다. 줄 높이가 같아서 scrollTop = 인덱스 × 줄 높이이면 그 줄이 가운데에 온다.
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = initialIndex * ITEM_HEIGHT
  }, [initialIndex, listRef])

  // 현재 스크롤 위치가 가리키는 인덱스
  function readIndex(): number {
    const list = listRef.current
    return clampIndex(list ? Math.round(list.scrollTop / ITEM_HEIGHT) : index, options.length)
  }

  function moveTo(next: number) {
    const clamped = clampIndex(next, options.length)
    if (listRef.current) listRef.current.scrollTo({ top: clamped * ITEM_HEIGHT })
    setIndex(clamped)
  }

  function confirm() {
    const value = options[readIndex()]
    if (value !== undefined) onConfirm(value)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // 기준은 렌더링된 state가 아니라 실제 스크롤 위치다. 키를 연달아 눌러도 한 칸씩 정확히 움직인다.
    const current = readIndex()
    switch (event.key) {
      case 'ArrowUp':
        moveTo(current - 1)
        break
      case 'ArrowDown':
        moveTo(current + 1)
        break
      case 'PageUp':
        moveTo(current - PAGE_STEP)
        break
      case 'PageDown':
        moveTo(current + PAGE_STEP)
        break
      case 'Home':
        moveTo(0)
        break
      case 'End':
        moveTo(options.length - 1)
        break
      case 'Enter':
        confirm()
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <div ref={rootRef} className="absolute inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        tabIndex={-1}
        aria-label={`${title} 선택 닫기`}
        onClick={onClose}
        className="absolute inset-0 cursor-pointer bg-[#111111] opacity-[0.32]"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // 기본 높이는 Figma의 360px. 프레임이 이보다 낮으면 max-h-full로 프레임 높이에 맞춘다.
        className="relative flex h-[360px] max-h-full w-full flex-col rounded-t-[28px] bg-[#fefefe] p-[24px]"
      >
        <div aria-hidden="true" className="flex h-[8px] shrink-0 justify-center">
          <div className="h-[4px] w-[36px] rounded-[2px] bg-[#dedee5]" />
        </div>
        <div className="mt-[8px] flex h-[44px] shrink-0 items-center gap-[12px]">
          <h2 id={titleId} className="min-w-0 flex-1 text-[20px] font-medium leading-[28px] text-[#111111]">
            {title}
          </h2>
          <button
            type="button"
            onClick={confirm}
            className="flex h-[44px] w-[56px] shrink-0 cursor-pointer items-center justify-center text-[16px] font-medium leading-[24px] text-[#111111]"
          >
            완료
          </button>
        </div>

        <div className="relative mt-[12px] h-[200px] min-h-[80px] shrink">
          {/* 가운데 줄 강조 */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 h-[40px] -translate-y-1/2 rounded-[10px] bg-[#f4f4f6]"
          />
          <div
            ref={listRef}
            role="listbox"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label={title}
            aria-activedescendant={`${listId}-${index}`}
            onKeyDown={handleKeyDown}
            onScroll={() => setIndex(readIndex())}
            className="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* 첫 값과 마지막 값도 가운데 줄에 올 수 있도록 위아래에 여백을 둔다. */}
            <div aria-hidden="true" className="h-[calc(50%-20px)]" />
            {options.map((value, i) => {
              const selected = i === index
              return (
                <div
                  key={value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-label={`${value} ${unit}`}
                  aria-selected={selected}
                  onClick={() => moveTo(i)}
                  className={`flex h-[40px] cursor-pointer snap-center items-center justify-center font-normal ${
                    selected ? 'text-[24px] leading-[32px] text-[#111111]' : 'text-[21px] leading-[32px] text-[#626174]'
                  }`}
                >
                  {selected ? `${value} ${unit}` : value}
                </div>
              )
            })}
            <div aria-hidden="true" className="h-[calc(50%-20px)]" />
          </div>
        </div>

        <p className="mt-[12px] shrink-0 text-[13px] font-normal leading-[18px] text-[#626174]">
          완료를 눌러 선택한 값을 확인해요.
        </p>
      </div>
    </div>
  )
}

export default PickerSheet
