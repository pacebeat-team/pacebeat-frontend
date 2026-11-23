import type { ConsentPayload, UserProfileResponse, UserProfileUpdateRequest } from '../../lib/api/types.ts'
import type { ExperienceLevel, WeeklyRuns } from '../../types/onboarding.ts'
import type { ConsentData, ProfileData } from '../profile/types.ts'
import { REQUIRED_CONSENT_KEYS } from '../profile/types.ts'
import { fromIso, toIso } from './time.ts'

// 로컬 프로필·동의·온보딩 ↔ 서버 UserProfile 변환(순수 함수). Store·화면과 연결하지 않았다.
// 로컬→서버 이전 시점·충돌 해결 정책은 확정되지 않았으므로 여기서 정하지 않는다(변환만 한다).
// 입력하지 않은 값(null)은 서버로도 null로 보낸다. 0이나 빈 문자열로 바꾸지 않는다.

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

// onboarding_completed_at은 로컬에 완료 "시각"이 없고(불리언만 있다) 임의로 만들 수 없어서 보내지 않는다.
export function toProfileUpdateRequest(local: LocalProfileSnapshot): UserProfileUpdateRequest {
  const consent = toConsentPayload(local.consent)
  const profileCompletedAt = toIso(local.completedAt)
  return {
    nickname: local.profile.nickname === '' ? null : local.profile.nickname,
    birth_year: local.profile.birthYear,
    gender: local.profile.gender,
    height_cm: local.profile.heightCm,
    weight_kg: local.profile.weightKg,
    running_experience: local.experienceLevel,
    weekly_runs: local.weeklyRuns,
    ...(consent === undefined ? {} : { consent }),
    ...(profileCompletedAt === null ? {} : { profile_completed_at: profileCompletedAt }),
  }
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
