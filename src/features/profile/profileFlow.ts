import { submitBody } from './body.ts'
import type { BodyDraft } from './body.ts'
import type { ProfileState } from './profileStore.ts'
import { PROFILE_ROUTES } from './routes.ts'
import { REQUIRED_CONSENT_KEYS } from './types.ts'
import { validateNickname } from './validation.ts'

// 프로필 가입 흐름의 순수 로직. React와 profileStore 인스턴스에 의존하지 않는다.
// 완료 여부 판정, 미완료 단계 재개 경로, 단계별 접근 조건, 마지막 화면의 완료 처리를 한곳에 둔다.
//
// 가입 완료 정책
// - 필수 동의 4개와 유효한 닉네임이 필요하다. 출생연도·성별·키·몸무게는 선택이다.
// - 위 두 조건만으로는 완료로 보지 않는다. 키·몸무게 화면에서 "시작하기"나 "건너뛰기"를 눌러 completedAt을 기록해야 한다.

// 판정에 필요한 Store 값
export type ProfileFlowState = Pick<ProfileState, 'profile' | 'consent' | 'completedAt'>

export type ProfileStep = 'consent' | 'nickname' | 'demographics' | 'body'

// 필수 동의 4개를 모두 선택했고 동의한 시각이 기록돼 있는가.
// (동의 시각은 동의 항목을 저장한 뒤에 기록되므로, 시각이 있으면 항목도 저장돼 있다.)
export function hasRequiredConsent(state: Pick<ProfileFlowState, 'consent'>): boolean {
  const { consent } = state
  return consent.consentedAt !== null && REQUIRED_CONSENT_KEYS.every((key) => consent[key])
}

// 저장된 닉네임이 유효한가. (2~10자, 앞뒤 공백 제외)
export function hasValidNickname(state: Pick<ProfileFlowState, 'profile'>): boolean {
  return validateNickname(state.profile.nickname).valid
}

// 프로필 가입을 완료했는가. 선택 항목(출생연도·성별·키·몸무게)은 보지 않는다.
export function isProfileComplete(state: ProfileFlowState): boolean {
  return hasRequiredConsent(state) && hasValidNickname(state) && state.completedAt !== null
}

// 가입이 끝나지 않은 사용자가 이어서 가야 할 화면. 가입을 완료했으면 null이다.
// 동의와 닉네임을 마친 사용자는 선택 입력 첫 화면(출생연도·성별)으로 보낸다.
export function getProfileResumePath(state: ProfileFlowState): string | null {
  if (!hasRequiredConsent(state)) return PROFILE_ROUTES.consent
  if (!hasValidNickname(state)) return PROFILE_ROUTES.nickname
  if (state.completedAt === null) return PROFILE_ROUTES.demographics
  return null
}

// 이 단계 화면을 지금 열 수 있는가.
// 가입을 완료한 사용자는 어느 단계도 열 수 없다. 가입이 끝난 뒤 브라우저 뒤로 가기 등으로 입력 화면에 다시 들어오지 못하게 한다.
// (이미 완료한 프로필을 고치는 흐름은 이 가입 흐름이 아니라 이후 프로필 수정에서 따로 다룬다.)
// 가입을 완료하지 않았다면 단계마다 다음이 필요하다.
// - consent: 항상 허용한다. 가입 도중에 닉네임 화면에서 뒤로 가 돌아올 수 있어야 한다.
// - nickname: 필수 동의가 필요하다.
// - demographics, body: 필수 동의와 유효한 닉네임이 필요하다.
export function isStepAccessible(step: ProfileStep, state: ProfileFlowState): boolean {
  if (isProfileComplete(state)) return false
  switch (step) {
    case 'consent':
      return true
    case 'nickname':
      return hasRequiredConsent(state)
    case 'demographics':
    case 'body':
      return hasRequiredConsent(state) && hasValidNickname(state)
  }
}

const STEP_BY_PATH: Readonly<Record<string, ProfileStep>> = {
  [PROFILE_ROUTES.consent]: 'consent',
  [PROFILE_ROUTES.nickname]: 'nickname',
  [PROFILE_ROUTES.demographics]: 'demographics',
  [PROFILE_ROUTES.body]: 'body',
}

// 경로에서 프로필 단계를 찾는다. 대소문자, 인코딩, 끝의 "/", 겹친 "/"는 무시한다. 라우터가 같은 경로로 인식하는 모양은 같은 단계로 본다.
// 프로필 단계가 아니면 null이다. 호출하는 쪽에는 query와 hash를 뺀 pathname만 넘긴다.
export function getStepFromPath(pathname: string): ProfileStep | null {
  // 라우터는 %63onsent 같은 인코딩된 경로도 같은 화면으로 연결한다. 같은 모양으로 풀어서 판단한다. (풀 수 없는 경로는 그대로 쓴다.)
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // 잘못된 인코딩은 라우터도 일치시키지 못하므로 원문으로 판단한다.
  }
  const normalized = decoded.toLowerCase().replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1')
  return STEP_BY_PATH[normalized] ?? null
}

// 완료 처리에 필요한 Store 값과 액션만 받는다. profileStore.getState()를 그대로 넘기거나 테스트용 가짜를 넘길 수 있다.
export type ProfileFinisher = ProfileFlowState & Pick<ProfileState, 'setProfile' | 'completeProfile'>

// 키·몸무게 화면의 마지막 버튼을 눌렀을 때 가입을 완료한다. 성공하면 true다.
// - draft가 있으면("시작하기") 키·몸무게를 검증해 저장한 뒤 완료한다. 값이 선택 범위를 벗어나면 아무것도 저장하지 않고 완료하지 않는다.
// - draft가 null이면("건너뛰기") 키·몸무게는 건드리지 않고 완료만 기록한다. 이미 저장된 값은 그대로 남는다.
// - 필수 동의와 유효한 닉네임이 없으면 화면 가드와 관계없이 완료하지 않는다.
// 저장소 쓰기가 실패해도 예외 없이 메모리 상태만 바뀌는 Store의 기존 정책은 그대로이며, 이 함수가 영속성을 보장하지는 않는다.
// 반환값은 성공 여부뿐이다. state는 부르는 시점의 최신 값(profileStore.getState())을 넘겨야 하며, 오래된 스냅샷을 넘기면 오래된 값으로 판단한다.
// 이미 completedAt이 있으면 첫 시각을 유지한다. 한 번 완료한 뒤 동의나 닉네임이 잘못되었다가 다시 채워지면, 이미 거친 완료는 다시 요구하지 않고 그대로 완료로 본다.
export function finishProfile(state: ProfileFinisher, draft: BodyDraft | null): boolean {
  if (!hasRequiredConsent(state) || !hasValidNickname(state)) return false
  if (draft !== null && !submitBody(state, draft)) return false
  state.completeProfile()
  return true
}
