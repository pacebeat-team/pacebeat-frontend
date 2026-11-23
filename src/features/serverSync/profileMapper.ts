import type { ConsentPayload, UserProfileResponse, UserProfileUpdateRequest } from '../../lib/api/types.ts'
import type { ExperienceLevel, WeeklyRuns } from '../../types/onboarding.ts'
import type { ConsentData, ProfileData } from '../profile/types.ts'
import { REQUIRED_CONSENT_KEYS } from '../profile/types.ts'
import { fromIso, toIso } from './time.ts'

// 로컬 프로필·동의·온보딩 ↔ 서버 UserProfile 변환(순수 함수). Store·화면과 연결하지 않았다.
// 로컬→서버 이전 시점·충돌 해결 정책은 확정되지 않았으므로 여기서 정하지 않는다(변환만 한다).
// 입력하지 않은 값은 보내지 않는다(0이나 빈 문자열로 바꾸지 않는다). 지우기(null)는 사용자가 있던 값을 직접 지웠을 때만 보낸다.

export interface LocalProfileSnapshot {
  readonly profile: ProfileData
  readonly consent: ConsentData
  readonly completedAt: number | null
  readonly experienceLevel: ExperienceLevel | null
  readonly weeklyRuns: WeeklyRuns | null
}

// 필수 동의 4개가 모두 true일 때만 동의를 보낸다. 일부만 동의한 상태를 서버에 기록하지 않는다.
function toConsentPayload(consent: ConsentData): ConsentPayload | undefined {
  if (!REQUIRED_CONSENT_KEYS.every((key) => consent[key])) return undefined
  return {
    age_over_14: consent.ageOver14,
    terms_of_service: consent.termsOfService,
    privacy_policy: consent.privacyPolicy,
    location_terms: consent.locationTerms,
    marketing: consent.marketing,
    policy_version: consent.policyVersion,
    consented_at: toIso(consent.consentedAt),
  }
}

// 서버 PATCH /users/me는 "보내지 않은 필드는 유지, null로 보낸 필드는 null로 덮어쓴다"로 동작한다(백엔드 코드 확인, 실서버 미검증. OpenAPI 스키마에는 이 구분이 나오지 않는다).
// 그래서 로컬에서 비어 있는 값(미입력)은 필드를 아예 보내지 않고(서버 값 유지), 사용자가 이미 있던 값을 직접 지운 경우에만 null을 보낸다.
// 지울 수 있는 필드: 출생연도·성별·키·몸무게(프로필 화면에서 선택을 해제할 수 있다). 닉네임(2~10자 필수)·러닝 경험·주간 횟수는 지우는 화면이 없어 지우기를 보내지 않는다.
export const CLEARABLE_PROFILE_FIELDS = ['birth_year', 'gender', 'height_cm', 'weight_kg'] as const
export type ClearableProfileField = (typeof CLEARABLE_PROFILE_FIELDS)[number]

export function isClearableProfileField(value: unknown): value is ClearableProfileField {
  return typeof value === 'string' && (CLEARABLE_PROFILE_FIELDS as readonly string[]).includes(value)
}

// onboarding_completed_at은 로컬에 완료 "시각"이 없고(불리언만 있다) 임의로 만들 수 없어서 보내지 않는다.
// clear에 든 필드가 로컬에서도 비어 있을 때만 그 필드를 null(명시적 삭제)로 보낸다. 값이 있으면 항상 값을 보낸다.
export function toProfileUpdateRequest(local: LocalProfileSnapshot, clear: ReadonlySet<ClearableProfileField> = new Set()): UserProfileUpdateRequest {
  const consent = toConsentPayload(local.consent)
  const profileCompletedAt = toIso(local.completedAt)
  const { profile } = local
  const cleared = (field: ClearableProfileField) => clear.has(field)
  return {
    ...(profile.nickname === '' ? {} : { nickname: profile.nickname }),
    ...(profile.birthYear !== null ? { birth_year: profile.birthYear } : cleared('birth_year') ? { birth_year: null } : {}),
    ...(profile.gender !== null ? { gender: profile.gender } : cleared('gender') ? { gender: null } : {}),
    ...(profile.heightCm !== null ? { height_cm: profile.heightCm } : cleared('height_cm') ? { height_cm: null } : {}),
    ...(profile.weightKg !== null ? { weight_kg: profile.weightKg } : cleared('weight_kg') ? { weight_kg: null } : {}),
    ...(local.experienceLevel === null ? {} : { running_experience: local.experienceLevel }),
    ...(local.weeklyRuns === null ? {} : { weekly_runs: local.weeklyRuns }),
    ...(consent === undefined ? {} : { consent }),
    ...(profileCompletedAt === null ? {} : { profile_completed_at: profileCompletedAt }),
  }
}

// 대기 중인 요청을 보내기 직전에 한 번 더 거른다: 명시적 삭제로 기록되지 않은 null은 빼고 보낸다.
// (이전 버전이 저장해 둔 스냅샷은 비어 있는 값을 전부 null로 담고 있어, 그대로 보내면 서버 값을 지운다.)
export function sanitizeProfileRequest(request: UserProfileUpdateRequest, clear: ReadonlySet<ClearableProfileField>): UserProfileUpdateRequest {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(request)) {
    if (value === undefined) continue
    if (value === null && !(isClearableProfileField(key) && clear.has(key))) continue
    out[key] = value
  }
  return out as UserProfileUpdateRequest
}

// 이전 프로필 → 새 프로필에서 사용자가 값을 지운(있던 값이 비게 된) 필드.
export function clearedProfileFields(before: ProfileData, after: ProfileData): ClearableProfileField[] {
  const out: ClearableProfileField[] = []
  if (before.birthYear !== null && after.birthYear === null) out.push('birth_year')
  if (before.gender !== null && after.gender === null) out.push('gender')
  if (before.heightCm !== null && after.heightCm === null) out.push('height_cm')
  if (before.weightKg !== null && after.weightKg === null) out.push('weight_kg')
  return out
}

export interface RemoteProfileView {
  readonly userId: string
  readonly profile: ProfileData
  readonly consent: ConsentData
  readonly completedAt: number | null
  readonly onboardingCompletedAt: number | null
  readonly experienceLevel: ExperienceLevel | null
  readonly weeklyRuns: WeeklyRuns | null
}

export function fromUserProfileResponse(response: UserProfileResponse): RemoteProfileView {
  const c = response.consent
  return {
    userId: response.user_id,
    profile: {
      nickname: response.nickname ?? '',
      birthYear: response.birth_year,
      gender: response.gender,
      heightCm: response.height_cm,
      weightKg: response.weight_kg,
    },
    consent: {
      ageOver14: c.age_over_14,
      termsOfService: c.terms_of_service,
      privacyPolicy: c.privacy_policy,
      locationTerms: c.location_terms,
      marketing: c.marketing ?? false,
      policyVersion: c.policy_version ?? null,
      consentedAt: fromIso(c.consented_at),
    },
    completedAt: fromIso(response.profile_completed_at),
    onboardingCompletedAt: fromIso(response.onboarding_completed_at),
    experienceLevel: response.running_experience,
    weeklyRuns: response.weekly_runs ?? null,
  }
}
