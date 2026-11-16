import { startBaselineCompletionSync } from '../lib/baselineCompletion'
import { measurementStore } from '../stores/measurementStore'
import { useOnboardingStore } from '../stores/onboardingStore'

// 측정 Store와 온보딩 Store를 연결한다. main.tsx가 App보다 먼저 불러 앱 시작 때 한 번 등록한다.
// 모듈은 한 번만 실행되므로 구독이 중복 등록되지 않고, HMR로 다시 실행될 때는 이전 구독을 해제한다.
const stopSync = startBaselineCompletionSync(measurementStore, useOnboardingStore)

if (import.meta.hot) {
  import.meta.hot.dispose(stopSync)
}
