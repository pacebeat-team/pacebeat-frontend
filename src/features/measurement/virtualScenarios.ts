import type { VirtualScenario } from './virtualRun.ts'

// 발표 시연용 가상 러닝 시나리오.
// ⚠️ 모두 예시(가상) 데이터이며 실제 측정값이 아니다. 숫자는 시연을 위한 제안값이다.
// - 좌표 간격 1초, 정확도 5m, 흔들림 없음(기본값)이라 결과 숫자가 깔끔하게 떨어진다.
// - 최소 저장 시간(2분)을 넘기도록 모두 2분 이상이다.

export type VirtualScenarioId = 'steady' | 'stop-and-go' | 'gps-lost' | 'gps-glitch'

export const VIRTUAL_SCENARIOS: Readonly<Record<VirtualScenarioId, VirtualScenario>> = Object.freeze({
  // 일정한 속도로 3분: 3.0m/s(페이스 5′33″/km), 540m
  steady: {
    motion: [{ kind: 'move', durationSec: 180, speedMps: 3 }],
  },

  // 달리기 → 정지 → 천천히 → 빠르게: 총 3분, 470m
  'stop-and-go': {
    motion: [
      { kind: 'move', durationSec: 60, speedMps: 3 },
      { kind: 'stop', durationSec: 20 },
      { kind: 'move', durationSec: 60, speedMps: 2.5 },
      { kind: 'move', durationSec: 40, speedMps: 3.5 },
    ],
  },

  // 달리는 중 GPS 신호가 20초 끊겼다가 복구: 150초
  'gps-lost': {
    motion: [{ kind: 'move', durationSec: 150, speedMps: 3 }],
    conditions: [{ kind: 'gps-lost', fromSec: 70, toSec: 90 }],
  },

  // 달리는 중 좌표가 튐: 2초짜리(걸러짐)와 5초짜리(새 기준점으로 받아들여짐), 120초
  'gps-glitch': {
    motion: [{ kind: 'move', durationSec: 120, speedMps: 3 }],
    conditions: [
      { kind: 'glitch', fromSec: 40, toSec: 42, offsetM: 800 },
      { kind: 'glitch', fromSec: 80, toSec: 85, offsetM: 800 },
    ],
  },
})
