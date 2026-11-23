import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import runPlay from '../../assets/icons/run-play.svg'
import runPlayActive from '../../assets/icons/run-play-active.svg'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { TextButton } from '../../components/common/TextButton'
import { getMusicPreviewPath, RUN_PATHS } from '../../features/running/runFlow'
import { runSetupStore } from '../../features/running/runSetupStore'
import { runStore, useRunStore } from '../../features/running/runStore'
import { useMusicTracks } from '../../features/serverSync/useMusicTracks'

// Figma `RUN / Music`. 곡 목록은 로컬 MUSIC_TRACKS이며, 로그인했고 서버 연동이 켜져 있으면 서버 프리셋의 순서만 반영한다(useMusicTracks). 곡을 누르면 미리 듣기 화면으로 이동한다(실제 재생은 없다).
// "기준 케이던스 …" 줄은 기준 데이터가 없어 만들지 않는다.
export function MusicPage() {
  const navigate = useNavigate()
  const tracks = useMusicTracks()
  const musicTrackId = useRunStore((state) => state.draft.musicTrackId)
  const selectedId = musicTrackId ?? tracks[0].id

  const proceed = useCallback(
    (nextTrackId: string | null) => {
      runStore.getState().setMusicTrack(nextTrackId)
      runSetupStore.getState().confirmMusic()
      navigate(RUN_PATHS.ready)
    },
    [navigate],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3 [&>*]:shrink-0">
        <ScreenHeader title="음악 고르기" onBack={() => navigate(RUN_PATHS.goal)} />
        <h2 className="mt-4 h-[89px] text-[34px] font-light leading-[44px] tracking-[-1.02px] text-ink">
          가볍게,
          <br />
          나의 리듬으로.
        </h2>

        {/* Figma `music / recommendation source`: 기준 케이던스 행. 기준 측정값이 아직 없어 값은 비워 둔다(자리와 간격은 Figma와 같다). */}
        <div className="mt-4 flex h-7 items-center gap-2">
          <span className="text-[15px] leading-[21px] text-muted">기준 케이던스</span>
          <span className="font-pace text-[18px] font-medium leading-[25px] text-muted">– spm</span>
        </div>

        <ul aria-label="음악" className="mt-[22px] flex flex-col">
          {tracks.map((track) => {
            const selected = track.id === selectedId
            return (
              <li key={track.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => navigate(getMusicPreviewPath(track.id))}
                  className="flex h-[72px] w-full cursor-pointer items-center gap-[14px] text-left"
                >
                  <span
                    className={`flex size-[48px] shrink-0 items-center justify-center rounded-full ${
                      selected ? 'bg-lime' : 'bg-soft'
                    }`}
                  >
                    <img src={selected ? runPlayActive : runPlay} alt="" className="size-[22px]" aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                    <span className={`text-[17px] leading-6 text-ink ${selected ? 'font-medium' : ''}`}>{track.title}</span>
                    {selected && <span className="text-[13px] leading-[18px] text-muted">15초 미리 듣기</span>}
                  </span>
                  <span className="flex w-[55px] shrink-0 flex-col items-end">
                    <span className="text-[16px] leading-[22px] text-ink">{track.bpm}</span>
                    <span className="text-[13px] leading-[18px] text-muted">BPM</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        <p className="mt-[14px] text-[13px] leading-5 text-muted">박자 자동 조절은 준비 중이에요.</p>

        <PrimaryButton label="다음 · 준비 확인" onClick={() => proceed(selectedId)} className="mt-[18px] shrink-0" />
        <TextButton label="음악 없이 달리기" onClick={() => proceed(null)} />
      </div>
    </div>
  )
}

export default MusicPage
