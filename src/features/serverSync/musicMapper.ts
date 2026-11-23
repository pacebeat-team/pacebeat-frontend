import type { MusicPresetResponse } from '../../lib/api/types.ts'
import { MUSIC_TRACKS } from '../running/music.ts'
import type { MusicTrack } from '../running/music.ts'

// 서버 GET /api/v1/music/presets 응답 → 안전한 목록 (순수 함수).
// 계약(OpenAPI MusicPresetResponse): id·title·bpm 필수, subtitle·recommendedPaceSecPerKm는 null 가능.
// 서버는 활성 프리셋을 sort_order 순으로 돌려준다. 이 응답은 현재 어떤 화면에도 연결하지 않았고(러닝 화면은 로컬 MUSIC_TRACKS를 쓴다),
// 로컬 음악 선택을 덮어쓰지 않는다. 확인되지 않은 필드는 읽지 않는다.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// 필수 필드를 만족하는 항목만 남긴다. 배열이 아니거나 비어 있으면 빈 목록이다(예외를 던지지 않는다). 같은 id는 처음 것만 쓴다.
export function parseMusicPresets(raw: unknown): MusicPresetResponse[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: MusicPresetResponse[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const { id, title, bpm } = item
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue
    if (typeof title !== 'string' || title === '') continue
    if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm <= 0) continue
    seen.add(id)
    const subtitle = typeof item.subtitle === 'string' ? item.subtitle : null
    const pace = item.recommendedPaceSecPerKm
    out.push({ id, title, bpm, subtitle, recommendedPaceSecPerKm: typeof pace === 'number' && Number.isInteger(pace) && pace > 0 ? pace : null })
  }
  return out
}

export interface MusicPresetComparison {
  // 서버와 로컬 모두에 있는 id
  readonly matched: readonly string[]
  // 서버에만 있는 id(로컬에서 고를 수 없다)
  readonly serverOnly: readonly string[]
  // 로컬에만 있는 id(서버에 없다: 서버 목록이 누락된 것일 수 있다)
  readonly localOnly: readonly string[]
  // id는 같지만 제목 또는 BPM이 다른 것
  readonly differing: readonly string[]
}

export function compareMusicPresets(server: readonly MusicPresetResponse[], local: readonly MusicTrack[] = MUSIC_TRACKS): MusicPresetComparison {
  const localById = new Map(local.map((t) => [t.id, t]))
  const serverIds = new Set(server.map((p) => p.id))
  const matched = server.filter((p) => localById.has(p.id)).map((p) => p.id)
  const differing = server.filter((p) => {
    const l = localById.get(p.id)
    return l !== undefined && (l.title !== p.title || l.bpm !== p.bpm)
  }).map((p) => p.id)
  return {
    matched,
    serverOnly: server.filter((p) => !localById.has(p.id)).map((p) => p.id),
    localOnly: local.filter((t) => !serverIds.has(t.id)).map((t) => t.id),
    differing,
  }
}

// 화면에 보여 줄 음악 목록. 로컬 MUSIC_TRACKS가 기준이다(미리 듣기·선택·기록이 로컬 id를 쓴다). 서버 응답은 "순서"에만 반영한다:
// - 서버 목록에 있고 로컬에도 있는 곡을 서버 순서대로 앞에 두고, 서버에 없는 로컬 곡은 뒤에 그대로 둔다(곡을 숨기지 않는다).
// - 제목·BPM은 항상 로컬 값을 쓴다(서버와 달라도 섞지 않는다). 서버에만 있는 곡은 로컬에서 고를 수 없어 무시한다.
// - 응답이 비어 있거나 잘못되면 로컬 순서 그대로다.
export function selectMusicTracks(server: readonly MusicPresetResponse[], local: readonly MusicTrack[] = MUSIC_TRACKS): readonly MusicTrack[] {
  const byId = new Map(local.map((t) => [t.id, t]))
  const ordered: MusicTrack[] = []
  for (const preset of server) {
    const track = byId.get(preset.id)
    if (track !== undefined && !ordered.includes(track)) ordered.push(track)
  }
  return [...ordered, ...local.filter((t) => !ordered.includes(t))]
}
