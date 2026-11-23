import { api } from '../../lib/api/index.ts'
import { auth } from '../../lib/auth/index.ts'
import { getMetrics } from '../measurement/metrics.ts'
import { measurementStore } from '../../stores/measurementStore.ts'
import { useOnboardingStore } from '../../stores/onboardingStore.ts'
import { profileStore } from '../profile/profileStore.ts'
import { runResultStore } from '../running/runResultStore.ts'
import { createRunStorage } from '../running/runStorage.ts'
import { deriveRecordId } from '../running/record.ts'
import { baselineRequestFromMetrics, createSyncRuntime } from './syncRuntime.ts'

// 앱 시작 때 한 번 연결한다(main.tsx가 App보다 먼저 불러온다). api가 null이거나 로그인하지 않았으면 아무 일도 하지 않는다.
function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export const syncRuntime = createSyncRuntime({
  getApi: () => api,
  isSignedIn: () => auth.getState().status === 'signedIn',
  queueStorage: browserStorage(),
})

const stops: Array<() => void> = []

// 러닝 기록: 결과 저장이 성공하는 순간(saved: false→true) 로컬 기록을 읽어 대기열에 넣는다(로컬 저장은 이미 끝난 상태).
let wasSaved = runResultStore.getState().saved
stops.push(
  runResultStore.subscribe((state) => {
    if (state.saved && !wasSaved && state.sessionId !== null) {
      const record = createRunStorage().getRecord(deriveRecordId(state.sessionId))
      if (record !== null) void syncRuntime.syncRun(record)
    }
    wasSaved = state.saved
  }),
)

// 프로필: 가입 완료 시각이 기록되면(처음 완료) 한 번 보낸다. 입력하지 않은 값은 null 그대로 보낸다.
let wasProfileDone = profileStore.getState().completedAt !== null
stops.push(
  profileStore.subscribe((state) => {
    const done = state.completedAt !== null
    if (done && !wasProfileDone) {
      const onboarding = useOnboardingStore.getState()
      void syncRuntime.syncProfile({
        profile: state.profile,
        consent: state.consent,
        completedAt: state.completedAt,
        experienceLevel: onboarding.experienceLevel,
        weeklyRuns: onboarding.weeklyRuns,
      })
    }
    wasProfileDone = done
  }),
)

// 기초 측정: 완료 표시가 처음 true가 될 때 측정값으로 보낸다(기준 페이스는 기존 computeBaselinePace).
let wasBaselineDone = useOnboardingStore.getState().baselineMeasurementCompleted
stops.push(
  useOnboardingStore.subscribe((state) => {
    if (state.baselineMeasurementCompleted && !wasBaselineDone) {
      const { metrics, session, now } = measurementStore.getState()
      // 종료된 실제 측정만 보낸다. 세션이 없으면 보내지 않는다(0·가짜 값 금지).
      if (session !== null) void syncRuntime.syncBaseline(baselineRequestFromMetrics(getMetrics(metrics, session, now), session.endedAt))
    }
    wasBaselineDone = state.baselineMeasurementCompleted
  }),
)

// 앱 시작·로그인·온라인 복구 때 대기열을 이어서 보낸다.
stops.push(
  auth.onAuthStateChange((state) => {
    if (state.status === 'signedIn') void syncRuntime.resume()
  }),
)
if (typeof window !== 'undefined') {
  const onOnline = () => void syncRuntime.resume()
  window.addEventListener('online', onOnline)
  stops.push(() => window.removeEventListener('online', onOnline))
}
void syncRuntime.resume()

if (import.meta.hot) {
  import.meta.hot.dispose(() => stops.forEach((stop) => stop()))
}
