import type { OnboardingData } from '../types/onboarding.ts'

// Splash가 끝난 뒤 사용자의 진행 상태에 맞는 첫 화면 경로를 정한다. (순수 함수)
// - 온보딩 미완료: 기초 측정 완료 여부와 관계없이 Intro
// - 온보딩 완료, 기초 측정 미완료: 측정 Guide
// - 둘 다 완료: Home
export function getEntryPath(
  state: Pick<OnboardingData, 'onboardingCompleted' | 'baselineMeasurementCompleted'>,
): string {
  if (!state.onboardingCompleted) return '/onboarding/intro'
  if (!state.baselineMeasurementCompleted) return '/measurement/guide'
  return '/home'
}
