import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  ExperienceLevel,
  LocationPermission,
  MotionFitnessSupport,
  OnboardingData,
  WeeklyRuns,
} from '../types/onboarding'

interface OnboardingActions {
  setExperienceLevel: (value: ExperienceLevel | null) => void
  setWeeklyRuns: (value: WeeklyRuns | null) => void
  setLocationPermission: (value: LocationPermission) => void
  setMotionFitnessSupport: (value: MotionFitnessSupport) => void
  completeOnboarding: () => void
  completeBaselineMeasurement: () => void
  reset: () => void
}

export type OnboardingState = OnboardingData & OnboardingActions

const initialData: OnboardingData = {
  experienceLevel: null,
  weeklyRuns: null,
  locationPermission: null,
  motionFitnessSupport: null,
  timeOnlyMode: null,
  onboardingCompleted: false,
  baselineMeasurementCompleted: false,
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      ...initialData,
      setExperienceLevel: (experienceLevel) => set({ experienceLevel }),
      setWeeklyRuns: (weeklyRuns) => set({ weeklyRuns }),
      setLocationPermission: (locationPermission) =>
        set({
          locationPermission,
          timeOnlyMode: locationPermission === null ? null : locationPermission === 'denied',
        }),
      setMotionFitnessSupport: (motionFitnessSupport) => set({ motionFitnessSupport }),
      // 이미 true이면 상태를 바꾸지 않는다. (멱등)
      completeOnboarding: () => {
        if (get().onboardingCompleted) return
        set({ onboardingCompleted: true })
      },
      completeBaselineMeasurement: () => {
        if (get().baselineMeasurementCompleted) return
        set({ baselineMeasurementCompleted: true })
      },
      reset: () => set(initialData),
    }),
    {
      name: 'pacebeat-onboarding',
      partialize: (state): OnboardingData => ({
        experienceLevel: state.experienceLevel,
        weeklyRuns: state.weeklyRuns,
        locationPermission: state.locationPermission,
        motionFitnessSupport: state.motionFitnessSupport,
        timeOnlyMode: state.timeOnlyMode,
        onboardingCompleted: state.onboardingCompleted,
        baselineMeasurementCompleted: state.baselineMeasurementCompleted,
      }),
    },
  ),
)
