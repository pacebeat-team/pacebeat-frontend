import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { HomePage } from '../pages/HomePage'
import { RunningPage } from '../pages/RunningPage'
import { RecordsPage } from '../pages/RecordsPage'
import { GrowthPage } from '../pages/GrowthPage'
import { MyPage } from '../pages/MyPage'
import { SplashPage } from '../pages/SplashPage'
import { ResultDetailsPage, ResultGoalPage, ResultPartialPage } from '../pages/result/ResultPages'

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
        path: 'running',
        element: <RunningPage />,
      },
      {
        path: 'result',
        element: <ResultGoalPage />,
      },
      {
        path: 'result/details',
        element: <ResultDetailsPage />,
      },
      {
        path: 'result/reflection',
        element: <ResultGoalPage initialReflectionOpen />,
      },
      {
        path: 'result/partial',
        element: <ResultPartialPage />,
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


