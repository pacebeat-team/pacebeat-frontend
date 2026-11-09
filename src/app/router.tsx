import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { HomePage } from '../pages/HomePage'
import { RunningPage } from '../pages/RunningPage'
import { RecordsPage } from '../pages/RecordsPage'
import { GrowthPage } from '../pages/GrowthPage'
import { MyPage } from '../pages/MyPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/home" replace />,
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
