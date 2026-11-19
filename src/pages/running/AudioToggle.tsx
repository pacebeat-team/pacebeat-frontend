import volumeIcon from '../../assets/icons/run-volume.svg'
import { runAudioStore, useRunAudio } from '../../features/running/runAudioStore'

// Figma `control / Audio`(48x48). Sound=On은 스피커 아이콘, Sound=Off는 같은 아이콘 위에 45° 사선(25x2, #111)이 겹친다.
// 상태 전환만 한다(실제 오디오 재생 없음). 사선의 기준이 되도록 호출하는 쪽이 position(absolute 등)을 정한다.
export function AudioToggle({ className = '' }: { className?: string }) {
  const soundOn = useRunAudio((state) => state.soundOn)
  return (
    <button
      type="button"
      aria-label="음성 안내"
      aria-pressed={soundOn}
      onClick={() => runAudioStore.getState().toggleSound()}
      className={`flex size-12 cursor-pointer items-start rounded-full border-[0.5px] border-white/[0.96] bg-white/[0.45] p-3 ${className}`}
    >
      <img src={volumeIcon} alt="" aria-hidden="true" className="size-6 shrink-0" />
      {!soundOn && (
        <span aria-hidden="true" className="absolute left-[10.5px] top-[32.5px] h-[2px] w-[25px] origin-left -rotate-45 bg-[#111111]" />
      )}
    </button>
  )
}
