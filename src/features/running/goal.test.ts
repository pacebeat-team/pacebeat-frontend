import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareToBaseline,
  getDefaultDurationSec,
  getDurationOptionsSec,
  getDurationRangeSec,
  getDurationStepSec,
  getTargetPaceSecPerKm,
  recommendGoal,
  rescaleDurationSec,
  snapDurationSec,
  stepDurationSec,
  clampDurationSec,
  isValidDurationSec,
} from './goal.ts'

describe('추천 목표 recommendGoal', () => {
  test('기준 7:20/km, 3km → 22:00(1320초), 목표 페이스 7:20', () => {
    assert.deepEqual(recommendGoal(440, 3), { durationSec: 1320, paceSecPerKm: 440 })
  })

  test('기준 페이스가 null이면 추천하지 않는다', () => {
    assert.equal(recommendGoal(null, 3), null)
  })

  test('올바르지 않은 기준 페이스(0, 음수, NaN)는 추천하지 않는다', () => {
    assert.equal(recommendGoal(0, 3), null)
    assert.equal(recommendGoal(-10, 3), null)
    assert.equal(recommendGoal(Number.NaN, 3), null)
  })

  test('선택 단위로 반올림한다: 3km는 1분, 1km는 30초', () => {
    // 7:25 × 3 = 1335초 → 1320(22:00) / 7:31 × 3 = 1353초 → 1380(23:00)
    assert.equal(recommendGoal(445, 3)?.durationSec, 1320)
    assert.equal(recommendGoal(451, 3)?.durationSec, 1380)
    // 7:20 × 1 = 440초 → 450(7:30), 7:14 × 1 = 434초 → 420(7:00)
    assert.equal(recommendGoal(440, 1)?.durationSec, 450)
    assert.equal(recommendGoal(434, 1)?.durationSec, 420)
  })

  test('범위를 벗어나는 기준 페이스는 허용 범위로 제한한다', () => {
    assert.equal(recommendGoal(100, 3)?.durationSec, 720) // 4:00/km
    assert.equal(recommendGoal(1000, 3)?.durationSec, 1800) // 10:00/km
  })
})

describe('기준 비교 compareToBaseline', () => {
  test('기준보다 빠르면 faster와 초/km 차이(기준 7:20, 목표 7:00 → 20초)', () => {
    assert.deepEqual(compareToBaseline(440, 420), { kind: 'faster', secPerKm: 20 })
  })
  test('같으면 same, 느리면 slower', () => {
    assert.deepEqual(compareToBaseline(440, 440), { kind: 'same' })
    assert.deepEqual(compareToBaseline(440, 460), { kind: 'slower' })
  })
  test('기준이 없으면 null', () => {
    assert.equal(compareToBaseline(null, 420), null)
    assert.equal(compareToBaseline(Number.NaN, 420), null)
  })
})

