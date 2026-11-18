import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { getMusicPreviewPath, isRunNavVisible, isRunPath, normalizeRunPath, resolveRunRedirect, RUN_PATHS } from './runFlow.ts'
import { createRunSetupStore } from './runSetupStore.ts'
import { createRunStore } from './runStore.ts'
import { createRunStorage } from './runStorage.ts'
import { MUSIC_TRACKS, findMusicTrack, formatTrackBpm } from './music.ts'
import { readFileSync } from 'node:fs'
import { buildTimeRows } from './timePicker.ts'
import { formatDuration, formatDurationKorean, formatGoalChip, formatPace } from './format.ts'

describe('경로 접근 규칙', () => {
  test('목표 화면은 언제나 접근할 수 있다', () => {
    assert.equal(resolveRunRedirect(RUN_PATHS.goal, 0), null)
  })
  test('선행 단계 없이 직접 접근하면 목표 화면으로 보낸다', () => {
    assert.equal(resolveRunRedirect(RUN_PATHS.time, 0), RUN_PATHS.goal)
    assert.equal(resolveRunRedirect(RUN_PATHS.music, 1), RUN_PATHS.goal)
    assert.equal(resolveRunRedirect(RUN_PATHS.ready, 2), RUN_PATHS.goal)
    assert.equal(resolveRunRedirect(RUN_PATHS.countdown, 3), RUN_PATHS.goal)
  })
  test('선행 단계를 거치면 접근할 수 있다', () => {
    assert.equal(resolveRunRedirect(RUN_PATHS.time, 1), null)
    assert.equal(resolveRunRedirect(RUN_PATHS.music, 2), null)
    assert.equal(resolveRunRedirect(RUN_PATHS.ready, 3), null)
    assert.equal(resolveRunRedirect(RUN_PATHS.countdown, 4), null)
  })
  test('끝의 슬래시는 무시하고, 알 수 없는 하위 경로는 목표 화면으로 보낸다', () => {
    assert.equal(resolveRunRedirect('/running/music/', 0), RUN_PATHS.goal)
    assert.equal(resolveRunRedirect('/running/unknown', 4), RUN_PATHS.goal)
    assert.equal(normalizeRunPath('/running/'), '/running')
    assert.equal(normalizeRunPath('/'), '/')
  })
  test('음악 미리 듣기 경로는 음악 화면과 같은 단계가 필요하다', () => {
    const preview = getMusicPreviewPath('city-loop')
    assert.equal(preview, '/running/music/city-loop')
    assert.equal(resolveRunRedirect(preview, 1), RUN_PATHS.goal)
    assert.equal(resolveRunRedirect(preview, 2), null)
    assert.equal(resolveRunRedirect('/running/music/a/b', 4), RUN_PATHS.goal)
  })
  test('isRunPath', () => {
    assert.equal(isRunPath('/running'), true)
    assert.equal(isRunPath('/running/ready'), true)
    assert.equal(isRunPath('/runningx'), false)
    assert.equal(isRunPath('/home'), false)
  })
})

describe('하단 네비 규칙', () => {
  test('목표·음악 화면에서만 보인다', () => {
    assert.equal(isRunNavVisible(RUN_PATHS.goal), true)
    assert.equal(isRunNavVisible(RUN_PATHS.music), true)
    assert.equal(isRunNavVisible('/running/music/'), true)
  })
  test('시간 선택·준비 확인·카운트다운에서는 숨긴다', () => {
    assert.equal(isRunNavVisible(getMusicPreviewPath('city-loop')), false)
    assert.equal(isRunNavVisible(RUN_PATHS.time), false)
    assert.equal(isRunNavVisible(RUN_PATHS.ready), false)
    assert.equal(isRunNavVisible(RUN_PATHS.countdown), false)
  })
})

describe('진행 단계 Store', () => {
  test('목표 → 음악 → 시작 신호 순서로만 단계가 오른다', () => {
    const store = createRunSetupStore()
    store.getState().signalStart('gps') // 음악 확정 전에는 무시
    assert.equal(store.getState().mode, null)
    store.getState().confirmMusic() // 목표 확정 전에는 무시
    assert.equal(store.getState().level, 0)
    store.getState().enterGoal()
    store.getState().confirmGoal()
    assert.equal(store.getState().level, 2)
    store.getState().confirmMusic()
    assert.equal(store.getState().level, 3)
    store.getState().signalStart('time')
    assert.equal(store.getState().level, 4)
    assert.equal(store.getState().mode, 'time')
  })
  test('목표 화면에 다시 들어오면 처음 상태로 돌아가 이후 단계를 다시 확정해야 한다', () => {
    const store = createRunSetupStore()
    store.getState().enterGoal()
    store.getState().confirmGoal()
    store.getState().confirmMusic()
    store.getState().signalStart('gps')
    store.getState().enterGoal()
    assert.equal(store.getState().level, 1)
    assert.equal(store.getState().mode, null)
    assert.equal(resolveRunRedirect(RUN_PATHS.ready, store.getState().level), RUN_PATHS.goal)
  })
})

