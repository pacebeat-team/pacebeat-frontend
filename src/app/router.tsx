import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { HomePage } from '../pages/HomePage'
import { RunningPage } from '../pages/RunningPage'
import { RecordsPage } from '../pages/RecordsPage'
import { GrowthPage } from '../pages/GrowthPage'
import { MyPage } from '../pages/MyPage'
import { SplashPage } from '../pages/SplashPage'
import { RunningActivePage, RunningCountdownPage, RunningEndPage, RunningMusicPage, RunningPausedPage, RunningReadyPage } from '../pages/running/RunningPages'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <SplashPage /> },
      { path: 'home', element: <HomePage /> },
      { path: 'running', element: <RunningPage /> },
      { path: 'running/music', element: <RunningMusicPage /> },
      { path: 'running/ready', element: <RunningReadyPage /> },
      { path: 'running/countdown', element: <RunningCountdownPage /> },
      { path: 'running/active', element: <RunningActivePage /> },
      { path: 'running/paused', element: <RunningPausedPage /> },
      { path: 'running/end', element: <RunningEndPage /> },
      { path: 'records', element: <RecordsPage /> },
      { path: 'growth', element: <GrowthPage /> },
      { path: 'my', element: <MyPage /> },
      { path: '*', element: <Navigate to="/home" replace /> },
    ],
  },
])

export default router

