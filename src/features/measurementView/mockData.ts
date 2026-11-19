// ⚠️ Mock(예시) 데이터 전용 파일입니다. 실제 측정값이 아닙니다.
// - 개발 환경에서만 사용되며(useMeasurementView 참고), 화면은 이 파일을 직접 import하지 않습니다.
// - 숫자는 Figma 시안의 예시 값입니다.
// - 시나리오 선택: 주소에 ?scenario=normal | gps-weak | gps-lost | empty (기본 normal)
// - 결과 값의 관계: 기준 페이스 = 소요 시간 ÷ 거리(반올림), 첫 목표 시간 = 목표 거리 × 기준 페이스
//   (normal은 Figma 시안 값 그대로라 기준 페이스가 1초 차이난다.)

import type { MeasurementView } from './types'

export type MockScenario = 'normal' | 'gps-weak' | 'gps-lost' | 'empty'

const SCENARIOS: Record<MockScenario, MeasurementView> = {
  // Figma 시안 값: 06:12 / 0.84km / 7′24″ / 156spm, 결과 7′20″ / 1.34km / 9:48 / 158spm / 0.83m
  normal: {
    isSample: true,
    guide: { targetDurationSec: 600 },
    active: {
      elapsedSec: 372,
      targetDurationSec: 600,
      minSaveSec: 120,
      distanceM: 840,
      currentPaceSecPerKm: 444,
      gpsStatus: 'good',
      cadenceSpm: 156,
    },
    result: {
      elapsedSec: 588,
      distanceM: 1340,
      baselinePaceSecPerKm: 440,
      cadenceSpm: 158,
      strideM: 0.83,
      quality: 'good',
      gpsStatus: 'good',
      firstGoal: { distanceKm: 3, durationSec: 1320 },
    },
  },
  // GPS 신호가 약한 경우
  'gps-weak': {
    isSample: true,
    guide: { targetDurationSec: 600 },
    active: {
      elapsedSec: 372,
      targetDurationSec: 600,
      minSaveSec: 120,
      distanceM: 790,
      currentPaceSecPerKm: 452,
      gpsStatus: 'weak',
      cadenceSpm: 156,
    },
    result: {
      elapsedSec: 588,
      distanceM: 1280,
      baselinePaceSecPerKm: 459,
      cadenceSpm: 158,
      strideM: 0.83,
      quality: 'fair',
      gpsStatus: 'weak',
      firstGoal: { distanceKm: 3, durationSec: 1377 },
    },
  },
  // GPS가 끊긴 경우: 현재 페이스는 null, 이미 측정된 유효 거리는 보존
  'gps-lost': {
    isSample: true,
    guide: { targetDurationSec: 600 },
    active: {
      elapsedSec: 372,
      targetDurationSec: 600,
      minSaveSec: 120,
      distanceM: 840,
      currentPaceSecPerKm: null,
      gpsStatus: 'lost',
      cadenceSpm: 156,
    },
    result: {
      elapsedSec: 588,
      distanceM: 1010,
      baselinePaceSecPerKm: 582,
      cadenceSpm: 158,
      strideM: 0.83,
      quality: 'poor',
      gpsStatus: 'lost',
      firstGoal: { distanceKm: 1, durationSec: 582 },
    },
  },
  // 측정값이 하나도 없는 경우: 모든 측정값이 null (Guide의 측정 시간만 있음)
  empty: {
    isSample: true,
    guide: { targetDurationSec: 600 },
    active: {
      elapsedSec: null,
      targetDurationSec: 600,
      minSaveSec: 120,
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
  },
}

function readScenarioFromUrl(): MockScenario {
  const value = new URLSearchParams(window.location.search).get('scenario')
  return value !== null && value in SCENARIOS ? (value as MockScenario) : 'normal'
}

// 시나리오는 처음 읽은 값을 유지한다. (화면 이동으로 주소의 쿼리가 사라져도 같은 시나리오로 확인)
let currentScenario: MockScenario | null = null

export function getMockMeasurementView(): MeasurementView {
  if (currentScenario === null) currentScenario = readScenarioFromUrl()
  return SCENARIOS[currentScenario]
}
