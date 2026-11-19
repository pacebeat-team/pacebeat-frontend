// Figma ONBOARDING / Experience 선택지: 거의 처음이에요 / 가끔 달려요 / 꾸준히 달려요
export type ExperienceLevel = 'beginner' | 'occasional' | 'regular'

// Figma ONBOARDING / Experience 선택지: 1회 / 2회 / 3회 이상
export type WeeklyRuns = '1' | '2' | '3+'

// 아직 요청/확인하지 않은 상태는 null입니다.
export type LocationPermission = 'granted' | 'denied' | null
export type MotionFitnessSupport = 'supported' | 'unsupported' | null

export interface OnboardingData {
  experienceLevel: ExperienceLevel | null
  weeklyRuns: WeeklyRuns | null
  locationPermission: LocationPermission
  motionFitnessSupport: MotionFitnessSupport
  // 위치 권한 거부 시 시간 전용 러닝을 고려한 상태
  timeOnlyMode: boolean | null
}
