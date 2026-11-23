import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRunLive } from './runLive.ts'
import { createRunStore } from './runStore.ts'
import { AUTO_PAUSE_HOLD_MS, INITIAL_AUTO_PAUSE, feedAutoPause, isStill } from './autoPause.ts'
import { DEFAULT_RUN_GUIDANCE } from './runGuidance.ts'
import type { GpsSourceHandlers } from '../measurement/geolocationSource.ts'
import type { RawFix } from '../measurement/types.ts'


// 위도 1e-5도 ≈ 1.11 m
const M = 1 / 111_195

function setup(guidance = DEFAULT_RUN_GUIDANCE, mode: 'gps' | 'time' = 'gps') {
  let now = 1_000_000
  let handlers: GpsSourceHandlers | null = null
  const store = createRunStore({ loadDraft: () => ({ distanceKm: 5, targetDurationSec: 1800, musicTrackId: null, recentGoals: [] }), saveDraft: () => undefined } as never)
  const live = createRunLive({
    store,
    now: () => now,
    autoHeartbeat: false,
    listenVisible: () => () => undefined,
    queryPermission: async () => 'granted',
    createSource: (h) => {
      handlers = h
      return { start: () => undefined, stop: () => undefined, isRunning: true } as never
    },
  })
  if (mode === 'gps') live.prepare({ onUnavailable: () => undefined })
  live.begin(mode, guidance)
  let lat = 37
  const fix = (dtMs: number, moveM: number, accuracyM = 5) => {
    now += dtMs
    lat += moveM * M
    const raw: RawFix = { lat, lng: 127, accuracyM, deviceTime: now, receivedAt: now } as never
    handlers?.onFix(raw)
  }
  return { store, live, fix, advance: (ms: number) => { now += ms }, get now() { return now }, session: () => store.getState().activeSession }
}

describe('autoPause 순수 판정', () => {
  it('정확히 0.5 km/h는 정지가 아니고 그보다 느리면 정지다', () => {
    assert.equal(isStill(1, 7200), false) // 1m/7.2s = 0.5km/h
    assert.equal(isStill(1, 7201), true)
    assert.equal(isStill(0, 1000), true)
    assert.equal(isStill(0, 0), false)
  })
  it('좌표 한 개·한 구간만으로는 멈추지 않는다', () => {
    let s = feedAutoPause(INITIAL_AUTO_PAUSE, 0, null, true)
    assert.equal(s.pause, false)
    s = feedAutoPause(s.state, 20_000, 0, true)
    assert.equal(s.pause, false)
  })
  it('10초 직전은 멈추지 않고 10초에 멈춘다', () => {
    let s = feedAutoPause(INITIAL_AUTO_PAUSE, 0, null, true)
    s = feedAutoPause(s.state, 4000, 0, true)
    s = feedAutoPause(s.state, AUTO_PAUSE_HOLD_MS - 1, 0, true)
    assert.equal(s.pause, false)
    s = feedAutoPause(s.state, AUTO_PAUSE_HOLD_MS, 0, true)
    assert.equal(s.pause, true)
  })
  it('속도가 회복되면 타이머가 초기화된다', () => {
    let s = feedAutoPause(INITIAL_AUTO_PAUSE, 0, null, true)
    s = feedAutoPause(s.state, 4000, 0, true)
    s = feedAutoPause(s.state, 8000, 10, true)
    assert.equal(s.state.stillSince, null)
    s = feedAutoPause(s.state, 12_000, 0, true)
    s = feedAutoPause(s.state, 16_000, 0, true)
    assert.equal(s.pause, false)
  })
  it('이어지지 않는 좌표(connected=false)는 타이머를 지운다', () => {
    let s = feedAutoPause(INITIAL_AUTO_PAUSE, 0, null, true)
    s = feedAutoPause(s.state, 4000, 0, true)
    s = feedAutoPause(s.state, 8000, 0, false)
    assert.equal(s.state.stillSince, null)
  })
})

