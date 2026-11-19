import type { KeyboardEvent } from 'react'
import { NICKNAME_SUGGESTIONS, getNicknameInitial } from '../nickname.ts'
import type { NicknameFeedback } from '../nickname.ts'
import { NICKNAME_MAX } from '../types.ts'

// 닉네임 입력 영역 (Figma field / nickname, field / nickname validation, 추천 이름).
// 입력값은 부모가 들고 있다. 이 컴포넌트는 Store를 읽거나 쓰지 않는다.

// 오류 텍스트 색. 디자인 시스템에 오류 색 토큰이 없어서 확정된 값을 직접 쓴다. 토큰을 새로 만들지 않는다.
const ERROR_TEXT_CLASS = 'text-[#D92D20]'

const FEEDBACK_ID = 'nickname-feedback'

export interface NicknameFieldProps {
  value: string
  onChange: (value: string) => void
  feedback: NicknameFeedback
  // 입력창에서 Enter를 눌렀을 때 (한글 조합 중에는 호출하지 않는다)
  onEnter: () => void
}

export function NicknameField({ value, onChange, feedback, onEnter }: NicknameFieldProps) {
  const isError = feedback.tone === 'error'
  const initial = getNicknameInitial(value)

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 한글 조합을 확정하는 Enter는 제출로 보지 않는다. Safari는 조합 확정 직후 keydown의 isComposing이 false라서 keyCode 229도 함께 본다.
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    onEnter()
  }

  return (
    <div>
      <div className="flex h-[64px] items-center gap-[14px]">
        {/* 입력 전에는 빈 라임색 원, 입력하면 첫 글자 */}
        <div
          aria-hidden="true"
          className="flex size-[48px] shrink-0 items-center justify-center rounded-full bg-[#c4fa3f] text-[21px] font-medium leading-[28px] text-[#111111]"
        >
          {initial}
        </div>
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="닉네임"
          aria-invalid={isError}
          aria-describedby={FEEDBACK_ID}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="next"
          className="h-[44px] min-w-0 flex-1 bg-transparent text-[30px] font-normal leading-[42px] tracking-[-0.9px] text-[#111111] outline-none"
        />
      </div>
      <div className="h-px bg-[#dedee5]" />
      <div className="mt-[10px] flex items-start gap-[8px] text-[13px] font-normal leading-[20px]">
        <p
          id={FEEDBACK_ID}
          aria-live="polite"
          className={`min-w-0 flex-1 ${isError ? ERROR_TEXT_CLASS : 'text-[#626174]'}`}
        >
          {feedback.message}
        </p>
        <p className={`shrink-0 text-right ${isError ? ERROR_TEXT_CLASS : 'text-[#626174]'}`}>
          {feedback.count} / {NICKNAME_MAX}
        </p>
      </div>
    </div>
  )
}

export interface NicknameSuggestionsProps {
  onSelect: (name: string) => void
}

// 추천 이름. 누르면 입력란에 반영만 한다. (저장은 "다음"에서)
export function NicknameSuggestions({ onSelect }: NicknameSuggestionsProps) {
  return (
    <div role="group" aria-label="추천 이름" className="mt-[16px] flex items-center text-[13px] font-normal leading-[20px] text-[#626174]">
      <span aria-hidden="true" className="mr-[12px]">
        추천 이름
      </span>
      {NICKNAME_SUGGESTIONS.map((name, index) => (
        <span key={name} className="flex items-center">
          {index > 0 && (
            <span aria-hidden="true" className="px-[2px]">
              ·
            </span>
          )}
          {/* 글자는 Figma 크기 그대로 두고, 터치 영역만 세로 44px로 넓힌다. */}
          <button
            type="button"
            onClick={() => onSelect(name)}
            className="-my-[12px] cursor-pointer px-[6px] py-[12px]"
          >
            {name}
          </button>
        </span>
      ))}
    </div>
  )
}
