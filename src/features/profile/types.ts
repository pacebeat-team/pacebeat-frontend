// null은 미선택 또는 건너뛴 상태를 뜻한다.
export type Gender = 'female' | 'male' | null

// 입력하지 않은 값은 null로 둔다. 숫자 0을 미입력으로 쓰지 않는다.
export interface ProfileData {
  nickname: string
  birthYear: number | null
  gender: Gender
  heightCm: number | null
  weightKg: number | null
}

// 가입 동의 항목. 필수 4개와 선택 1개를 구분한다. (Figma PROFILE / Consent)
export const REQUIRED_CONSENT_KEYS = [
  'ageOver14',
  'termsOfService',
  'privacyPolicy',
  'locationTerms',
] as const
export const OPTIONAL_CONSENT_KEYS = ['marketing'] as const

export type RequiredConsentKey = (typeof REQUIRED_CONSENT_KEYS)[number]
export type OptionalConsentKey = (typeof OPTIONAL_CONSENT_KEYS)[number]
export type ConsentKey = RequiredConsentKey | OptionalConsentKey

export type ConsentData = Record<ConsentKey, boolean> & {
  // 동의한 시점의 약관 버전. 실제 값은 정책 확정 후 정한다.
  policyVersion: string | null
  // 동의한 시각 (Unix epoch milliseconds)
  consentedAt: number | null
}

// 닉네임 길이 (글자 수는 validation.ts의 countNicknameChars 기준)
export const NICKNAME_MIN = 2
export const NICKNAME_MAX = 10
