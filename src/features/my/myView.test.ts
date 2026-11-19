import assert from 'node:assert/strict'
import test from 'node:test'
import type { MeasurementSession, MetricsState } from '../measurement/types.ts'
import { buildBaselineView, buildProfileLine } from './myView.ts'

const START = new Date(2026, 8, 30, 7).getTime() // 2026-09-30
const session = (over: Partial<MeasurementSession> = {}): MeasurementSession => ({
  id: 's1',
  status: 'finished',
  startedAt: START,
  endedAt: START + 600_000,
  endReason: 'auto',
  pauses: [],
  ...over,
})
const metrics = (over: Partial<MetricsState> = {}): MetricsState => ({ lastFix: null, distanceM: 1364, validMs: 600_000, recent: [], ...over })

test('프로필 문구: 저장된 값만 이어 붙이고, 없으면 null', () => {
  assert.equal(buildProfileLine('beginner', '2'), '러닝 입문 · 주 2회 목표')
  assert.equal(buildProfileLine('regular', '3+'), '꾸준한 러닝 · 주 3회 이상 목표')
  assert.equal(buildProfileLine('beginner', null), '러닝 입문')
  assert.equal(buildProfileLine(null, '1'), '주 1회 목표')
  assert.equal(buildProfileLine(null, null), null)
})

test('내 기준: 완료한 실제 기초 측정에서 기준 페이스와 측정일을 만든다', () => {
  const view = buildBaselineView({ session: session(), runSource: { kind: 'real' }, metrics: metrics() })
  assert.deepEqual(view, { paceText: '7:20', measuredText: '9월 30일 측정' })
})

test('내 기준: 측정이 없거나 끝나지 않았거나 가상이거나 짧으면 값이 없다', () => {
  assert.equal(buildBaselineView({ session: null, runSource: null, metrics: metrics() }), null)
  assert.equal(buildBaselineView({ session: session({ status: 'running', endedAt: null }), runSource: { kind: 'real' }, metrics: metrics() }), null)
  assert.equal(buildBaselineView({ session: session(), runSource: { kind: 'virtual' }, metrics: metrics() }), null)
  assert.equal(buildBaselineView({ session: session(), runSource: { kind: 'real' }, metrics: metrics({ validMs: 60_000 }) }), null)
  assert.equal(buildBaselineView({ session: session(), runSource: { kind: 'real' }, metrics: metrics({ distanceM: 0 }) }), null)
})
