import { useCallback } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import runMusicCard from '../../assets/icons/run-music-card.svg'
import { PrimaryButton } from '../../components/common/PrimaryButton'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { TextButton } from '../../components/common/TextButton'
import { findMusicTrack } from '../../features/running/music'
import { RUN_PATHS } from '../../features/running/runFlow'
import { runSetupStore } from '../../features/running/runSetupStore'
import { runStore } from '../../features/running/runStore'
import { RunFooter } from './RunFooter'

// Figma `RUN / Music preview`. 실제 오디오는 재생하지 않는다(안내 문구는 Figma 원문).
export function MusicPreviewPage() {
  const navigate = useNavigate()
  const { trackId } = useParams()
  const track = findMusicTrack(trackId ?? null)

  const handleBack = useCallback(() => navigate(RUN_PATHS.music, { replace: true }), [navigate])
  const handleConfirm = useCallback(() => {
    if (track === null) return
    runStore.getState().setMusicTrack(track.id)
    runSetupStore.getState().confirmMusic()
    navigate(RUN_PATHS.ready)
  }, [navigate, track])

  if (track === null) return <Navigate to={RUN_PATHS.music} replace />

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace">
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3 [&>*]:shrink-0">
        <ScreenHeader title="음악 미리 듣기" onBack={handleBack} />
        <h2 className="mt-4 text-[30px] font-light leading-[44px] tracking-[-0.9px] text-ink">{track.title}</h2>

        <section
          aria-label="고정 박자"
          className="relative mt-[34px] flex h-[236px] w-full shrink-0 flex-col justify-center gap-3 overflow-hidden rounded-[36px] bg-lime p-7 shadow-[inset_0_-3px_5px_rgba(71,102,13,0.16),inset_0_1.5px_2px_rgba(255,255,232,0.5)]"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(263px_181px_at_100%_0,rgba(255,255,224,0.38)_0%,rgba(255,255,229,0.12)_55%,rgba(255,255,229,0)_100%)]"
          />
          <img src={runMusicCard} alt="" className="relative size-[44px]" aria-hidden="true" />
          <p className="relative flex h-[69px] items-baseline gap-[6px] text-ink">
            <span className="inline-block min-w-[89px] text-[60px] font-light leading-[69px] tracking-[-1.8px]">{track.bpm}</span>
            <span className="text-[20px] leading-[28px]">BPM</span>
          </p>
          <p className="relative text-[14px] leading-5 text-ink">고정 박자</p>
        </section>

        <p className="mt-[22px] text-[20px] font-medium leading-7 text-ink">15초 미리 듣기</p>
        <p className="mt-2 text-[14px] leading-[22px] text-muted">인터랙션 시안에서는 음악이 재생되지 않아요.</p>
        <p className="mt-4 text-[14px] leading-[22px] text-muted">다른 곡을 고르면 이전 미리 듣기는 멈춰요.</p>
      </div>

      <RunFooter hasSecondary>
        <PrimaryButton label="이 곡으로 준비하기" onClick={handleConfirm} />
        <TextButton label="다른 곡 고르기" onClick={handleBack} />
      </RunFooter>
    </div>
  )
}

export default MusicPreviewPage
