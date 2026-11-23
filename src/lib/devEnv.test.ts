import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { isDevBuild } from './devEnv.ts'

describe('개발 빌드 판정 (isDevBuild)', () => {
  test('개발 빌드가 아닌 환경(Node 테스트)에서는 false이다: 차단이 기본이다', () => {
    assert.equal(isDevBuild(), false)
  })

  // 가상 GPS·Mock의 환경 판정은 isDevBuild 한 곳에서만 한다(중복 판정 금지).
  test('앱 코드는 import.meta.env.DEV를 직접 읽지 않고 isDevBuild만 쓴다', () => {
    const files = [
      '../stores/measurementStore.ts',
      '../features/measurementView/useMeasurementView.ts',
      '../app/entryFlow.ts',
    ]
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      assert.doesNotMatch(source, /import\.meta[^\n]*\.DEV/, `${file}은 isDevBuild를 써야 한다`)
      assert.match(source, /isDevBuild/, `${file}은 isDevBuild를 쓴다`)
    }
  })
})
