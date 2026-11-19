import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

// 진행 화면의 오디오 토글(Figma `control / Audio`의 Sound=On/Off) 상태.
// - ON/OFF 전환만 담는다. 실제 오디오 재생·음성 안내는 하지 않고, 저장하지도 않는다(기본 ON).
export interface RunAudioState {
  readonly soundOn: boolean
  readonly toggleSound: () => void
}

export function createRunAudioStore() {
  return createStore<RunAudioState>()((set) => ({
    soundOn: true,
    toggleSound: () => set(({ soundOn }) => ({ soundOn: !soundOn })),
  }))
}

export const runAudioStore = createRunAudioStore()

export function useRunAudio<T>(selector: (state: RunAudioState) => T): T {
  return useStore(runAudioStore, selector)
}
