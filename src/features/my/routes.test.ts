import assert from 'node:assert/strict'
import test from 'node:test'
import { isMyNavHidden, MY_ROUTES } from './routes.ts'

test('하단 네비: 입력·확인 화면은 숨기고 마이 메인과 탭 화면은 보인다', () => {
  assert.equal(isMyNavHidden(MY_ROUTES.profile), true)
  assert.equal(isMyNavHidden(`${MY_ROUTES.deviceHelp}/`), true)
  assert.equal(isMyNavHidden(MY_ROUTES.deviceCalibration), true)
  for (const path of [MY_ROUTES.account, MY_ROUTES.data, MY_ROUTES.dataExport, MY_ROUTES.dataDelete]) assert.equal(isMyNavHidden(path), true)
  assert.equal(isMyNavHidden(MY_ROUTES.root), false)
  assert.equal(isMyNavHidden(MY_ROUTES.device), false)
  assert.equal(isMyNavHidden(MY_ROUTES.guidance), false)
})
