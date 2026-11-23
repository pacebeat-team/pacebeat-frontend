import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { getOwnerBoundApi } from '../../lib/api/index.ts'
import { useAuthState } from '../../lib/auth/index.ts'
import { MUSIC_TRACKS } from '../running/music.ts'
import type { MusicTrack } from '../running/music.ts'
import { apiQueries } from './queries.ts'
import { selectMusicTracks } from './musicMapper.ts'

// 러닝 음악 목록. 로그인했고 서버 연동이 켜져 있을 때만 서버 프리셋(GET /music/presets)을 읽어 순서에 반영한다(selectMusicTracks).
// 게스트·연동 꺼짐·조회 실패·로딩 중에는 로컬 MUSIC_TRACKS 그대로다(요청도 없다). 서버 값으로 로컬 선택을 바꾸지 않는다.
export function useMusicTracks(): readonly MusicTrack[] {
  const status = useAuthState((state) => state.status)
  const userId = useAuthState((state) => state.userId)
  const api = useMemo(() => (status === 'signedIn' && userId !== null ? getOwnerBoundApi(userId) : null), [status, userId])
  const query = useQuery({ ...apiQueries.musicPresets(api as NonNullable<typeof api>), enabled: api !== null })
  return useMemo(() => (api === null || query.data === undefined ? MUSIC_TRACKS : selectMusicTracks(query.data)), [api, query.data])
}
