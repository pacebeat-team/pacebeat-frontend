import type { CalibrationStatusType, InsoleDeviceResponse, InsolePairSummaryResponse, SignalQualityType } from '../../lib/api/types.ts'
import { finiteOrNull } from './time.ts'

// 스마트 인솔 상태(서버 등록 정보) → 화면용 모델(순수 함수). BLE 연결·펌웨어 연동은 하지 않는다.
// 서버에 등록된 기기가 없으면 그 쪽은 null이고, 배터리 등 값이 없으면 null이다(가짜 값·0을 만들지 않는다).
export interface InsoleView {
  readonly connected: boolean
  readonly batteryPct: number | null
  readonly firmwareVersion: string | null
  readonly calibrationStatus: CalibrationStatusType
  readonly signalQuality: SignalQualityType
  readonly lastSeenAt: string | null
}

export interface InsolePairView {
  readonly left: InsoleView | null
  readonly right: InsoleView | null
  readonly connectionMode: string
  // 등록된 기기가 하나도 없는가
  readonly noneRegistered: boolean
}

function toView(device: InsoleDeviceResponse | null): InsoleView | null {
  if (device === null) return null
  return {
    connected: device.is_connected,
    batteryPct: finiteOrNull(device.battery_pct),
    firmwareVersion: device.firmware_version,
    calibrationStatus: device.calibration_status,
    signalQuality: device.signal_quality,
    lastSeenAt: device.last_seen_at,
  }
}

export function fromInsolePair(response: InsolePairSummaryResponse): InsolePairView {
  const left = toView(response.left)
  const right = toView(response.right)
  return { left, right, connectionMode: response.connection_mode, noneRegistered: left === null && right === null }
}
