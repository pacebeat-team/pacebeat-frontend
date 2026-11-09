import { create } from 'zustand'

export type RunningExperience = 'beginner' | 'occasional' | 'regular'
export type WeeklyFrequency = 1 | 2 | '3+'

interface OnboardingState {
  experience: RunningExperience | null
  weeklyFrequency: WeeklyFrequency | null
  permissionsReviewed: boolean
  setExperience: (experience: RunningExperience) => void
  setWeeklyFrequency: (frequency: WeeklyFrequency) => void
  setPermissionsReviewed: (reviewed: boolean) => void
  reset: () => void
}

const initialState = {
  experience: null,
  weeklyFrequency: null,
  permissionsReviewed: false,
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  ...initialState,
  setExperience: (experience) => set({ experience }),
  setWeeklyFrequency: (weeklyFrequency) => set({ weeklyFrequency }),
  setPermissionsReviewed: (permissionsReviewed) => set({ permissionsReviewed }),
  reset: () => set(initialState),
}))
