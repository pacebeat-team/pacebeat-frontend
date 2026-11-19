import { BASELINE_MIN_VALID_MS } from '../features/measurement/baseline.ts'
import type { MeasurementData } from '../stores/measurementStore.ts'

// 기초 측정을 완료했는가 (순수 함수).
// 세 조건을 모두 만족해야 한다.
//   1) 세션이 종료(finished)되었다.
//   2) 실제 GPS 측정이다. (가상 측정은 유효 시간과 관계없이 항상 제외)
//   3) 유효 측정 시간(metrics.validMs)이 BASELINE_MIN_VALID_MS 이상이다.
// 종료 사유(사용자/자동)와 GPS 오류 여부는 보지 않는다. GPS 오류는 세션을 끝내지 않고 tracker에만 기록되며,
// 오류가 나기 전까지 쌓인 유효 시간이 기준 이상이면 완료로 본다.
export function isBaselineMeasurementCompleted(
  measurement: Pick<MeasurementData, 'session' | 'runSource' | 'metrics'>,
): boolean {
  const { session, runSource, metrics } = measurement
  if (session === null || runSource === null) {
    return false
  }
  return (
    session.status === 'finished' &&
    runSource.kind === 'real' &&
    metrics.validMs >= BASELINE_MIN_VALID_MS
  )
}

// 연결에 필요한 최소한의 Store 모양. 실제 Store와 테스트용 가짜가 모두 맞출 수 있다.
export interface MeasurementSource {
  getState(): Pick<MeasurementData, 'session' | 'runSource' | 'metrics'>
  subscribe(listener: () => void): () => void
}

export interface OnboardingTarget {
  getState(): {
    readonly baselineMeasurementCompleted: boolean
    readonly completeBaselineMeasurement: () => void
  }
}

// 측정 Store의 변화를 지켜보다가 기초 측정 완료 조건을 만족하면 온보딩 Store에 완료를 기록한다.
// - 상태 기반이고 멱등이다. 이미 완료로 기록됐으면 아무 것도 하지 않는다.
// - 등록하는 순간 현재 상태도 한 번 확인한다. (복원(hydrate)이 먼저 일어났어도 놓치지 않는다.)
// - 돌려주는 함수를 부르면 구독을 해제한다.
export function startBaselineCompletionSync(
  measurement: MeasurementSource,
  onboarding: OnboardingTarget,
): () => void {
  function check(): void {
    const target = onboarding.getState()
    if (target.baselineMeasurementCompleted) {
      return
    }
    if (isBaselineMeasurementCompleted(measurement.getState())) {
      target.completeBaselineMeasurement()
    }
  }

  const unsubscribe = measurement.subscribe(check)
  check()
  return unsubscribe
}