describe('runLive 자동 일시정지', () => {
  it('10초 미만 정지는 멈추지 않는다', () => {
    const t = setup()
    t.fix(1000, 0)
    t.fix(3000, 0)
    t.fix(3000, 0)
    assert.equal(t.session()?.session.status, 'running')
  })
  it('10초 이상 정지가 이어지면 자동 일시정지하고 표시를 남긴다', () => {
    const t = setup()
    t.fix(1000, 0)
    for (let i = 0; i < 4; i++) t.fix(3000, 0)
    assert.equal(t.session()?.session.status, 'paused')
    assert.equal(t.session()?.autoPaused, true)
    assert.equal(t.session()?.session.pauses.length, 1)
  })
  it('움직여도 자동 재개되지 않고, 재개 버튼만 재개한다', () => {
    const t = setup()
    t.fix(1000, 0)
    for (let i = 0; i < 4; i++) t.fix(3000, 0)
    for (let i = 0; i < 5; i++) t.fix(2000, 5)
    assert.equal(t.session()?.session.status, 'paused')
    t.live.resume()
    assert.equal(t.session()?.session.status, 'running')
    assert.equal(t.session()?.autoPaused, undefined)
    t.fix(1000, 3)
    t.fix(1000, 3)
    assert.equal(t.session()?.session.status, 'running')
  })
  it('중간에 움직이면 타이머가 초기화된다', () => {
    const t = setup()
    t.fix(1000, 0)
    t.fix(4000, 0)
    t.fix(4000, 20)
    t.fix(4000, 0)
    t.fix(4000, 0)
    assert.equal(t.session()?.session.status, 'running')
  })
  it('정확도 저하로 거절된 좌표는 타이머를 지운다', () => {
    const t = setup()
    t.fix(1000, 0)
    t.fix(4000, 0)
    t.fix(4000, 0, 100)
    t.fix(4000, 0)
    t.fix(4000, 0)
    assert.equal(t.session()?.session.status, 'running')
  })
  it('GPS 끊김(10초 넘는 공백) 뒤에는 타이머가 새로 시작한다', () => {
    const t = setup()
    t.fix(1000, 0)
    t.fix(4000, 0)
    t.advance(30_000)
    t.live.heartbeat()
    t.fix(1000, 0)
    t.fix(4000, 0)
    assert.equal(t.session()?.session.status, 'running')
    assert.ok((t.session()?.gpsGaps.length ?? 0) >= 1)
  })
  it('설정이 꺼져 있으면(세션 스냅샷) 멈추지 않는다', () => {
    const t = setup({ ...DEFAULT_RUN_GUIDANCE, autoPause: false })
    t.fix(1000, 0)
    for (let i = 0; i < 6; i++) t.fix(3000, 0)
    assert.equal(t.session()?.session.status, 'running')
  })
  it('스냅샷이 없는 이전 세션은 기본값(켜짐)으로 판정한다', () => {
    const t = setup(undefined)
    t.fix(1000, 0)
    for (let i = 0; i < 4; i++) t.fix(3000, 0)
    assert.equal(t.session()?.session.status, 'paused')
  })
  it('TIME 모드는 자동 일시정지하지 않는다', () => {
    const t = setup(DEFAULT_RUN_GUIDANCE, 'time')
    t.advance(60_000)
    t.live.tick()
    assert.equal(t.session()?.session.status, 'running')
  })
  it('수동 일시정지는 자동 표시 없이 동작하고 수동 재개된다', () => {
    const t = setup()
    t.fix(1000, 0)
    t.live.pause()
    assert.equal(t.session()?.session.status, 'paused')
    assert.equal(t.session()?.autoPaused, undefined)
    t.live.resume()
    assert.equal(t.session()?.session.status, 'running')
  })
  it('정지 중 수동 일시정지해도 자동 일시정지와 겹치지 않는다', () => {
    const t = setup()
    t.fix(1000, 0)
    t.fix(4000, 0)
    t.live.pause()
    t.fix(8000, 0)
    t.fix(8000, 0)
    assert.equal(t.session()?.session.pauses.length, 1)
    assert.equal(t.session()?.autoPaused, undefined)
  })
  it('자동 일시정지 중에는 거리 샘플이 늘지 않는다', () => {
    const t = setup()
    t.fix(1000, 0)
    for (let i = 0; i < 4; i++) t.fix(3000, 0)
    const n = t.session()?.distanceSamples.length
    t.fix(2000, 30)
    t.fix(2000, 30)
    assert.equal(t.session()?.distanceSamples.length, n)
  })
  it('종료하면 자동 표시가 지워진다', () => {
    const t = setup()
    t.fix(1000, 0)
    for (let i = 0; i < 4; i++) t.fix(3000, 0)
    t.live.stop('user')
    assert.equal(t.session()?.autoPaused, undefined)
    assert.equal(t.session()?.session.status, 'finished')
  })
})
