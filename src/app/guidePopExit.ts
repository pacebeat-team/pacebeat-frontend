// Guide에서 브라우저 뒤로 가기나 Android 하드웨어 뒤로 가기(웹뷰에서는 history 이동, POP)로 나갈 때도
// 헤더 뒤로 가기와 같은 종료 기록을 남기기 위한 판단 함수다.
//
// popstate 리스너로는 기록할 수 없다. React Router가 POP을 먼저 처리해 화면을 바꾸고 프로필 가드의 리다이렉트까지
// 끝내므로, Guide의 리스너는 이미 사라진 뒤다. 그래서 라우터의 blocker(useBlocker)로 이동이 확정되기 전에 잡는다.
// 이 함수는 "이 이동을 잡아 종료 기록을 남기고 그대로 진행할지"만 판단한다. (이동 자체를 막지 않으며 새로 navigate하지도 않는다.)
//
// - 기록 이동(POP)만 대상이다. 앱 내부 navigate(push/replace, 헤더 뒤로 가기, 시작 버튼, 건너뛰기)는 잡지 않는다.
// - 측정 흐름 안의 이동(/measurement/*, 예: 측정 화면에서 돌아온 뒤 앞으로 가기)은 Guide를 나가는 것이 아니므로 잡지 않는다.
export interface GuideExitNavigation {
  historyAction: string
  nextLocation: { pathname: string }
}

export function shouldRecordGuideExit({ historyAction, nextLocation }: GuideExitNavigation): boolean {
  if (historyAction !== 'POP') return false
  return !nextLocation.pathname.startsWith('/measurement/')
}
