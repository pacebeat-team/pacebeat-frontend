import type { OnboardingData } from '../types/onboarding.ts'

// 진입 경로 판단에 필요한 온보딩 상태
export type EntryOnboardingState = Pick<OnboardingData, 'onboardingCompleted' | 'baselineMeasurementCompleted'>

// Splash가 끝난 뒤 사용자의 진행 상태에 맞는 첫 화면 경로를 정한다. (순수 함수)
// 우선순위는 위에서 아래로 처음 맞는 것이다.
// 1) 온보딩 미완료: 프로필과 기초 측정 상태와 관계없이 Intro
// 2) 프로필 미완료: 프로필 이어하기 경로 (profileResumePath가 null이 아니다)
// 3) 기초 측정 미완료: 측정 Guide
// 4) 모두 완료: Home
// profileResumePath는 프로필 Store에서 계산한 값이다. null이면 프로필을 완료한 것이다. (getProfileResumePath)
// 이 파일은 Store를 알지 못한다. 두 Store를 읽어 이 함수에 넘기는 일은 앱 계층(app/entryFlow.ts)이 한다.
export function getEntryPath(
  state: EntryOnboardingState,
  profileResumePath: string | null,
): string {
  if (!state.onboardingCompleted) return '/onboarding/intro'
  if (profileResumePath !== null) return profileResumePath
  if (!state.baselineMeasurementCompleted) return '/measurement/guide'
  return '/home'
}
