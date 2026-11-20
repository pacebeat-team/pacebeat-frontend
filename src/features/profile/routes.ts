// 프로필 화면 경로. 라우터와 화면 이동에서 같은 상수를 쓴다.
export const PROFILE_ROUTES = {
  consent: '/profile/consent',
  nickname: '/profile/nickname',
  demographics: '/profile/demographics',
  body: '/profile/body',
} as const

// 프로필 가입을 마친 뒤 이동할 곳을 라우터가 알려 주지 않았을 때만 쓰는 기본 경로.
// 앱에서는 router.tsx가 app/entryFlow.ts의 resolvePostProfilePath를 가드·/profile 진입·키·몸무게 화면에 넘기므로 실제로는 쓰이지 않는다.
// (프로필 화면을 라우터 없이 따로 쓸 때의 기본값으로만 남겨 둔다.)
export const PROFILE_COMPLETE_PATH = '/home'

// 프로필 가입을 마친 뒤 갈 경로를 돌려준다. 가드, /profile 진입, 키·몸무게 화면이 모두 이 함수를 기본값으로 쓴다.
// D-2에서는 라우터가 세 곳에 같은 함수를 한 번에 넘긴다. 이 함수는 렌더 중에도 불릴 수 있으므로 값을 바꾸지 않고 같은 입력에 같은 결과만 돌려주는 순수 함수여야 한다.
export function resolveProfileNextPath(): string {
  return PROFILE_COMPLETE_PATH
}
