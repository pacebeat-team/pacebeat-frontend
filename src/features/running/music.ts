// 러닝 음악 목록. 지금은 고정 4곡이며 실제 오디오는 재생하지 않는다(미리 듣기는 "준비 중").
// 음악을 고르지 않는 값은 draft의 musicTrackId = null이다.

export interface MusicTrack {
  readonly id: string
  readonly title: string
  readonly bpm: number
}

export const MUSIC_TRACKS: readonly MusicTrack[] = Object.freeze([
  { id: 'morning-stride', title: 'Morning Stride', bpm: 158 },
  { id: 'city-loop', title: 'City Loop', bpm: 156 },
  { id: 'easy-tempo', title: 'Easy Tempo', bpm: 160 },
  { id: 'night-pace', title: 'Night Pace', bpm: 150 },
])

export function findMusicTrack(id: string | null): MusicTrack | null {
  return MUSIC_TRACKS.find((track) => track.id === id) ?? null
}

export function formatTrackBpm(track: MusicTrack): string {
  return `${track.title} · ${track.bpm} BPM`
}
