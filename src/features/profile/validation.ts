import { NICKNAME_MAX, NICKNAME_MIN } from './types.ts'

// 닉네임 글자 수. 검증과 화면의 글자 수 표시(예: "2 / 10")가 같은 기준을 쓰도록 이 함수를 함께 사용한다.
// 코드포인트 기준이라 이모지 하나도 1자로 센다.
export function countNicknameChars(value: string): number {
  return [...value].length
}

// 저장하거나 검증하기 전에 앞뒤 공백을 제거한다.
export function normalizeNickname(raw: string): string {
  return raw.trim()
}

export type NicknameInvalidReason = 'empty' | 'tooShort' | 'tooLong'

// value는 앞뒤 공백을 제거한 값이다.
export type NicknameValidation =
  | { valid: true; value: string }
  | { valid: false; reason: NicknameInvalidReason; value: string }

// 공백 제거 후 길이로 판단한다. 0자(공백만 포함)는 empty, 2자 미만은 tooShort, 10자 초과는 tooLong.
export function validateNickname(raw: string): NicknameValidation {
  const value = normalizeNickname(raw)
  const length = countNicknameChars(value)
  if (length === 0) return { valid: false, reason: 'empty', value }
  if (length < NICKNAME_MIN) return { valid: false, reason: 'tooShort', value }
  if (length > NICKNAME_MAX) return { valid: false, reason: 'tooLong', value }
  return { valid: true, value }
}

// 아래 세 함수는 null(미입력)을 허용한다. 범위와 소수점 자릿수는 정책 확정 전이라 제한하지 않는다.

// 출생연도: 양의 정수
export function isValidBirthYear(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value > 0)
}

// 키(cm): 양의 유한 숫자
export function isValidHeightCm(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value > 0)
}

// 몸무게(kg): 양의 유한 숫자
export function isValidWeightKg(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value > 0)
}
