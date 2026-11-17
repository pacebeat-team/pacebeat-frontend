import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { GENDER_OPTIONS } from '../demographics.ts'
import type { Gender } from '../types.ts'

// 성별 선택 칩 3개 (Figma choice / 여성 · 남성 · 선택 안 함). 하나만 선택하는 라디오 그룹이다.
// value가 null이면 "선택 안 함"이 선택된 모양이다. (null이 곧 선택 안 함)
// 키보드: 방향키로 선택을 옮기고, Tab으로는 선택된 칩 하나에만 닿는다.

export interface GenderChoiceProps {
  value: Gender
  onChange: (value: Gender) => void
}

export function GenderChoice({ value, onChange }: GenderChoiceProps) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const selectedIndex = GENDER_OPTIONS.findIndex((option) => option.value === value)

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % GENDER_OPTIONS.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + GENDER_OPTIONS.length) % GENDER_OPTIONS.length
    else return
    event.preventDefault()
    onChange(GENDER_OPTIONS[next].value)
    buttonRefs.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label="성별" className="flex gap-[12px]">
      {GENDER_OPTIONS.map((option, index) => {
        const selected = index === selectedIndex
        return (
          <button
            key={option.label}
            ref={(element) => {
              buttonRefs.current[index] = element
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`flex h-[44px] min-w-0 flex-1 cursor-pointer items-center justify-center rounded-full text-[14px] font-medium leading-[20px] text-[#111111] ${
              selected ? 'bg-[#c4fa3f]' : 'bg-[#f4f4f6]'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default GenderChoice
