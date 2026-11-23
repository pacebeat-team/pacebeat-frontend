import type { ExperienceLevel, LocationPermission, MotionFitnessSupport } from '../types/onboarding.ts'

// 온보딩 단계의 규칙을 화면 밖에서 검증할 수 있도록 순수 함수로 모았다. 화면(Experience, Permissions)이 그대로 쓴다.
// Store는 읽기·쓰기 함수만 받으므로 실제 Store와 테스트용 가짜가 모두 맞출 수 있다.

// Experience: 러닝 경험 수준(필수)을 골라야 다음으로 갈 수 있다. 주당 러닝 횟수는 선택이라 조건에 넣지 않는다.
export function canContinueFromExperience(experienceLevel: ExperienceLevel | null): boolean {
  return experienceLevel !== null
}

// Permissions 단계가 Store에 쓰는 함수들 중 필요한 것만.
export interface PermissionStepWriter {
  setLocationPermission: (value: LocationPermission) => void
  setMotionFitnessSupport: (value: MotionFitnessSupport) => void
  completeOnboarding: () => void
}

// "권한 확인하고 계속"을 마쳤을 때: 허용·거부·판단 불가 어느 경우든 온보딩을 완료로 기록한다.
// - 위치 권한이 판단 불가(null)이면 기존에 저장된 허용/거부 값을 덮어쓰지 않는다.
// - 동작·피트니스 지원 여부는 확인한 값을 그대로 저장한다. (판단 불가여도 저장)
export function recordPermissionStep(
  writer: PermissionStepWriter,
  locationPermission: LocationPermission,
  motionFitnessSupport: MotionFitnessSupport,
): void {
  if (locationPermission !== null) writer.setLocationPermission(locationPermission)
  writer.setMotionFitnessSupport(motionFitnessSupport)
  writer.completeOnboarding()
}

// "나중에 할게요": 권한을 요청하지 않으므로 권한·지원 여부는 건드리지 않고 온보딩만 완료로 기록한다.
export function skipPermissionStep(writer: Pick<PermissionStepWriter, 'completeOnboarding'>): void {
  writer.completeOnboarding()
}
