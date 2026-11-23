import { useState } from 'react'
import { downloadExportFile, exportRecords } from '../../features/my/dataExport'
import { MY_ROUTES } from '../../features/my/routes'
import { useMyBack } from '../../features/my/useMyBack'
import { DeviceScreen } from './DeviceParts'

const FORMATS = ['CSV', 'JSON'] as const

// Figma `MY / Data export`. 형식을 고르고 확인하면 저장된 러닝 기록을 파일로 내려받고 데이터 관리 화면으로 돌아간다.
// 기록이 없거나 읽기·파일 생성에 실패하면 파일을 만들지 않고 이 화면에 머문다. 이때 보여줄 안내 문구는 Figma에 없어 확정 전이다(docs/unconfirmed-copy.md).
export function DataExportPage() {
  const goBack = useMyBack(MY_ROUTES.data)
  const [format, setFormat] = useState<(typeof FORMATS)[number]>('CSV')
  const handleConfirm = () => {
    const result = exportRecords(format)
    if (result.status === 'ok' && downloadExportFile(result.file)) goBack()
  }
  return (
    <DeviceScreen title="데이터 내보내기" onBack={goBack} onConfirm={handleConfirm}>
      <p className="mt-4 text-[16px] leading-[22px]">러닝 날짜, 거리, 시간, 페이스를 내보내는 화면이에요.</p>
      <h3 id="export-format" className="mt-6 text-[18px] font-medium leading-[25px]">
        파일 형식
      </h3>
      <div role="group" aria-labelledby="export-format" className="mt-3 flex h-[44px] gap-3">
        {FORMATS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={format === value}
            onClick={() => setFormat(value)}
            className={`flex h-[44px] flex-1 cursor-pointer items-center justify-center rounded-full text-[14px] font-medium leading-5 text-ink ${format === value ? 'bg-lime' : 'bg-soft'}`}
          >
            {value}
          </button>
        ))}
      </div>
      <p className="mt-6 text-[14px] leading-[20px] text-muted">
        이 프로토타입에서는 실제 파일을 생성하지 않아요. 내보내기 형식과 흐름을 확인하는 화면이에요.
      </p>
    </DeviceScreen>
  )
}

export default DataExportPage
