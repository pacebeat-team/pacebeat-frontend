// 마이(08) 화면 경로. 라우터와 화면 이동에서 같은 상수를 쓴다.
export const MY_ROUTES = {
  root: '/my',
  // 가입을 마친 사용자의 프로필 수정. 가입 흐름(/profile/...)과 분리해 ProfileStepGuard를 건드리지 않는다.
  profile: '/my/profile',
  guidance: '/my/guidance',
  device: '/my/device',
  deviceHelp: '/my/device/help',
  deviceCalibration: '/my/device/calibration',
  account: '/my/account',
  accountLogin: '/my/account/login',
  data: '/my/data',
  dataExport: '/my/data/export',
  dataDelete: '/my/data/delete',
} as const

export const MEASUREMENT_GUIDE_PATH = '/measurement/guide'

// 하단 네비를 보이지 않는 마이 하위 화면. (Figma에서 하단 탭 대신 CTA가 있거나 입력 화면인 곳)
const NAV_HIDDEN: readonly string[] = [
  MY_ROUTES.profile,
  MY_ROUTES.deviceHelp,
  MY_ROUTES.deviceCalibration,
  MY_ROUTES.account,
  MY_ROUTES.accountLogin,
  MY_ROUTES.data,
  MY_ROUTES.dataExport,
  MY_ROUTES.dataDelete,
]

export function isMyNavHidden(pathname: string): boolean {
  return NAV_HIDDEN.includes(pathname.replace(/\/+$/, ''))
}
