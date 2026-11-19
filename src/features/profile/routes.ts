// 프로필 화면 경로. 라우터와 화면 이동에서 같은 상수를 쓴다.
export const PROFILE_ROUTES = {
  consent: '/profile/consent',
  nickname: '/profile/nickname',
  demographics: '/profile/demographics',
  body: '/profile/body',
} as const

// 프로필 입력을 마친 뒤(키·몸무게 화면의 "시작하기", "건너뛰기") 이동하는 임시 경로.
// TODO(Issue D): 온보딩 완료 처리와 최종 목적지가 정해지면 이 상수를 교체한다. 지금은 최종 목적지가 아니다.
export const PROFILE_COMPLETE_PATH = '/home'
