import { useMemo } from 'react'
import { getMockMeasurementView } from './mockData'
import type { MeasurementActions, MeasurementView } from './types'

// 측정값이 없는 상태. 운영 환경에서 측정 엔진 연결 전에 사용한다. (0이 아니라 모두 null)
const EMPTY_VIEW: MeasurementView = {
  isSample: false,
  guide: { targetDurationSec: null },
  active: {
    elapsedSec: null,
    targetDurationSec: null,
    minSaveSec: null,
    distanceM: null,
    currentPaceSecPerKm: null,
    gpsStatus: null,
    cadenceSpm: null,
  },
  result: {
    elapsedSec: null,
    distanceM: null,
    baselinePaceSecPerKm: null,
    cadenceSpm: null,
    strideM: null,
    quality: null,
    gpsStatus: null,
    firstGoal: null,
  },
}

// 측정 화면이 데이터를 읽는 유일한 통로.
// 지금은 개발 환경에서 Mock, 그 외에는 빈 값을 돌려준다.
// TODO(#31): 측정 엔진이 완성되면 이 훅 안에서 엔진 스토어 값을 MeasurementView로 변환해 돌려주고,
//            start/stop을 엔진의 시작/종료 호출로 연결한다. 화면 코드는 바꾸지 않는다.
export function useMeasurementView(): { view: MeasurementView; actions: MeasurementActions } {
  const view = import.meta.env.DEV ? getMockMeasurementView() : EMPTY_VIEW

  const actions = useMemo<MeasurementActions>(
    () => ({
      start: () => {
        // TODO(#31): 측정 세션 시작
      },
      stop: () => {
        // TODO(#31): 측정 세션 종료
      },
    }),
    [],
  )

  return { view, actions }
}
