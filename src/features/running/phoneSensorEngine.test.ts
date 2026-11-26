import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  createStepDetectorState,
  estimateBpmFromPace,
  evaluateStageCoaching,
  feedAccelSample,
  getLiveSensorReading,
} from './phoneSensorEngine.ts'
import { createRunLive, selectLiveSensorAndStage } from './runLive.ts'
import { createRunStorage } from './runStorage.ts'
import type { RunKeyValueStorage } from './runStorage.ts'
import { createRunStore } from './runStore.ts'

describe('핸드폰 가속도 센서 기반 걸음(Step) 및 실시간 BPM·속도 측정', () => {
  test('160 BPM(375ms 주기) 보행 가속도 파형을 주입하면 실시간 BPM과 추정 속도(km/h)가 계산된다', () => {
    let state = createStepDetectorState()
    const stepIntervalMs = 375 // 60,000 / 375 = 160 BPM
    let t = 1_000_000

    // 각 걸음마다: 상승(14.5 m/s^2) → 하강(9.2 m/s^2) 피크 생성
    for (let step = 0; step < 8; step += 1) {
      state = feedAccelSample(state, { x: 0, y: 11.2, z: 0, atMs: t }).state
      state = feedAccelSample(state, { x: 0, y: 14.8, z: 0, atMs: t + 80 }).state
      state = feedAccelSample(state, { x: 0, y: 9.1, z: 0, atMs: t + 160 }).state
      t += stepIntervalMs
    }

    assert.ok(state.stepCount >= 6, `감지된 걸음 수: ${state.stepCount}`)
    const reading = getLiveSensorReading(state, t - 100, null)
    assert.equal(reading.source, 'motion')
    assert.ok(reading.cadenceBpm !== null && Math.abs(reading.cadenceBpm - 160) <= 6, `BPM: ${reading.cadenceBpm}`)
    assert.ok(reading.speedKmh !== null && reading.speedKmh > 6 && reading.speedKmh < 12)
    assert.ok(reading.paceSecPerKm !== null && reading.paceSecPerKm >= 300 && reading.paceSecPerKm <= 500)
  })

  test('GPS 페이스가 있으면 GPS 속도를 우선하고 모션 센서의 실시간 BPM과 결합한다', () => {
    let state = createStepDetectorState()
    let t = 2_000_000
    for (let step = 0; step < 6; step += 1) {
      state = feedAccelSample(state, { x: 0, y: 11.0, z: 0, atMs: t }).state
      state = feedAccelSample(state, { x: 0, y: 15.0, z: 0, atMs: t + 70 }).state
      state = feedAccelSample(state, { x: 0, y: 9.0, z: 0, atMs: t + 140 }).state
      t += 400 // 150 BPM
    }
    const reading = getLiveSensorReading(state, t - 100, 360) // GPS 6:00/km = 10.0 km/h
    assert.equal(reading.source, 'gps')
    assert.equal(reading.paceSecPerKm, 360)
    assert.equal(reading.speedKmh, 10)
    assert.ok(reading.cadenceBpm !== null && Math.abs(reading.cadenceBpm - 150) <= 5)
  })

  test('모션 센서가 없는 환경에서도 GPS 페이스로부터 권장 러닝 BPM을 역산한다', () => {
    assert.equal(estimateBpmFromPace(420), 154) // 7:00/km → 154 BPM
    assert.equal(estimateBpmFromPace(360), 163) // 6:00/km → 163 BPM
  })

  test('3구간 목표 페이스 대비 현재 페이스 코칭 판정 (on_pace / speed_up / slow_down)', () => {
    assert.equal(evaluateStageCoaching(420, 425, 158).status, 'on_pace')
    assert.equal(evaluateStageCoaching(455, 420, 158).status, 'speed_up')
    assert.equal(evaluateStageCoaching(390, 420, 158).status, 'slow_down')
  })
})

