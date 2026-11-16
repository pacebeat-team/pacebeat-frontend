import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionStatus } from '../measurement/types'
import { measurementStore, parseUrlMode, useMeasurementStore } from '../../stores/measurementStore'
import type { UrlMode } from '../../stores/measurementStore'
import { getMockMeasurementView } from './mockData'
import { toMeasurementView } from './toMeasurementView'
import type { MeasurementActions, MeasurementView } from './types'

// 앱이 처음 로드될 때(이 모듈이 처음 평가될 때) 주소를 한 번 읽는다. (모드의 규칙은 parseUrlMode 참고)
// 어느 화면으로 들어왔든, 앱 안에서 이동하며 주소의 쿼리가 사라져도 처음 주소의 모드가 유지된다.
// ?scenario= Mock의 시나리오 이름은 mockData.ts가 처음 쓸 때 읽는다. (기존 동작 그대로)
const urlMode: UrlMode =
  typeof window === 'undefined'
    ? { virtual: null, mock: false }
    : parseUrlMode(window.location.search, import.meta.env.DEV)

export interface MeasurementViewResult {
  view: MeasurementView
  actions: MeasurementActions
  // true이면 가상 GPS 데이터로 측정한다. 화면은 가상 데이터임을 분명히 표시해야 한다.
  isVirtual: boolean
  // 측정 세션 상태. 세션이 없으면 null. (Mock 모드에서는 "그만하기"를 누르기 전까지 'running')
  sessionStatus: SessionStatus | null
}

// 측정 화면이 데이터를 읽는 유일한 통로.
// 측정 Store(실제 GPS 또는 가상 GPS → 검증 → 지표 계산)의 값을 MeasurementView로 바꿔 돌려준다.
export function useMeasurementView(): MeasurementViewResult {
  const mode = urlMode
  const session = useMeasurementStore((state) => state.session)
  const tracker = useMeasurementStore((state) => state.tracker)
  const metrics = useMeasurementStore((state) => state.metrics)
  const now = useMeasurementStore((state) => state.now)
  // Mock 모드는 엔진을 쓰지 않으므로 "그만하기"를 눌렀는지만 이 훅 안에서 기억한다.
  const [mockStopped, setMockStopped] = useState(false)

  const view = useMemo(
    () => (mode.mock ? getMockMeasurementView() : toMeasurementView({ session, tracker, metrics, now })),
    [mode.mock, session, tracker, metrics, now],
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

  const actions = useMemo<MeasurementActions>(() => ({ start, stop }), [start, stop])

  const sessionStatus: SessionStatus | null = mode.mock
    ? mockStopped
      ? 'finished'
      : 'running'
    : (session?.status ?? null)

  return { view, actions, isVirtual: mode.virtual !== null, sessionStatus }
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
