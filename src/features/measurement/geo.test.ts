import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { haversineMeters, isValidCoordinate } from './geo.ts'

function assertClose(actual: number, expected: number, tolerance: number) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual}은(는) ${expected}에서 ±${tolerance} 안에 있어야 함`,
  )
}

// 지구 반지름 6,371,000m 기준 위도 1°의 길이(m)
const METERS_PER_DEGREE = (Math.PI * 6_371_000) / 180

describe('haversineMeters', () => {
  test('같은 점이면 0이다', () => {
    assert.equal(haversineMeters(37.5665, 126.978, 37.5665, 126.978), 0)
  })

  test('적도에서 경도 1°는 약 111,195m이다', () => {
    assertClose(haversineMeters(0, 0, 0, 1), 111_194.93, 0.5)
  })

  test('위도 1°는 어디서나 약 111,195m이다', () => {
    assertClose(haversineMeters(37.5, 127, 38.5, 127), 111_194.93, 0.5)
  })

  test('위도가 높을수록 경도 1°의 길이가 줄어든다 (위도 60°에서 약 절반)', () => {
    assertClose(haversineMeters(60, 10, 60, 11), 55_597, 3)
  })

  test('북쪽으로 10m 이동한 좌표와의 거리는 10m이다', () => {
    assertClose(haversineMeters(37.5665, 126.978, 37.5665 + 10 / METERS_PER_DEGREE, 126.978), 10, 0.001)
  })

  test('순서를 바꿔도 같은 거리이다', () => {
    const forward = haversineMeters(37.5665, 126.978, 35.1796, 129.0756)
    const backward = haversineMeters(35.1796, 129.0756, 37.5665, 126.978)
    assertClose(forward, backward, 1e-6)
  })

  test('지구 반대편(약 20,015km)에서도 NaN이 되지 않는다', () => {
    const distance = haversineMeters(0, 0, 0, 180)
    assert.ok(Number.isFinite(distance))
    assertClose(distance, 20_015_086.8, 1)
  })

  test('날짜변경선을 가로질러도 짧은 거리가 나온다 (경도 179.9999 ↔ −179.9999)', () => {
    assertClose(haversineMeters(0, 179.9999, 0, -179.9999), 22.24, 0.1)
  })

  test('극에서는 경도가 달라도 같은 점이다', () => {
    assertClose(haversineMeters(90, 0, 90, 180), 0, 1e-6)
  })
})

describe('isValidCoordinate', () => {
  test('경계값은 유효하다', () => {
    assert.equal(isValidCoordinate(90, 180), true)
    assert.equal(isValidCoordinate(-90, -180), true)
    assert.equal(isValidCoordinate(0, 0), true)
  })

  test('범위를 벗어나면 유효하지 않다', () => {
    assert.equal(isValidCoordinate(90.0001, 0), false)
    assert.equal(isValidCoordinate(-90.0001, 0), false)
    assert.equal(isValidCoordinate(0, 180.0001), false)
    assert.equal(isValidCoordinate(0, -180.0001), false)
  })

  test('NaN, 무한대는 유효하지 않다', () => {
    assert.equal(isValidCoordinate(Number.NaN, 0), false)
    assert.equal(isValidCoordinate(0, Number.NaN), false)
    assert.equal(isValidCoordinate(Number.POSITIVE_INFINITY, 0), false)
    assert.equal(isValidCoordinate(0, Number.NEGATIVE_INFINITY), false)
  })
})
