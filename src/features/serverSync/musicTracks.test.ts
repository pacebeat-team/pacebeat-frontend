import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { MUSIC_TRACKS } from '../running/music.ts'
import { parseMusicPresets, selectMusicTracks } from './musicMapper.ts'

describe('음악 목록 선택(서버 프리셋은 순서에만 반영)', () => {
  const ids = (tracks: readonly { id: string }[]) => tracks.map((t) => t.id)
  const server = (...order: string[]) => parseMusicPresets(order.map((id, i) => ({ id, title: `T${i}`, bpm: 100 + i })))
  test('서버가 같은 순서면 로컬 목록과 같다', () => {
    assert.deepEqual(selectMusicTracks(server(...ids(MUSIC_TRACKS))), MUSIC_TRACKS)
  })
  test('서버 순서를 따르되 제목·BPM은 로컬 값을 쓴다(섞지 않는다)', () => {
    const out = selectMusicTracks(server('night-pace', 'city-loop'))
    assert.deepEqual(ids(out), ['night-pace', 'city-loop', 'morning-stride', 'easy-tempo'])
    assert.equal(out[0], MUSIC_TRACKS.find((t) => t.id === 'night-pace')) // 로컬 객체 그대로
    assert.equal(out[0].title, 'Night Pace')
  })
  test('서버에 없는 로컬 곡은 숨기지 않고 뒤에 둔다. 서버에만 있는 곡은 무시한다', () => {
    const out = selectMusicTracks(server('ghost', 'easy-tempo'))
    assert.deepEqual(ids(out), ['easy-tempo', 'morning-stride', 'city-loop', 'night-pace'])
    assert.equal(out.length, MUSIC_TRACKS.length)
  })
  test('빈·잘못된 응답이면 로컬 순서 그대로이고 곡이 줄지 않는다', () => {
    for (const raw of [[], null, 'x', {}, [{ id: 1 }]]) assert.deepEqual(ids(selectMusicTracks(parseMusicPresets(raw))), ids(MUSIC_TRACKS))
  })
  test('같은 id가 반복돼도 곡은 한 번만 나온다', () => {
    assert.deepEqual(ids(selectMusicTracks(server('city-loop', 'city-loop'))), ['city-loop', 'morning-stride', 'easy-tempo', 'night-pace'])
  })
})
