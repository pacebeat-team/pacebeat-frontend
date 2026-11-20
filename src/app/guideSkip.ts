// 기초 측정 Guide에서 "건너뛰기"를 누른 일을 이번 앱 실행 동안만 기억한다.
// - 영구 저장하지 않는다. baselineMeasurementCompleted는 건너뛰어도 바뀌지 않으므로, 다음 앱 실행에서는 Splash가 다시 Guide로 안내한다.
// - 새로고침해도 같은 탭에서는 유지되도록 sessionStorage를 쓴다. 탭이나 앱을 닫으면 사라진다.
// - sessionStorage를 쓸 수 없는 환경(차단, 테스트)에서는 메모리에만 기억한다.

export const GUIDE_SKIP_STORAGE_KEY = 'pacebeat-guide-skipped'

export type GuideSkipStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface GuideSkipSession {
  // 건너뛰기를 눌렀음을 기록한다. 여러 번 불러도 같다.
  markSkipped: () => void
  // 이번 앱 실행에서 건너뛰었는가.
  wasSkipped: () => boolean
}

// 키 하나에 대한 "이번 앱 실행 동안의 표시"를 만든다. 저장소를 못 얻거나 읽고 쓰기가 실패해도 예외를 던지지 않는다.
function createSessionFlag(getStorage: () => GuideSkipStorage | null, key: string) {
  let marked = false

  function storage(): GuideSkipStorage | null {
    try {
      return getStorage()
    } catch {
      return null
    }
  }

  return {
    mark: () => {
      marked = true
      try {
        storage()?.setItem(key, '1')
      } catch {
        // 저장에 실패해도 이번 실행 동안은 메모리 값으로 기억한다.
      }
    },
    isMarked: () => {
      if (marked) return true
      try {
        return storage()?.getItem(key) === '1'
      } catch {
        return false
      }
    },
  }
}

// 저장소를 돌려주는 함수를 받아 "건너뛰기" 기록을 만든다.
export function createGuideSkipSession(getStorage: () => GuideSkipStorage | null): GuideSkipSession {
  const flag = createSessionFlag(getStorage, GUIDE_SKIP_STORAGE_KEY)
  return { markSkipped: flag.mark, wasSkipped: flag.isMarked }
}

export const guideSkipSession = createGuideSkipSession(() => globalThis.sessionStorage ?? null)

// Guide 헤더의 뒤로 가기로 Home에 나온 일을 이번 앱 실행 동안만 기억한다. "건너뛰기"와는 다른 기록이다.
// - 기초 측정 완료 상태와 건너뛰기 기록을 바꾸지 않는다. 영구 저장하지 않으므로 다음 앱 실행에서는 Splash가 다시 Guide로 안내한다.
// - 이 기록이 있으면 Home에서 브라우저 뒤로 가기로 완료된 프로필 단계에 들어와도 가드가 Guide로 되돌리지 않고 Home에 머물게 한다.
export const GUIDE_BACK_STORAGE_KEY = 'pacebeat-guide-left'

export interface GuideBackSession {
  // Guide의 뒤로 가기로 나왔음을 기록한다. 여러 번 불러도 같다.
  markLeft: () => void
  // 이번 앱 실행에서 Guide의 뒤로 가기로 나왔는가.
  wasLeft: () => boolean
}

export function createGuideBackSession(getStorage: () => GuideSkipStorage | null): GuideBackSession {
  const flag = createSessionFlag(getStorage, GUIDE_BACK_STORAGE_KEY)
  return { markLeft: flag.mark, wasLeft: flag.isMarked }
}

export const guideBackSession = createGuideBackSession(() => globalThis.sessionStorage ?? null)
