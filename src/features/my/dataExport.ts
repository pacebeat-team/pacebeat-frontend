import { createRunStorage } from '../running/runStorage.ts'
import type { RecordsReadResult, RunKeyValueStorage } from '../running/runStorage.ts'
import type { RunRecord } from '../running/types.ts'

// 내 데이터 내보내기: 이 기기에 실제로 저장된 러닝 기록만 파일로 만든다.
// - 대상은 완료·저장된 러닝 기록(pacebeat:run:records:v1)뿐이다. 예시 데이터, 진행 중 세션, 목표 draft, 프로필은 넣지 않는다.
// - 인솔(센서) 자세 요약(sensorReport)은 내보내지 않는다(정책 C). 현재는 SDK가 없어 값도 항상 null이다. 있는 것처럼 비워 두지도 않는다.
// - 측정하지 못한 값은 0이 아니라 비운다(CSV 빈 칸, JSON null). 페이스는 sec/km 정수.
// - 읽을 수 없는 항목은 건너뛴다. 저장소를 읽을 수 없는 경우(unavailable·unreadable)와 기록이 없는 경우(empty)를 구분한다.

export type ExportFormat = 'CSV' | 'JSON'

export interface ExportRow {
  readonly recordId: string
  // 러닝 시작 시각(ISO 8601, UTC)
  readonly date: string
  readonly mode: 'gps' | 'time'
  readonly distanceKm: number | null
  readonly durationSec: number
  readonly paceSecPerKm: number | null
}

export interface ExportFile {
  readonly filename: string
  readonly mimeType: string
  readonly content: string
  readonly recordCount: number
}

export type ExportResult =
  | { readonly status: 'ok'; readonly file: ExportFile }
  | { readonly status: 'empty' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'unreadable' }

export const CSV_HEADER = ['recordId', 'date', 'mode', 'distanceKm', 'durationSec', 'paceSecPerKm'] as const

export function toExportRow(record: RunRecord): ExportRow {
  const { distanceM, elapsedMs, avgPaceSecPerKm } = record.result
  return {
    recordId: record.recordId,
    date: new Date(record.startedAt).toISOString(),
    mode: record.mode,
    distanceKm: distanceM === null ? null : distanceM / 1000,
    durationSec: Math.round(elapsedMs / 1000),
    paceSecPerKm: avgPaceSecPerKm,
  }
}

function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function dateStamp(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function buildExportFile(records: readonly RunRecord[], format: ExportFormat, now: number): ExportFile {
  const rows = records.map(toExportRow)
  if (format === 'JSON') {
    const body = { exportedAt: new Date(now).toISOString(), records: rows }
    return {
      filename: `pacebeat-records-${dateStamp(now)}.json`,
      mimeType: 'application/json',
      content: `${JSON.stringify(body, null, 2)}\n`,
      recordCount: rows.length,
    }
  }
  const lines = [CSV_HEADER.join(',')]
  for (const row of rows) {
    lines.push(CSV_HEADER.map((key) => csvCell(row[key])).join(','))
  }
  return {
    filename: `pacebeat-records-${dateStamp(now)}.csv`,
    mimeType: 'text/csv',
    content: `${lines.join('\r\n')}\r\n`,
    recordCount: rows.length,
  }
}

export interface ExportDeps {
  // 기본은 브라우저 localStorage
  readonly readRecords?: () => RecordsReadResult
  readonly storage?: RunKeyValueStorage | null
  readonly now?: () => number
}

export function exportRecords(format: ExportFormat, deps: ExportDeps = {}): ExportResult {
  const read = deps.readRecords ?? (() => (deps.storage === undefined ? createRunStorage() : createRunStorage(deps.storage)).readRecords())
  let result: RecordsReadResult
  try {
    result = read()
  } catch {
    return { status: 'unreadable' }
  }
  if (!result.ok) return { status: result.reason }
  if (result.records.length === 0) return { status: 'empty' }
  return { status: 'ok', file: buildExportFile(result.records, format, (deps.now ?? Date.now)()) }
}

// 브라우저에서 파일을 내려받는다. 파일을 만들거나 내려받는 데 실패하면 false.
export interface DownloadEnv {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
  createAnchor: () => { href: string; download: string; click: () => void }
}

function browserEnv(): DownloadEnv {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement('a'),
  }
}

export function downloadExportFile(file: ExportFile, env: DownloadEnv = browserEnv()): boolean {
  let url: string | null = null
  try {
    url = env.createObjectURL(new Blob([file.content], { type: `${file.mimeType};charset=utf-8` }))
    const anchor = env.createAnchor()
    anchor.href = url
    anchor.download = file.filename
    anchor.click()
    return true
  } catch {
    return false
  } finally {
    if (url !== null) {
      try {
        env.revokeObjectURL(url)
      } catch {
        // 무시한다.
      }
    }
  }
}