describe('runLive 센서 통합 및 3구간(몸풀기·리듬·85% 실시간·95% 고정) 연동', () => {
  test('러닝 중 위치와 모션 샘플이 들어오면 구간 전환(1구간 → 2구간 → 3구간 85% → 95% 고정)과 BPM이 실시간 갱신된다', () => {
    const map = new Map<string, string>()
    const kv: RunKeyValueStorage = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    }
    const store = createRunStore(createRunStorage(kv))
    store.getState().setDistance(3)
    store.getState().setTargetDuration(1260) // 3km 21:00 (7:00/km = 420초)

    let now = 1_700_000_000_000
    let onFix: ((fix: { lat: number; lng: number; accuracyM: number; deviceTime: number; receivedAt: number }) => void) | null = null
    const controller = createRunLive({
      store,
      now: () => now,
      createSource: (h) => {
        onFix = h.onFix
        return { start: () => undefined, stop: () => undefined, isRunning: true }
      },
      createMotion: () => ({ start: () => undefined, stop: () => undefined, isRunning: true }),
      autoHeartbeat: false,
    })

    controller.begin('gps')

    // 가속도 센서 샘플 주입 (158 BPM 리듬)
    for (let i = 0; i < 6; i += 1) {
      controller.feedMotionSample({ x: 0, y: 11, z: 0, atMs: now })
      controller.feedMotionSample({ x: 0, y: 15, z: 0, atMs: now + 60 })
      controller.feedMotionSample({ x: 0, y: 9, z: 0, atMs: now + 120 })
      now += 380
    }

    // 1) 초기 몸풀기 구간 (0.2km < 15%)
    const M_PER_DEG = 111_195
    let currentM = 0
    onFix?.({ lat: 37, lng: 127, accuracyM: 5, deviceTime: now, receivedAt: now })
    while (currentM < 200) {
      currentM += 20
      now += 8400 // 8.4초마다 20m 이동 (7:00/km = 2.38m/s, connectGapMs 10초 이내)
      onFix?.({ lat: 37 + currentM / M_PER_DEG, lng: 127, accuracyM: 5, deviceTime: now, receivedAt: now })
    }

    const warmupState = selectLiveSensorAndStage(store.getState().activeSession, controller.live.getState())
    assert.equal(warmupState?.stageGuidance?.section, 'warmup')
    assert.equal(warmupState?.stageGuidance?.displayPaceSecPerKm, 440) // 420 * 1.05 = 441 → 5초 반올림 440 (7:20/km)

    // 2) 85% 구간 진입 (2.56km) — 작은 스텝으로 이동해 GPS 속도 한도 내에서 누적
    while (currentM < 2580) {
      currentM += 20
      now += 8400
      onFix?.({ lat: 37 + currentM / M_PER_DEG, lng: 127, accuracyM: 5, deviceTime: now, receivedAt: now })
    }
    const realtime85 = selectLiveSensorAndStage(store.getState().activeSession, controller.live.getState())
    assert.equal(realtime85?.stageGuidance?.section, 'realtime')
    assert.equal(realtime85?.stageGuidance?.isFrozenAfter95Pct, false)
    const cachedAt85 = controller.live.getState().lastRealtimeRawPaceSecPerKm
    assert.ok(cachedAt85 !== null && cachedAt85 > 0)

    // 3) 95% 이후 (2.88km) — 안내값 고정 확인
    while (currentM < 2880) {
      currentM += 20
      now += 8400
      onFix?.({ lat: 37 + currentM / M_PER_DEG, lng: 127, accuracyM: 5, deviceTime: now, receivedAt: now })
    }
    const frozen95 = selectLiveSensorAndStage(store.getState().activeSession, controller.live.getState())
    assert.equal(frozen95?.stageGuidance?.section, 'realtime')
    assert.equal(frozen95?.stageGuidance?.isFrozenAfter95Pct, true)
  })
})
