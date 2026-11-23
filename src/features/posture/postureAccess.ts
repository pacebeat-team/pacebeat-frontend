import { useLocation, useNavigate } from 'react-router-dom'
import { createRunStorage } from '../running/runStorage.ts'
import { toPostureInputs } from './fromRecords.ts'
import type { PostureRecordInput } from './postureReport.ts'

const GROWTH_PATH = '/growth'

// 이전 화면이 있으면 한 단계 돌아가고, 직접 열었으면 성장 탭으로 간다.
export function usePostureBack(): () => void {
  const navigate = useNavigate()
  const location = useLocation()
  return () => (location.key !== 'default' ? navigate(-1) : navigate(GROWTH_PATH, { replace: true }))
}

// 저장된 기록에서 자세 집계 입력을 읽는다. 읽을 수 없으면 데이터가 없는 것과 같이 다룬다(오류 화면은 Figma에 없다).
export function readPostureInputs(): PostureRecordInput[] {
  const result = createRunStorage().readRecords()
  return result.ok ? toPostureInputs(result.records) : []
}
