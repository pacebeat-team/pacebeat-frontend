import { createGpsTracker, getGpsStatus, processFix } from '../measurement/gpsTracker.ts'
import { addFix, createMetrics, getMetrics } from '../measurement/metrics.ts'
import { getElapsedMs } from '../measurement/session.ts'
import type {
  GpsProcessResult,
  GpsSignal,
  GpsTrackerState,
  MetricsState,
  MeasurementSession,
  RawFix,
} from '../measurement/types.ts'
import type { RunMode } from './types.ts'

// 러닝 지표 (순수 함수): GPS 모드는 좌표 검증·거리·페이스, TIME 모드는 경과 시간만.
// - 기초 측정의 순수 엔진(gpsTracker, metrics)만 쓴다. 위치 구독(geolocationSource) 연결은 #46의 책임이다.
// - 값을 구할 수 없으면 0이 아니라 null이다(현재 페이스가 없으면 null).

export interface GpsRunState {
  readonly tracker: GpsTrackerState
  readonly metrics: MetricsState
}

export function createGpsRunState(): GpsRunState {
  return { tracker: createGpsTracker(), metrics: createMetrics() }
}

export interface FedFix {
  readonly state: GpsRunState
  readonly result: GpsProcessResult
}

// 좌표 하나를 검증하고(버려질 수 있음) 통과한 좌표만 거리·페이스에 반영한다.
export function feedGpsFix(state: GpsRunState, fix: RawFix, session: MeasurementSession): FedFix {
  const processed = processFix(state.tracker, fix)
  if (!processed.result.accepted) {
    return { state: { tracker: processed.state, metrics: state.metrics }, result: processed.result }
  }
  return {
    state: { tracker: processed.state, metrics: addFix(state.metrics, processed.result.fix, session) },
    result: processed.result,
  }
}

export interface RunLiveMetrics {
  readonly mode: RunMode
  // 일시정지를 뺀 러닝 시간(ms)
  readonly elapsedMs: number
  // TIME 모드는 null
  readonly distanceM: number | null
  readonly avgPaceSecPerKm: number | null
  readonly currentPaceSecPerKm: number | null
  // GPS 신호 상태. TIME 모드는 null(사용 안 함)
  readonly gpsSignal: GpsSignal | null
}

export function getGpsRunMetrics(state: GpsRunState, session: MeasurementSession, now: number): RunLiveMetrics {
  const metrics = getMetrics(state.metrics, session, now)
  return {
    mode: 'gps',
    elapsedMs: metrics.elapsedMs,
    distanceM: metrics.distanceM,
    avgPaceSecPerKm: metrics.avgPaceSecPerKm,
    currentPaceSecPerKm: metrics.currentPaceSecPerKm,
    gpsSignal: getGpsStatus(state.tracker, now),
  }
}

// TIME 모드: GPS를 쓰지 않고 경과 시간만 계산한다. 거리·페이스는 기록하지 않는다(null).
export function getTimeRunMetrics(session: MeasurementSession, now: number): RunLiveMetrics {
  return {
    mode: 'time',
    elapsedMs: getElapsedMs(session, now),
    distanceM: null,
    avgPaceSecPerKm: null,
    currentPaceSecPerKm: null,
    gpsSignal: null,
  }
}
