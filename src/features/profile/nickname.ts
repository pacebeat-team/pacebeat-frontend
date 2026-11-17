import type { ProfileState } from './profileStore.ts'
import { NICKNAME_MAX, NICKNAME_MIN } from './types.ts'
import { countNicknameChars, validateNickname } from './validation.ts'

// 닉네임 화면의 순수 로직. React와 profileStore 인스턴스에 의존하지 않는다.
// 화면은 입력값(draft)을 자체 상태로 들고 있다가, "다음"을 누를 때만 submitNickname으로 Store에 저장한다.

// 추천 이름. 누르면 입력란에 반영되며, 그것만으로 Store에 저장하지는 않는다.
export const NICKNAME_SUGGESTIONS: readonly string[] = ['삼색', '도도', '야통']

// 안내 문구. '유효' 문구는 Figma, 나머지는 확정한 문구다.
export const NICKNAME_HINT_MESSAGE = `${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.`
export const NICKNAME_TOO_SHORT_MESSAGE = `${NICKNAME_MIN}자 이상 입력해 주세요.`
export const NICKNAME_TOO_LONG_MESSAGE = `${NICKNAME_MAX}자 이하로 입력해 주세요.`
export const NICKNAME_VALID_MESSAGE = `${NICKNAME_MIN}~${NICKNAME_MAX}자 조건을 만족해요.`

// neutral: 아직 입력 전(오류 아님), error: 길이 오류, valid: 사용할 수 있는 닉네임
export type NicknameFeedbackTone = 'neutral' | 'error' | 'valid'

export interface NicknameFeedback {
  tone: NicknameFeedbackTone
  message: string
  // 글자 수. 검증과 같은 기준(앞뒤 공백 제거 후 코드포인트)이다.
  count: number
  // "다음"을 누를 수 있는가
  canSubmit: boolean
}

// 입력값에 맞는 안내를 계산한다. 빈 값·공백만 입력은 오류가 아니라 중립 안내다.
export function getNicknameFeedback(raw: string): NicknameFeedback {
  const result = validateNickname(raw)
  const count = countNicknameChars(result.value)
  if (result.valid) return { tone: 'valid', message: NICKNAME_VALID_MESSAGE, count, canSubmit: true }
  switch (result.reason) {
    case 'empty':
      return { tone: 'neutral', message: NICKNAME_HINT_MESSAGE, count, canSubmit: false }
    case 'tooShort':
      return { tone: 'error', message: NICKNAME_TOO_SHORT_MESSAGE, count, canSubmit: false }
    case 'tooLong':
      return { tone: 'error', message: NICKNAME_TOO_LONG_MESSAGE, count, canSubmit: false }
  }
}

// 아바타에 표시할 첫 글자. 앞뒤 공백을 제거한 뒤 첫 코드포인트이고, 입력이 없으면 빈 문자열이다.
export function getNicknameInitial(raw: string): string {
  const { value } = validateNickname(raw)
  return [...value][0] ?? ''
}

// 저장에 필요한 Store 액션만 받는다. profileStore.getState()를 그대로 넘기거나 테스트용 가짜를 넘길 수 있다.
export type NicknameWriter = Pick<ProfileState, 'setProfile'>

// "다음" 클릭 시 닉네임을 저장한다. 유효하지 않으면 아무것도 저장하지 않고 false를 돌려준다.
// 저장하는 값은 앞뒤 공백을 제거한 값이다.
export function submitNickname(writer: NicknameWriter, raw: string): boolean {
  const result = validateNickname(raw)
  if (!result.valid) return false
  writer.setProfile({ nickname: result.value })
  return true
}
