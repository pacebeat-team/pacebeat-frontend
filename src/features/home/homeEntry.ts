import type { RunSetupState } from '../running/runSetupStore.ts'

// Home의 "러닝 시작하기"는 목표 화면을 거치지 않고 음악 화면으로 간다.
// RunFlowGuard가 되돌리지 않도록 이동 전에 목표 단계를 확정한다(단계는 낮아지지 않는다).
export function confirmGoalForHomeStart(setup: { getState: () => Pick<RunSetupState, 'confirmGoal'> }): void {
  setup.getState().confirmGoal()
}
