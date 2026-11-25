import type { FullGuidancePayload, GuidanceSettingsPayload, UserProfileResponse } from '../lib/api/types.ts'

// 테스트 전용: 비어 있는 서버 프로필(채울 값 없음)에 안내 설정만 실은 GET /users/me 응답.
// 실제 서버의 값이 아니라 가짜 API의 응답이다.
export const SERVER_GUIDANCE_FIXTURE: FullGuidancePayload = {
  voice_guidance_enabled: true,
  vibration_guidance_enabled: false,
  guidance_frequency_km: 2.5,
  vibration_intensity: 'high',
}

export function blankServerProfile(guidance: GuidanceSettingsPayload = SERVER_GUIDANCE_FIXTURE): UserProfileResponse {
  return {
    user_id: 'u', nickname: null, birth_year: null, gender: null, height_cm: null, weight_kg: null, running_experience: null, weekly_runs: null,
    consent: { age_over_14: false, terms_of_service: false, privacy_policy: false, location_terms: false, marketing: false, policy_version: null, consented_at: null },
    guidance, onboarding_completed_at: null, profile_completed_at: null,
  } as unknown as UserProfileResponse
}
