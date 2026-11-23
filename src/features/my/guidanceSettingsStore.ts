import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import {
  loadGuidanceSettings,
  saveGuidanceSettings,
  type GuidanceFrequency,
  type GuidanceSettings,
  type GuidanceStorage,
} from './guidanceSettings.ts'

interface GuidanceActions {
  setBeatGuide: (value: boolean) => void
  setVoiceGuide: (value: boolean) => void
  setFrequency: (value: GuidanceFrequency) => void
  setAutoPause: (value: boolean) => void
}

export type GuidanceState = GuidanceSettings & GuidanceActions

function getBrowserStorage(): GuidanceStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // 저장소 접근이 막힌 환경(비공개 모드 등)
  }
}

// 설정을 바꿀 때마다 저장한다. 저장에 실패해도 화면의 값은 유지한다(새로고침하면 기본값으로 돌아간다).
export function createGuidanceSettingsStore(storage: GuidanceStorage | null = getBrowserStorage()) {
  return createStore<GuidanceState>()((set, get) => {
    const update = (patch: Partial<GuidanceSettings>) => {
      const { beatGuide, voiceGuide, frequency, autoPause } = { ...get(), ...patch }
      set(patch)
      saveGuidanceSettings(storage, { beatGuide, voiceGuide, frequency, autoPause })
    }
    return {
      ...loadGuidanceSettings(storage),
      setBeatGuide: (beatGuide) => update({ beatGuide }),
      setVoiceGuide: (voiceGuide) => update({ voiceGuide }),
      setFrequency: (frequency) => update({ frequency }),
      setAutoPause: (autoPause) => update({ autoPause }),
    }
  })
}

export const guidanceSettingsStore = createGuidanceSettingsStore()

export function useGuidanceSettings<T>(selector: (state: GuidanceState) => T): T {
  return useStore(guidanceSettingsStore, selector)
}

// 러닝을 시작하는 순간의 안내 설정(값만 복사한다). 러닝 세션이 이것을 고정해 쓴다.
export function getGuidanceSnapshot(): GuidanceSettings {
  const { beatGuide, voiceGuide, frequency, autoPause } = guidanceSettingsStore.getState()
  return { beatGuide, voiceGuide, frequency, autoPause }
}
