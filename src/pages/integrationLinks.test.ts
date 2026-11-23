import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { MY_ROUTES } from '../features/my/routes.ts'
import { RUN_PATHS } from '../features/running/runFlow.ts'

// 화면 통합 연결 점검(②): 화면이 향하는 경로가 라우터에 선언돼 있는지, 통합으로 정리한 연결·공통 컴포넌트가 유지되는지 소스로 확인한다.
// (컴포넌트 렌더 테스트 도구는 아직 없다. 경로 선언과 사용 관계만 본다.)

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const router = read('../app/router.tsx')

// 'parent' 아래에 child 경로가 선언돼 있는가. child가 없으면 parent만 확인한다.
function declares(parent: string, child?: string): boolean {
  const at = router.indexOf(`path: '${parent}'`)
  if (at < 0) return false
  return child === undefined || router.indexOf(`path: '${child}'`, at) > at
}

describe('라우터에 선언된 경로', () => {
  test('마이 하위 화면이 모두 선언돼 있다', () => {
    for (const path of Object.values(MY_ROUTES)) {
      const rest = path.replace(/^\/my\/?/, '')
      assert.ok(declares('my', rest === '' ? undefined : rest), `${path}이(가) 라우터에 없음`)
    }
  })
  test('기록 상세·성장 자세 리포트·러닝 하위 화면이 선언돼 있다', () => {
    assert.ok(declares('records', ':recordId'))
    assert.ok(declares('growth', 'posture'))
    for (const path of Object.values(RUN_PATHS)) {
      const rest = path.replace(/^\/running\/?/, '')
      if (rest === '') continue
      const key = rest.startsWith('music/') ? 'music/:trackId' : rest
      assert.ok(declares('running', key), `${path}이(가) 라우터에 없음`)
    }
  })
  test('메인 탭 다섯 개가 모두 선언돼 있다', () => {
    for (const tab of ['home', 'running', 'records', 'growth', 'my']) assert.ok(declares(tab), tab)
  })
})

describe('통합 연결 정리', () => {
  test('자세 리포트의 인솔 연결 확인은 마이 스마트 인솔 화면(/my/device)으로 간다', () => {
    const posture = read('./growth/PosturePage.tsx')
    assert.ok(posture.includes('MY_ROUTES.device'))
    assert.ok(!/navigate\(\s*['"]\/my['"]/.test(posture))
    assert.equal(MY_ROUTES.device, '/my/device')
  })
  test('성장 화면은 기록 화면의 공통 StateCard를 쓰고 같은 이름의 중복 구현이 없다', () => {
    const parts = read('./growth/GrowthParts.tsx')
    const growth = read('./GrowthPage.tsx')
    assert.ok(!/function StateCard/.test(parts))
    assert.ok(/import \{ StateCard \} from '\.\/records\/StateCard'/.test(growth))
    assert.ok(!/actionLabel=/.test(growth))
    assert.equal((read('./records/StateCard.tsx').match(/export function StateCard/g) ?? []).length, 1)
  })
  test('성장·마이의 기록 링크는 기록 메인(/records)을 가리킨다', () => {
    assert.ok(read('./GrowthPage.tsx').includes('to="/records"'))
    assert.ok(read('./my/DataPage.tsx').includes('to="/records"'))
  })
})