describe('시간 선택 범위·단위', () => {
  test('단위: 1km는 30초, 3km·5km는 1분', () => {
    assert.equal(getDurationStepSec(1), 30)
    assert.equal(getDurationStepSec(3), 60)
    assert.equal(getDurationStepSec(5), 60)
  })

  test('범위: 목표 페이스 4:00~10:00/km (1km 4~10분, 3km 12~30분, 5km 20~50분)', () => {
    assert.deepEqual(getDurationRangeSec(1), { min: 240, max: 600 })
    assert.deepEqual(getDurationRangeSec(3), { min: 720, max: 1800 })
    assert.deepEqual(getDurationRangeSec(5), { min: 1200, max: 3000 })
  })

  test('선택지는 범위 전체를 단위 간격으로 담는다', () => {
    const options = getDurationOptionsSec(3)
    assert.equal(options[0], 720)
    assert.equal(options[options.length - 1], 1800)
    assert.equal(options.length, 19)
    assert.ok(options.every((sec) => sec % 60 === 0))
    assert.equal(getDurationOptionsSec(1).length, 13)
  })

  test('snapDurationSec: 단위에 맞추고 범위 안으로 제한한다', () => {
    assert.equal(snapDurationSec(3, 1349), 1320)
    assert.equal(snapDurationSec(3, 100), 720)
    assert.equal(snapDurationSec(3, 99999), 1800)
    assert.equal(snapDurationSec(1, 451), 450)
  })

  test('올바르지 않은 값은 기본 목표 시간이 된다', () => {
    assert.equal(snapDurationSec(3, Number.NaN), getDefaultDurationSec(3))
    assert.equal(clampDurationSec(3, Number.NaN), getDefaultDurationSec(3))
  })

  test('clampDurationSec: 단위에 맞추지 않고 범위 안의 정수 초로만 제한한다', () => {
    assert.equal(clampDurationSec(3, 1349.4), 1349)
    assert.equal(clampDurationSec(3, 100), 720)
    assert.equal(clampDurationSec(3, 99999), 1800)
  })

  test('isValidDurationSec: 범위 안의 정수 초만 유효하다', () => {
    assert.equal(isValidDurationSec(3, 1350), true)
    assert.equal(isValidDurationSec(3, 719), false)
    assert.equal(isValidDurationSec(3, 1800), true)
    assert.equal(isValidDurationSec(3, 1800.5), false)
    assert.equal(isValidDurationSec(3, '1350'), false)
  })
})

describe('스테퍼 stepDurationSec', () => {
  test('단위에 맞는 값에서는 한 단위씩 이동한다(3km 1분, 1km 30초)', () => {
    assert.equal(stepDurationSec(3, 1320, 1), 1380)
    assert.equal(stepDurationSec(3, 1320, -1), 1260)
    assert.equal(stepDurationSec(1, 450, 1), 480)
    assert.equal(stepDurationSec(1, 450, -1), 420)
  })
  test('단위에 맞지 않는 기본값(22:30)에서도 다음 단위 값으로 이동한다', () => {
    assert.equal(stepDurationSec(3, 1350, 1), 1380)
    assert.equal(stepDurationSec(3, 1350, -1), 1320)
  })
  test('범위의 끝에서 멈춘다', () => {
    assert.equal(stepDurationSec(3, 1800, 1), 1800)
    assert.equal(stepDurationSec(3, 720, -1), 720)
  })
})

describe('기본값과 목표 페이스', () => {
  test('기준이 없을 때 기본값 7:30/km: 1km 7:30, 3km 22:30, 5km 37:30', () => {
    assert.equal(getDefaultDurationSec(1), 450)
    assert.equal(getDefaultDurationSec(3), 1350) // 단위(1분)에 맞추지 않은 정확한 기본값
    assert.equal(getDefaultDurationSec(5), 2250)
  })

  test('목표 페이스 = 목표 시간 ÷ 거리', () => {
    assert.equal(getTargetPaceSecPerKm(3, 1260), 420) // 21:00 → 7:00/km
    assert.equal(getTargetPaceSecPerKm(1, 450), 450)
  })
})

describe('거리 변경 시 페이스 유지', () => {
  test('3km 22:00(7:20/km) → 1km 7:20(440초), 5km 36:40(2200초)', () => {
    assert.equal(rescaleDurationSec(3, 1320, 1), 440)
    assert.equal(rescaleDurationSec(3, 1320, 5), 2200)
  })
  test('기본값(3km 22:30)은 1km 7:30, 5km 37:30과 같은 페이스다', () => {
    assert.equal(rescaleDurationSec(3, 1350, 1), 450)
    assert.equal(rescaleDurationSec(3, 1350, 5), 2250)
  })

  test('같은 거리로 되돌리면 같은 값이다', () => {
    assert.equal(rescaleDurationSec(3, 1320, 3), 1320)
  })

  test('범위를 넘으면 제한한다', () => {
    // 1km 4:00 → 5km 20:00(범위 최소)
    assert.equal(rescaleDurationSec(1, 240, 5), 1200)
  })
})
