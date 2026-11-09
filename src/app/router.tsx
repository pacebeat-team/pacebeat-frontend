import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { HomePage } from '../pages/HomePage'
import { RunningPage } from '../pages/RunningPage'
import { RecordsPage } from '../pages/RecordsPage'
import { GrowthPage } from '../pages/GrowthPage'
import { MyPage } from '../pages/MyPage'
import { SplashPage } from '../pages/SplashPage'
import {
  MeasurementActivePage,
  MeasurementGuidePage,
  MeasurementResultPage,
  OnboardingExperiencePage,
  OnboardingIntroPage,
  OnboardingPermissionsPage,
} from '../pages/onboarding/OnboardingPages'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <SplashPage />,
      },
      {
        path: 'home',
        element: <HomePage />,
      },
      {
        path: 'onboarding',
        element: <OnboardingIntroPage />,
      },
      {
        path: 'onboarding/experience',
        element: <OnboardingExperiencePage />,
      },
      {
        path: 'onboarding/permissions',
        element: <OnboardingPermissionsPage />,
      },
      {
        path: 'onboarding/measurement',
        element: <MeasurementGuidePage />,
      },
      {
        path: 'onboarding/measurement/active',
        element: <MeasurementActivePage />,
      },
      {
        path: 'onboarding/measurement/result',
        element: <MeasurementResultPage />,
      },
      {
        path: 'running',
        element: <RunningPage />,
      },
      {
        path: 'records',
        element: <RecordsPage />,
      },
      {
        path: 'growth',
        element: <GrowthPage />,
      },
      {
        path: 'my',
        element: <MyPage />,
      },
      {
        path: '*',
        element: <Navigate to="/home" replace />,
      },
    ],
  },
])

export default router

