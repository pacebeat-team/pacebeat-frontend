import { getProfileResumePath } from '../features/profile/profileFlow.ts'
import type { ProfileFlowState } from '../features/profile/profileFlow.ts'
import { profileStore } from '../features/profile/profileStore.ts'
import { getEntryPath } from '../lib/entryPath.ts'
import { getRouteRedirect } from '../lib/routeAccess.ts'
import type { EntryOnboardingState } from '../lib/entryPath.ts'
import { isDevBuild } from '../lib/devEnv.ts'
import { measurementStore, parseUrlMode } from '../stores/measurementStore.ts'
import type { MeasurementData } from '../stores/measurementStore.ts'
import { useOnboardingStore } from '../stores/onboardingStore.ts'
import { guideBackSession, guideSkipSession } from './guideSkip.ts'

// 온보딩 Store와 프로필 Store를 읽어 앱의 첫 진입 경로를 정하는 앱 계층의 연결 지점.
// 두 Store는 서로를 알지 못하고, 이 파일만 둘을 함께 본다. Store의 값은 읽기만 하고 바꾸지 않는다.

// 최신 상태를 읽는 함수 두 개를 받아 진입 경로 계산 함수를 만든다. 호출할 때마다 그 시점의 상태를 읽는다.
// 실제 Store 대신 가짜를 넣어 테스트할 수 있도록 분리했다.
export function createEntryPathResolver(
  readOnboarding: () => EntryOnboardingState,
  readProfile: () => ProfileFlowState,
): () => string {
  return () => getEntryPath(readOnboarding(), getProfileResumePath(readProfile()))
}

// 프로필 가입을 마친 뒤 이동할 경로를 만든다. 프로필은 완료된 것으로 보고 온보딩·기초 측정 상태만 본다.
// 그래서 어떤 상태에서도 프로필 경로(/profile...)를 돌려주지 않는다. (가드와 /profile 진입이 서로를 되돌려 보내는 순환을 막는다.)
// wasGuideLeft가 true이면 이번 앱 실행에서 기초 측정 Guide를 건너뛰었거나 뒤로 가기로 나온 것이므로, 기초 측정 미완료여도 Guide가 아니라 Home으로 보낸다.
// (그 뒤 브라우저 뒤로 가기로 프로필 단계에 들어와 가드가 되돌려 보낼 때 Guide로 다시 가지 않게 한다. 기초 측정 완료 상태 자체는 바꾸지 않는다.)
export function createPostProfilePathResolver(
  readOnboarding: () => EntryOnboardingState,
  wasGuideLeft: () => boolean = () => false,
): () => string {
  return () => {
    const state = readOnboarding()
    const baselineMeasurementCompleted = state.baselineMeasurementCompleted || wasGuideLeft()
    return getEntryPath({ ...state, baselineMeasurementCompleted }, null)
  }
}

// 지금 시점의 온보딩·프로필·기초 측정 상태로 첫 진입 경로를 정한다.
export const resolveEntryPath = createEntryPathResolver(
  () => useOnboardingStore.getState(),
  () => profileStore.getState(),
)

// 이번 앱 실행에서 기초 측정 Guide를 건너뛰었거나 뒤로 가기로 나왔는가. (두 기록 중 하나라도 있으면 true)
// 프로필 가입 뒤 경로와 메인 탭 접근 가드가 같은 기준을 쓰도록 한 곳에서 조합한다. 기초 측정 완료 상태와는 별개다.
const wasGuideLeftThisRun = (): boolean => guideSkipSession.wasSkipped() || guideBackSession.wasLeft()

// 프로필 가입을 마친 직후 이동할 경로. 기초 측정 전이면 측정 Guide, 끝났거나 이번 실행에서 Guide를 건너뛰었거나 뒤로 가기로 나왔으면 Home이다.
export const resolvePostProfilePath = createPostProfilePathResolver(
  () => useOnboardingStore.getState(),
  wasGuideLeftThisRun,
)

// 직접 URL 접근 가드가 쓰는 경로별 리다이렉트 계산. 열 수 있으면 null, 아니면 대신 갈 경로를 돌려준다.
// 정책은 lib/routeAccess.ts의 getRouteRedirect가 정하고, 여기서는 최신 상태를 읽어 넘기기만 한다. (Store 값은 바꾸지 않는다.)
// 측정은 종료된 세션이 있는지만 본다. 기초 측정 완료 판정은 completionSync가 하며, 종료된 세션을 완료로 취급하지 않는다.
// 세션이 없으면(또는 종료되지 않았으면) 종료된 세션이 없는 것으로 보아 결과 화면은 열지 않는다. (안전한 쪽)
export type MeasurementSessionReader = () => { readonly session: Pick<NonNullable<MeasurementData['session']>, 'status'> | null }

export function createRouteRedirectResolver(
  readOnboarding: () => EntryOnboardingState,
  readProfile: () => ProfileFlowState,
  wasGuideLeft: () => boolean,
  readMeasurement: MeasurementSessionReader,
): (pathname: string) => string | null {
  return (pathname) => {
    const onboarding = readOnboarding()
    return getRouteRedirect(pathname, {
      onboardingCompleted: onboarding.onboardingCompleted,
      baselineMeasurementCompleted: onboarding.baselineMeasurementCompleted,
      profileResumePath: getProfileResumePath(readProfile()),
      guideLeftThisRun: wasGuideLeft(),
      hasFinishedSession: readMeasurement().session?.status === 'finished',
    })
  }
}

// 개발 전용 Mock 모드(?scenario=)는 측정 엔진을 쓰지 않아 Store에 세션이 없다. 그 모드의 결과 화면을 막지 않도록,
// 앱이 처음 로드될 때의 주소가 Mock 모드이면 결과 화면에 한해 "종료된 세션이 있다"고 알려 준다. (온보딩·프로필 선행 단계와 메인 탭 정책은 그대로다.)
// 모드는 useMeasurementView와 같은 규칙(parseUrlMode)으로 처음 주소에서 한 번만 읽는다. 이동하면 주소의 쿼리가 사라지기 때문이다.
// 읽는 쪽 Store 값은 바꾸지 않는다. window가 없는 환경(테스트)에서는 켜지지 않는다.
export function createMockAwareMeasurementReader(isMockMode: boolean, read: MeasurementSessionReader): MeasurementSessionReader {
  return () => (isMockMode ? { session: { status: 'finished' } } : read())
}

// (window가 없는 테스트 환경에서는 아래에서 평가되지 않는다.)
const isMockModeAtLoad: boolean = typeof window !== 'undefined' && parseUrlMode(window.location.search, isDevBuild()).mock

// 지금 시점의 실제 Store와 이번 실행 기록으로 계산한다. 호출할 때마다 그 시점의 상태를 읽는다.
export const resolveRouteRedirect = createRouteRedirectResolver(
  () => useOnboardingStore.getState(),
  () => profileStore.getState(),
  wasGuideLeftThisRun,
  createMockAwareMeasurementReader(isMockModeAtLoad, () => measurementStore.getState()),
)
