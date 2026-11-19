import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { HomePage } from '../pages/HomePage'
import { RunFlowGuard } from '../pages/running/RunFlowGuard'
import { GoalPage } from '../pages/running/GoalPage'
import { TimePickerPage } from '../pages/running/TimePickerPage'
import { MusicPage } from '../pages/running/MusicPage'
import { MusicPreviewPage } from '../pages/running/MusicPreviewPage'
import { ReadyPage } from '../pages/running/ReadyPage'
import { CountdownPage } from '../pages/running/CountdownPage'
import { ActivePage as RunActivePage } from '../pages/running/ActivePage'
import { EndConfirmPage } from '../pages/running/EndConfirmPage'
import { ResultPage as RunResultPage } from '../pages/running/ResultPage'
import { ResultDetailsPage } from '../pages/running/ResultDetailsPage'
import { ArrivalPage } from '../pages/running/ArrivalPage'
import { RecordsPage } from '../pages/RecordsPage'
import { GrowthPage } from '../pages/GrowthPage'
import { MyPage } from '../pages/MyPage'
import { ProfileEditPage } from '../pages/my/ProfileEditPage'
import { DeviceInsolesPage } from '../pages/my/DeviceInsolesPage'
import { DeviceHelpPage } from '../pages/my/DeviceHelpPage'
import { DeviceCalibrationPage } from '../pages/my/DeviceCalibrationPage'
import { SplashPage } from '../pages/SplashPage'
import { IntroPage } from '../pages/onboarding/IntroPage'
import { ExperiencePage } from '../pages/onboarding/ExperiencePage'
import { PermissionsPage } from '../pages/onboarding/PermissionsPage'
import { GuidePage } from '../pages/measurement/GuidePage'
import { ActivePage } from '../pages/measurement/ActivePage'
import { ResultPage } from '../pages/measurement/ResultPage'
import { ProfileEntryRedirect, ProfileStepGuard } from '../features/profile/components/ProfileStepGuard'
import { ConsentScreen } from '../features/profile/screens/ConsentScreen'
import { NicknameScreen } from '../features/profile/screens/NicknameScreen'
import { DemographicsScreen } from '../features/profile/screens/DemographicsScreen'
import { BodyScreen } from '../features/profile/screens/BodyScreen'
import { PROFILE_ROUTES } from '../features/profile/routes'

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
        // /profile은 지금 상태에 맞는 단계로 보낸다. (가입 전이면 동의 화면)
        path: 'profile',
        element: <ProfileEntryRedirect />,
      },
      {
        // 프로필 단계 화면은 가드 아래에 둔다. 지금 열 수 없는 단계는 먼저 마쳐야 할 단계로 보낸다.
        element: <ProfileStepGuard />,
        children: [
          {
            path: PROFILE_ROUTES.consent,
            element: <ConsentScreen />,
          },
          {
            path: PROFILE_ROUTES.nickname,
            element: <NicknameScreen />,
          },
          {
            path: PROFILE_ROUTES.demographics,
            element: <DemographicsScreen />,
          },
          {
            path: PROFILE_ROUTES.body,
            element: <BodyScreen />,
          },
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
          { path: 'music/:trackId', element: <MusicPreviewPage /> },
          { path: 'ready', element: <ReadyPage /> },
          { path: 'countdown', element: <CountdownPage /> },
          { path: 'active', element: <RunActivePage /> },
          { path: 'end', element: <EndConfirmPage /> },
          { path: 'arrival', element: <ArrivalPage /> },
          { path: 'result', element: <RunResultPage /> },
          { path: 'result/details', element: <ResultDetailsPage /> },
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
        children: [
          { index: true, element: <MyPage /> },
          { path: 'profile', element: <ProfileEditPage /> },
          { path: 'device', element: <DeviceInsolesPage /> },
          { path: 'device/help', element: <DeviceHelpPage /> },
          { path: 'device/calibration', element: <DeviceCalibrationPage /> },
        ],
      },
      {
        path: '*',
        element: <Navigate to="/home" replace />,
      },
    ],
  },
])

export default router
