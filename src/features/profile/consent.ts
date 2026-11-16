import type { ProfileState } from './profileStore.ts'
import { OPTIONAL_CONSENT_KEYS, REQUIRED_CONSENT_KEYS } from './types.ts'
import type { ConsentData, ConsentKey } from './types.ts'

// 가입 동의 화면의 순수 로직. React와 profileStore 인스턴스에 의존하지 않는다.
// 화면은 선택 상태(ConsentDraft)를 자체 상태로 들고 있다가, CTA를 누를 때만 submitConsent로 Store에 저장한다.

// 동의 항목 순서와 문구는 Figma PROFILE / Consent 원문을 따른다.
export interface ConsentItem {
  key: ConsentKey
  label: string
  required: boolean
  // "보기"(약관 상세)가 있는가. 만 14세 이상 항목에는 없다.
  hasDetail: boolean
}

const REQUIRED_KEYS: readonly ConsentKey[] = REQUIRED_CONSENT_KEYS

export const CONSENT_ITEMS: readonly ConsentItem[] = [
  { key: 'ageOver14', label: '[필수] 만 14세 이상이에요', hasDetail: false },
  { key: 'termsOfService', label: '[필수] 서비스 이용약관', hasDetail: true },
  { key: 'privacyPolicy', label: '[필수] 개인정보 수집·이용', hasDetail: true },
  { key: 'locationTerms', label: '[필수] 위치기반서비스 이용약관', hasDetail: true },
  { key: 'marketing', label: '[선택] 마케팅 정보 수신', hasDetail: true },
].map((item) => ({ ...item, key: item.key as ConsentKey, required: REQUIRED_KEYS.includes(item.key as ConsentKey) }))

// 필수 4개 + 선택 1개
export const ALL_CONSENT_KEYS: readonly ConsentKey[] = [...REQUIRED_CONSENT_KEYS, ...OPTIONAL_CONSENT_KEYS]

// 약관 버전은 아직 확정되지 않아 null로 기록한다. 확정되면 이 값만 바꾼다.
export const CONSENT_POLICY_VERSION: string | null = null

// Figma `consent / requirement` 문구
export const REQUIREMENT_UNMET_MESSAGE = '필수 항목에 동의하면 계속할 수 있어요.'
export const REQUIREMENT_MET_MESSAGE = '선택 항목에 동의하지 않아도 가입할 수 있어요.'

// 화면 안에서만 쓰는 임시 선택 상태. Store에는 CTA를 누를 때 저장한다.
export type ConsentDraft = Record<ConsentKey, boolean>

// 모두 선택하지 않은 상태. 이미 저장된 동의가 있으면 5개 항목 값을 초기값으로 쓴다.
export function createInitialDraft(saved?: Pick<ConsentData, ConsentKey>): ConsentDraft {
  const draft = {} as ConsentDraft
  for (const key of ALL_CONSENT_KEYS) {
    draft[key] = saved?.[key] ?? false
  }
  return draft
}

// 전체 동의가 선택된 상태인가. 필수 4개와 선택 1개가 모두 선택되어야 한다.
export function isAllChecked(draft: ConsentDraft): boolean {
  return ALL_CONSENT_KEYS.every((key) => draft[key])
}

// 전체 동의 클릭: 5개가 모두 선택되어 있으면 전체 해제, 하나라도 빠져 있으면 전체 선택
export function toggleAll(draft: ConsentDraft): ConsentDraft {
  const next = !isAllChecked(draft)
  const result = {} as ConsentDraft
  for (const key of ALL_CONSENT_KEYS) {
    result[key] = next
  }
  return result
}

// 개별 항목 선택·해제. 원본은 바꾸지 않는다.
export function toggleItem(draft: ConsentDraft, key: ConsentKey): ConsentDraft {
  return { ...draft, [key]: !draft[key] }
}

// 필수 동의 4개를 모두 선택했는가. CTA 활성화 조건이며 마케팅 동의는 포함하지 않는다.
export function canContinue(draft: ConsentDraft): boolean {
  return REQUIRED_CONSENT_KEYS.every((key) => draft[key])
}

// CTA 아래 안내 문구. 필수 동의가 모자라면 계속할 수 있는 조건을, 충족하면 선택 항목 안내를 돌려준다.
export function getRequirementMessage(draft: ConsentDraft): string {
  return canContinue(draft) ? REQUIREMENT_MET_MESSAGE : REQUIREMENT_UNMET_MESSAGE
}

// 저장에 필요한 Store 액션만 받는다. profileStore.getState()를 그대로 넘기거나 테스트용 가짜를 넘길 수 있다.
export type ConsentWriter = Pick<ProfileState, 'setConsent' | 'recordConsent'>

export interface SubmitConsentOptions {
  now?: number
  policyVersion?: string | null
}

// CTA 클릭 시 동의를 저장한다. 필수 동의가 모자라면 아무것도 저장하지 않고 false를 돌려준다.
// 동의 항목(setConsent)을 먼저 저장하고 약관 버전과 시각(recordConsent)을 나중에 기록한다.
// 그래서 저장된 값에 동의 시각이 있으면 동의 항목도 저장되어 있다.
export function submitConsent(
  writer: ConsentWriter,
  draft: ConsentDraft,
  options: SubmitConsentOptions = {},
): boolean {
  if (!canContinue(draft)) return false
  const { now = Date.now(), policyVersion = CONSENT_POLICY_VERSION } = options
  writer.setConsent(createInitialDraft(draft))
  writer.recordConsent(policyVersion, now)
  return true
}
