import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { TextButton } from '../../components/common/TextButton'
import { MUSIC_TRACKS } from '../../features/running/music'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runSetupStore } from '../../features/running/runSetupStore'
import { runStore } from '../../features/running/runStore'

export function MusicPage() {
  const navigate = useNavigate()
  const [selectedId, setSelectedId] = useState<string>(
    () => runStore.getState().draft.musicTrackId ?? MUSIC_TRACKS[0].id,
  )
  // 미리 듣기는 실제 오디오 없이 "준비 중"만 보여 준다.
  const [previewNotice, setPreviewNotice] = useState(false)

  const proceed = useCallback(
    (musicTrackId: string | null) => {
      runStore.getState().setMusicTrack(musicTrackId)
      runSetupStore.getState().confirmMusic()
      navigate(RUN_PATHS.ready)
    },
    [navigate],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-4 pt-3">
        <ScreenHeader title="음악 고르기" onBack={() => navigate(RUN_PATHS.goal)} />
        <h2 className="mt-4 text-[28px] font-light leading-[36px] text-ink">가볍게, 나의 리듬으로.</h2>

        <ul role="radiogroup" aria-label="음악" className="mt-4 flex flex-col gap-2">
          {MUSIC_TRACKS.map((track) => {
            const selected = track.id === selectedId
            return (
              <li key={track.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSelectedId(track.id)}
                  className={`flex h-[60px] w-full cursor-pointer items-center justify-between rounded-[18px] px-4 text-left ${
                    selected ? 'bg-ink text-app-bg' : 'bg-soft text-ink'
                  }`}
                >
                  <span className="text-[16px] font-medium">{track.title}</span>
                  <span className="text-[14px] opacity-80">{track.bpm} BPM</span>
                </button>
              </li>
            )
          })}
        </ul>

        <button
          type="button"
          onClick={() => setPreviewNotice(true)}
          className="mt-4 h-[44px] cursor-pointer self-start rounded-full border border-line px-5 text-[14px] text-ink"
        >
          15초 미리 듣기
        </button>
        {previewNotice && (
          <p role="status" className="mt-2 text-[14px] leading-5 text-muted">
            미리 듣기는 준비 중이에요.
          </p>
        )}
        <p className="mt-4 text-[14px] leading-5 text-muted">박자 자동 조절은 준비 중이에요.</p>
      </div>

      <div className="flex flex-col gap-1 px-3 pb-3">
        <PrimaryButton label="다음 · 준비 확인" onClick={() => proceed(selectedId)} />
        <TextButton label="음악 없이 달리기" onClick={() => proceed(null)} />
      </div>
    </div>
  )
}

export default MusicPage
