import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { ScreenHeader } from '../../components/common/ScreenHeader'
import { MY_ROUTES } from '../../features/my/routes'
import { formatMonthDay } from '../../features/posture/fromRecords'
import { readPostureInputs, usePostureBack } from '../../features/posture/postureAccess'
import { buildOneSide, POSTURE_PATH } from '../../features/posture/postureReport'
import { LinkRow } from './GrowthParts'

const SIDE_LABEL = { left: '왼쪽', right: '오른쪽' } as const

// Figma `POSTURE / One side`: 한쪽만 측정된 러닝의 상세. 좌우 비교 그래프와 압력 분포는 보이지 않는다.
// 한쪽만 측정된 기록이 아니면(없는 기록, 양쪽 측정, 자세 요약 없음) 자세 리포트로 보낸다.
export function PostureOneSidePage() {
  const goBack = usePostureBack()
  const { recordId = '' } = useParams()
  const [model] = useState(() => buildOneSide(readPostureInputs(), recordId))
  if (model === null) return <Navigate to={POSTURE_PATH} replace />
  const side = SIDE_LABEL[model.side]
  const other = SIDE_LABEL[model.side === 'left' ? 'right' : 'left']
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app-bg font-pace text-ink">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
        <ScreenHeader title="자세 리포트" onBack={goBack} />
        <h2 className="mt-4 w-full text-[34px] font-light leading-[44px] tracking-[-1.02px]">{side} 측정 기록</h2>
        <p className="mt-4 text-[14px] leading-5 text-muted">{formatMonthDay(model.startedAt)}</p>
        <p className="mt-6 text-[28px] font-light leading-[34px]">{side}만 측정됐어요.</p>
        <p className="mt-4 text-[16px] leading-[22px]">
          {other} 데이터가 없어 좌우 밸런스를 비교할 수 없어요. 이 러닝은 좌우 비교 통계에서 제외돼요.
        </p>
        <div className="mt-7 flex flex-col">
          <LinkRow to={MY_ROUTES.device} label="인솔 연결 상태" />
          <div aria-hidden="true" className="h-px bg-line" />
          <LinkRow to={POSTURE_PATH} label="전체 자세 리포트" />
        </div>
      </div>
    </div>
  )
}

export default PostureOneSidePage
