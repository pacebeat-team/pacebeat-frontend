import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PLACEHOLDER,
  formatClock,
  formatDistanceKm,
  formatDuration,
  formatInteger,
  formatMeters,
  formatPace,
  formatWholeMinutes,
  getProgressRatio,
} from './format.ts'

test('페이스는 sec/km 정수를 분′초″로 표시한다', () => {
  assert.equal(formatPace(440), '7′20″')
  assert.equal(formatPace(582), '9′42″')
})

test('값이 없거나 올바르지 않으면 0이 아니라 PLACEHOLDER를 돌려준다', () => {
  assert.equal(formatPace(null), PLACEHOLDER)
  assert.equal(formatPace(0), PLACEHOLDER)
  assert.equal(formatPace(-5), PLACEHOLDER)
  assert.equal(formatPace(Number.NaN), PLACEHOLDER)
  assert.equal(formatClock(null), PLACEHOLDER)
  assert.equal(formatDuration(null), PLACEHOLDER)
  assert.equal(formatDistanceKm(null), PLACEHOLDER)
  assert.equal(formatMeters(null), PLACEHOLDER)
  assert.equal(formatInteger(null), PLACEHOLDER)
})

test('시간 형식: 시계 형식(06:12)과 줄여 쓰는 형식(9:48)', () => {
  assert.equal(formatClock(372), '06:12')
  assert.equal(formatClock(600), '10:00')
  assert.equal(formatDuration(588), '9:48')
  assert.equal(formatDuration(1320), '22:00')
})

test('거리와 숫자 형식: 0은 실제 측정값이라 그대로 표시한다', () => {
  assert.equal(formatDistanceKm(840), '0.84')
  assert.equal(formatDistanceKm(0), '0.00')
  assert.equal(formatMeters(0.83), '0.83')
  assert.equal(formatInteger(156.4), '156')
})

test('정확히 분 단위일 때만 "N분"을 돌려준다', () => {
  assert.equal(formatWholeMinutes(600), '10분')
  assert.equal(formatWholeMinutes(90), null)
  assert.equal(formatWholeMinutes(0), null)
  assert.equal(formatWholeMinutes(null), null)
})

test('진행률은 0~1이고 계산할 수 없으면 0이다', () => {
  assert.equal(getProgressRatio(372, 600), 0.62)
  assert.equal(getProgressRatio(700, 600), 1)
  assert.equal(getProgressRatio(null, 600), 0)
  assert.equal(getProgressRatio(10, 0), 0)
})
