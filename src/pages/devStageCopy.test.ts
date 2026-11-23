import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

// 화면에 "시안·프로토타입" 등 개발 단계 표현이 남아 있는 화면이, 그 문구가 말하는 대로 실제로 아무 일도 하지 않는지 확인한다.
// 문구 자체를 금지하거나 바꾸라는 검사가 아니다(대체 문구는 디자인 문구표가 와야 정한다).
// 이 화면들이 실제 동작을 갖게 되면(예: 데이터 삭제·내보내기 구현) 이 검사가 실패하며, 그때 문구표에 따라 문구를 바꿔야 한다는 신호이다.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const SIDE_EFFECTS = /localStorage|sessionStorage|indexedDB|removeItem|new Blob|createObjectURL|download=|new Audio|<audio|AudioContext|bluetooth|fetch\(/

describe('개발 단계 표현이 있는 화면은 문구와 실제 동작이 일치한다', () => {
  const pages: readonly (readonly [string, string])[] = [
    ['MusicPreviewPage (음악이 재생되지 않아요)', './running/MusicPreviewPage.tsx'],
    ['AccountPage (로그인·기기 권한을 변경하지 않아요)', './my/AccountPage.tsx'],
    ['DataDeletePage (데이터를 삭제하지 않아요)', './my/DataDeletePage.tsx'],
    ['DataExportPage (파일을 생성하지 않아요)', './my/DataExportPage.tsx'],
    ['DeviceHelpPage (기기에 연결·해제하지 않아요)', './my/DeviceHelpPage.tsx'],
    ['DeviceCalibrationPage (센서 값을 변경하지 않아요)', './my/DeviceCalibrationPage.tsx'],
  ]
  for (const [name, path] of pages) {
    test(`${name}: 저장소·파일·오디오·블루투스·네트워크 부수 효과가 없다`, () => {
      assert.doesNotMatch(read(path), SIDE_EFFECTS)
    })
  }
  test('삭제 화면은 확인과 돌아가기가 같은 이동만 한다(버튼 문구는 미확정이라 바꾸지 않는다)', () => {
    const source = read('./my/DataDeletePage.tsx')
    assert.match(source, /onBack=\{goBack\} onConfirm=\{goBack\}/)
  })
})

describe('측정 안내(GuidePage)의 예시·가상 표시는 해당 상태에서만 보인다', () => {
  const source = read('./measurement/GuidePage.tsx')
  test('"예시 기준" 문구는 예시 데이터(view.isSample)일 때만 렌더링된다', () => {
    assert.match(source, /view\.isSample && \(\s*<p[^>]*>\s*이 시안의 측정 시간은 예시 기준이에요\./)
  })
  test('가상 데이터 안내는 isVirtual일 때만 렌더링된다', () => {
    assert.match(source, /isVirtual && \(\s*<p[^>]*>\s*가상 데이터로 진행해요\./)
  })
})
