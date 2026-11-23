import { useCallback, useEffect, useMemo, useState } from 'react'
import { isDevBuild } from '../../lib/devEnv'
import type { SessionStatus } from '../measurement/types'
import { measurementStore, parseUrlMode, REAL_TARGET_DURATION_MS, useMeasurementStore } from '../../stores/measurementStore'
import type { UrlMode } from '../../stores/measurementStore'
import { getMockMeasurementView } from './mockData'
import { toMeasurementView, toRestoreView } from './toMeasurementView'
import type { MeasurementActions, MeasurementView, RestoreView } from './types'

// 앱이 처음 로드될 때(이 모듈이 처음 평가될 때) 주소를 한 번 읽는다. (모드의 규칙은 parseUrlMode 참고)
// 어느 화면으로 들어왔든, 앱 안에서 이동하며 주소의 쿼리가 사라져도 처음 주소의 모드가 유지된다.
// ?scenario= Mock의 시나리오 이름은 mockData.ts가 처음 쓸 때 읽는다. (기존 동작 그대로)
const urlMode: UrlMode =
  typeof window === 'undefined'
    ? { virtual: null, mock: false }
    : parseUrlMode(window.location.search, isDevBuild())

if (typeof window !== 'undefined') {
  // 앱이 처음 로드될 때, 저장된 실제 측정을 복원한다. 가상(?virtual)과 Mock(?scenario) 모드에서는 저장분을 읽지도 지우지도 않는다.
  if (urlMode.virtual === null && !urlMode.mock) {
    measurementStore.getState().hydrate()
  }

  // 페이지를 떠날 때(새로고침, 탭 닫기)의 처리. (best effort)
  // - pagehide: 떠나는 중임을 알려 예약된 화면 이탈 종료가 실행되지 않게 하고, 측정 중이면 한 번 더 저장한다.
  //   뒤로가기 캐시에서 돌아올 때(pageshow)는 다시 풀어 평소처럼 동작하게 한다.
  // - visibilitychange(hidden): 저장만 한다. 세션은 끝내지 않는다. (모바일에서는 pagehide가 오지 않을 수 있다.)
  window.addEventListener('pagehide', () => {
    const { setUnloading, saveNow } = measurementStore.getState()
    setUnloading(true)
    saveNow()
  })
  window.addEventListener('pageshow', () => measurementStore.getState().setUnloading(false))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      measurementStore.getState().saveNow()
    }
  })
}

export interface MeasurementViewResult {
  view: MeasurementView
  actions: MeasurementActions
  // true이면 가상 GPS 데이터로 측정한다. 화면은 가상 데이터임을 분명히 표시해야 한다.
  isVirtual: boolean
  // 측정 세션 상태. 세션이 없으면 null. (Mock 모드에서는 "그만하기"를 누르기 전까지 'running')
  sessionStatus: SessionStatus | null
  // 새로고침으로 복원되어 재개를 기다리는 세션일 때만 값이 있다. (일반 측정, 가상 측정, Mock에서는 null)
  restore: RestoreView | null
}

// 측정 화면이 데이터를 읽는 유일한 통로.
// 측정 Store(실제 GPS 또는 가상 GPS → 검증 → 지표 계산)의 값을 MeasurementView로 바꿔 돌려준다.
export function useMeasurementView(): MeasurementViewResult {
  const mode = urlMode
  const session = useMeasurementStore((state) => state.session)
  const tracker = useMeasurementStore((state) => state.tracker)
  const metrics = useMeasurementStore((state) => state.metrics)
  const now = useMeasurementStore((state) => state.now)
  const needsGpsReverify = useMeasurementStore((state) => state.needsGpsReverify)
  const runTargetDurationMs = useMeasurementStore((state) => state.targetDurationMs)
  // 측정 전(Guide)에는 이번 모드로 시작했을 때의 목표를, 측정 중과 후에는 Store가 정한 목표를 보여 준다.
  const targetDurationMs =
    session === null ? (mode.virtual === null ? REAL_TARGET_DURATION_MS : null) : runTargetDurationMs
  // Mock 모드는 엔진을 쓰지 않으므로 "그만하기"를 눌렀는지만 이 훅 안에서 기억한다.
  const [mockStopped, setMockStopped] = useState(false)

  const view = useMemo(
    () => (mode.mock ? getMockMeasurementView() : toMeasurementView({ session, tracker, metrics, now, targetDurationMs })),
    [mode.mock, session, tracker, metrics, now, targetDurationMs],
  )

  const start = useCallback(() => {
    if (mode.mock) return
    measurementStore.getState().start(mode.virtual === null ? undefined : { virtual: mode.virtual })
  }, [mode])

  const stop = useCallback(() => {
    if (mode.mock) {
      setMockStopped(true)
      return
    }
    measurementStore.getState().stop()
  }, [mode.mock])

  const resume = useCallback(() => {
    if (mode.mock) return
    measurementStore.getState().resume()
  }, [mode.mock])

  const actions = useMemo<MeasurementActions>(() => ({ start, stop, resume }), [start, stop, resume])

  const restore = useMemo(
    () => (mode.mock || mode.virtual !== null ? null : toRestoreView({ session, tracker, now, needsGpsReverify })),
    [mode, session, tracker, now, needsGpsReverify],
  )

  const sessionStatus: SessionStatus | null = mode.mock
    ? mockStopped
      ? 'finished'
      : 'running'
    : (session?.status ?? null)

  return { view, actions, isVirtual: mode.virtual !== null, sessionStatus, restore }
}

// 측정 화면을 떠날 때(뒤로가기 등) 아직 진행 중인 측정을 정리한다.
// 언마운트 때 바로 종료하지 않고 Store에 "지연 종료"를 예약한다. 개발 환경(StrictMode)에서는 마운트 → 언마운트 →
// 마운트가 같은 틱에 일어나므로 곧바로 다시 마운트되면서 예약이 취소되어, 진행 중인 측정이 끊기지 않는다.
export function useStopOnLeave(): void {
  useEffect(() => {
    const { cancelLeaveStop, scheduleLeaveStop } = measurementStore.getState()
    cancelLeaveStop()
    return () => scheduleLeaveStop()
  }, [])
}

// Active 화면이 열릴 때, 새로고침으로 복원된 세션의 GPS 재확인을 시작한다. (복원된 세션이 아니면 아무 일도 없다)
// StrictMode처럼 마운트가 두 번 일어나도 한 번만 시작한다.
export function useAttachRestoredSession(): void {
  useEffect(() => {
    if (urlMode.mock || urlMode.virtual !== null) return
    measurementStore.getState().attach()
  }, [])
}
