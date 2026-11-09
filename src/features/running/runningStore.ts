import { create } from 'zustand'

export type RunningTrack = 'Morning Stride' | 'City Loop' | 'Easy Tempo' | 'Night Pace'

interface RunningState {
  distanceGoal: 1 | 3 | 5
  targetMinutes: number
  track: RunningTrack | null
  previewingTrack: RunningTrack | null
  elapsedSeconds: number
  distanceKm: number
  setDistanceGoal: (distanceGoal: 1 | 3 | 5) => void
  setTargetMinutes: (targetMinutes: number) => void
  setTrack: (track: RunningTrack | null) => void
  setPreviewingTrack: (track: RunningTrack | null) => void
  startDemoRun: () => void
  tick: () => void
  resetRun: () => void
}

const suggestedMinutes = { 1: 7, 3: 21, 5: 35 } as const

export const useRunningStore = create<RunningState>((set) => ({
  distanceGoal: 3,
  targetMinutes: 21,
  track: 'Morning Stride',
  previewingTrack: null,
  elapsedSeconds: 0,
  distanceKm: 0,
  setDistanceGoal: (distanceGoal) => set({ distanceGoal, targetMinutes: suggestedMinutes[distanceGoal] }),
  setTargetMinutes: (targetMinutes) => set({ targetMinutes: Math.max(1, Math.min(180, targetMinutes)) }),
  setTrack: (track) => set({ track }),
  setPreviewingTrack: (previewingTrack) => set({ previewingTrack }),
  startDemoRun: () => set({ elapsedSeconds: 591, distanceKm: 1.42 }),
  tick: () => set((state) => ({
    elapsedSeconds: state.elapsedSeconds + 1,
    distanceKm: Math.min(state.distanceGoal, state.distanceKm + 0.0024),
  })),
  resetRun: () => set({ elapsedSeconds: 0, distanceKm: 0, previewingTrack: null }),
}))

