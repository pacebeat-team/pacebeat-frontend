import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { HomePage } from '../pages/HomePage'
import { RunFlowGuard } from '../pages/running/RunFlowGuard'
import { GoalPage } from '../pages/running/GoalPage'
import { TimePickerPage } from '../pages/running/TimePickerPage'
import { MusicPage } from '../pages/running/MusicPage'
import { ReadyPage } from '../pages/running/ReadyPage'
import { CountdownPage } from '../pages/running/CountdownPage'
import { RecordsPage } from '../pages/RecordsPage'
import { GrowthPage } from '../pages/GrowthPage'
import { MyPage } from '../pages/MyPage'
import { SplashPage } from '../pages/SplashPage'
import { IntroPage } from '../pages/onboarding/IntroPage'
import { ExperiencePage } from '../pages/onboarding/ExperiencePage'
import { PermissionsPage } from '../pages/onboarding/PermissionsPage'
import { GuidePage } from '../pages/measurement/GuidePage'
import { ActivePage } from '../pages/measurement/ActivePage'
import { ResultPage } from '../pages/measurement/ResultPage'

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
        path: 'onboarding',
        children: [
          { index: true, element: <Navigate to="/onboarding/intro" replace /> },
          { path: 'intro', element: <IntroPage /> },
          { path: 'experience', element: <ExperiencePage /> },
          { path: 'permissions', element: <PermissionsPage /> },
        ],
      },
      {
        path: 'measurement',
        children: [
          { index: true, element: <Navigate to="/measurement/guide" replace /> },
          { path: 'guide', element: <GuidePage /> },
          { path: 'active', element: <ActivePage /> },
          { path: 'result', element: <ResultPage /> },
        ],
      },
      {
        path: 'home',
        element: <HomePage />,
      },
      {
        path: 'running',
        element: <RunFlowGuard />,
        children: [
          { index: true, element: <GoalPage /> },
          { path: 'time', element: <TimePickerPage /> },
          { path: 'music', element: <MusicPage /> },
          { path: 'ready', element: <ReadyPage /> },
          { path: 'countdown', element: <CountdownPage /> },
          { path: '*', element: <Navigate to="/running" replace /> },
        ],
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