describe('음악 목록', () => {
  test('고정 4곡(Morning Stride 158, City Loop 156, Easy Tempo 160, Night Pace 150)', () => {
    assert.deepEqual(
      MUSIC_TRACKS.map((track) => [track.title, track.bpm]),
      [
        ['Morning Stride', 158],
        ['City Loop', 156],
        ['Easy Tempo', 160],
        ['Night Pace', 150],
      ],
    )
    assert.equal(new Set(MUSIC_TRACKS.map((track) => track.id)).size, 4)
  })
  test('고르지 않은 값(null)이나 없는 id는 곡이 아니다', () => {
    assert.equal(findMusicTrack(null), null)
    assert.equal(findMusicTrack('nope'), null)
    assert.equal(formatTrackBpm(findMusicTrack('morning-stride')!), 'Morning Stride · 158 BPM')
  })
})

describe('시간 선택', () => {
  test('3km 목록은 12~30분 1분 단위이고 각 줄에 페이스가 있다', () => {
    const rows = buildTimeRows(3)
    assert.equal(rows.length, 19)
    assert.equal(rows[9].durationSec, 1260)
    assert.equal(rows[9].paceSecPerKm, 420)
  })
  test('기준 페이스가 없으면 추천이 없다', () => {
    assert.ok(buildTimeRows(3).every((row) => !row.recommended))
    assert.ok(buildTimeRows(3, null).every((row) => !row.recommended))
  })
  test('기준 페이스가 있으면 추천이 한 줄 생긴다(후속 연결 대비)', () => {
    assert.equal(buildTimeRows(3, 440).filter((row) => row.recommended).length, 1)
  })
  test('행 선택은 즉시 Store의 목표 시간에 반영된다', () => {
    const store = createRunStore(createRunStorage(null))
    store.getState().setTargetDuration(buildTimeRows(3)[7].durationSec) // 행 선택 = 반영
    assert.equal(store.getState().draft.targetDurationSec, 1140)
    assert.equal(store.getState().draft.distanceKm, 3)
  })
  test('화면 동작: 행 선택만 목표를 바꾸고, 뒤로 가기·돌아가기는 목표를 바꾸지 않으며 확정 버튼·임시 선택이 없다', () => {
    const source = readFileSync(new URL('../../pages/running/TimePickerPage.tsx', import.meta.url), 'utf8')
    const back = source.slice(source.indexOf('const handleBack'), source.indexOf('return (\n    <div'))
    assert.ok(!back.includes('setTargetDuration'), '뒤로 가기는 목표를 바꾸지 않는다')
    assert.match(back, /navigate\(RUN_PATHS\.goal/)
    assert.match(source, /onClick=\{\(\) => handleSelect\(row\.durationSec\)\}/)
    assert.match(source, /onBack=\{handleBack\}/)
    assert.match(source, /label="돌아가기" onClick=\{handleBack\}/)
    assert.ok(!source.includes('이 시간으로 설정'))
    assert.ok(!source.includes('useState'), '임시 선택 상태가 없다')
  })
})

describe('최근 목표', () => {
  test('칩 적용: 거리와 정확한 시간이 그대로 복원된다', () => {
    const store = createRunStore(createRunStorage(null))
    store.getState().setDistance(1)
    store.getState().setTargetDuration(450)
    store.getState().startRun('gps', 1_700_000_000_000, () => 'a')
    store.getState().clearSession()
    store.getState().setDistance(5)
    store.getState().setTargetDuration(2400)
    const [goal] = store.getState().draft.recentGoals
    store.getState().setDistance(goal.distanceKm)
    store.getState().setTargetDuration(goal.targetDurationSec)
    assert.equal(store.getState().draft.distanceKm, 1)
    assert.equal(store.getState().draft.targetDurationSec, 450)
  })
  test('표시 형식', () => {
    assert.equal(formatGoalChip(3, 1320), '3 km · 22:00')
    assert.equal(formatGoalChip(1, 450), '1 km · 7:30')
  })
})

describe('표시 형식', () => {
  test('시간·페이스·한글 표기', () => {
    assert.equal(formatDuration(1260), '21:00')
    assert.equal(formatPace(420), '7:00')
    assert.equal(formatDurationKorean(1260), '21분')
    assert.equal(formatDurationKorean(450), '7분 30초')
  })
})

describe('Figma 대조 화면 구조(소스 확인)', () => {
  const read = (name: string) => readFileSync(new URL(`../../pages/running/${name}`, import.meta.url), 'utf8')

  test('음악 미리 듣기: Figma 안내 문구 원문이고 하단 버튼은 이 곡으로 준비하기(주)·다른 곡 고르기(보조) 순서이다', () => {
    const source = read('MusicPreviewPage.tsx')
    assert.match(source, /인터랙션 시안에서는 음악이 재생되지 않아요\./)
    assert.match(source, /다른 곡을 고르면 이전 미리 듣기는 멈춰요\./)
    assert.ok(source.indexOf('label="이 곡으로 준비하기"') < source.indexOf('label="다른 곡 고르기"'))
    assert.ok(!/new Audio|<audio/.test(source), '실제 오디오를 재생하지 않는다')
  })
  test('공통 하단 영역: 좌우 12px, 위 8px, 보조 버튼이 있으면 아래 20px·없으면 36px(Safe Area만큼 뺀다)', () => {
    const source = read('RunFooter.tsx')
    assert.match(source, /px-3 pt-2/)
    assert.match(source, /calc\(20px-env\(safe-area-inset-bottom/)
    assert.match(source, /calc\(36px-env\(safe-area-inset-bottom/)
  })
})
