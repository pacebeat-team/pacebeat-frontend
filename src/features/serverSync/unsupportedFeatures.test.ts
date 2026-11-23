import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, test } from 'node:test'
import { spec } from '../../testing/contractSchema.ts'
import { createDeleteAction } from '../my/deleteAction.ts'
import { deleteRunRecords } from '../my/dataDelete.ts'
import { exportRecords } from '../my/dataExport.ts'
import type { RunRecord } from '../running/types.ts'
import { RUN_STORAGE_KEYS } from '../running/runStorage.ts'
import { IMPORT_LEDGER_KEY } from './recordImport.ts'
import { RUN_SYNC_QUEUE_KEY } from './runSyncQueue.ts'
import { SYNC_PENDING_KEY } from './syncRuntime.ts'

// 백엔드가 지원하지 않거나 범위가 다른 기능을 "있는 것처럼" 쓰지 않는지 고정하는 테스트. 가짜 저장소만 쓰며 서버에는 요청하지 않는다.
// 서버 사실(백엔드 코드를 읽은 결과): DELETE /users/me는 run_sessions·insole_devices·user_baselines·user_profiles 행만 지우고 Supabase Auth 사용자는 남긴다.
// 개별 러닝 삭제 API는 없다. data-export는 JSON 객체이며 run_splits가 빠져 있다.

const SRC = new URL('../../', import.meta.url).pathname
function appSources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push({ rel: relative(SRC, full).split('\\').join('/'), text: readFileSync(full, 'utf8') })
    }
  }
  walk(SRC)
  return out.filter((f) => !f.rel.startsWith('testing/'))
}

describe('서버 미지원 기능이 화면·동기화에 연결되지 않았다', () => {
  test('계정 삭제(deleteMe)와 서버 내보내기(exportData)는 API 정의 외 어디에서도 호출되지 않는다', () => {
    const users = appSources().filter((f) => f.rel !== 'lib/api/endpoints.ts' && /\b(deleteMe|exportData)\b/.test(f.text)).map((f) => f.rel)
    assert.deepEqual(users, [])
  })
  test('화면 문구에 "회원 탈퇴"·"계정 삭제"가 없다(서버가 Auth 사용자를 지우지 않으므로 탈퇴 완료로 오해시키지 않는다)', () => {
    const offenders = appSources().filter((f) => f.rel.startsWith('pages/') && /회원\s*탈퇴|탈퇴|계정\s*삭제/.test(f.text)).map((f) => f.rel)
    assert.deepEqual(offenders, [])
  })
  test('개별 러닝 삭제 API는 OpenAPI에 없다(/runs/{run_id}는 GET뿐이고 DELETE가 없다)', () => {
    const paths = (spec as unknown as { paths: Record<string, Record<string, unknown>> }).paths
    assert.deepEqual(Object.keys(paths['/api/v1/runs/{run_id}']), ['get'])
    assert.deepEqual(Object.keys(paths['/api/v1/runs']).sort(), ['get', 'post'])
  })
  test('서버 DELETE /users/me의 응답은 204 본문 없음이며 "탈퇴"를 나타내는 필드가 없다(스냅샷)', () => {
    const paths = (spec as unknown as { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> }).paths
    assert.deepEqual(Object.keys(paths['/api/v1/users/me'].delete.responses), ['204'])
  })
  test('서버 data-export 응답 스키마는 필드를 정의하지 않는다(내용을 가정해 로컬 내보내기에 쓰지 않는다. 정의되면 이 테스트가 알려 준다)', () => {
    const paths = (spec as unknown as { paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: Record<string, unknown> }> }> }>> }).paths
    const schema = paths['/api/v1/users/me/data-export'].post.responses['200'].content['application/json'].schema
    assert.equal('properties' in schema, false)
  })
})

describe('로컬 삭제·내보내기는 이 기기 저장소만 다룬다', () => {
  test('로컬 삭제·내보내기 모듈은 API·인증·서버 동기화 모듈을 가져오지 않는다', () => {
    const files = ['features/my/dataDelete.ts', 'features/my/deleteAction.ts', 'features/my/dataExport.ts']
    const sources = appSources()
    for (const f of files) {
      const text = sources.find((s) => s.rel === f)?.text
      assert.ok(text !== undefined, f)
      assert.equal(/from\s+['"][^'"]*(lib\/api|lib\/auth|serverSync)/.test(text), false, f)
    }
  })
  test('로컬 기록 삭제는 서버 동기화 상태(저장 대기열·장부·대기 작업)를 건드리지 않는다 — 보내지 못한 기록이나 재유입 방지 장부를 잃지 않는다', () => {
    const map = new Map<string, string>([
      [RUN_STORAGE_KEYS.records, JSON.stringify({ version: 1, data: [] })],
      [RUN_SYNC_QUEUE_KEY, '{"version":2,"owners":{}}'],
      [IMPORT_LEDGER_KEY, '{"version":1,"ids":["x"]}'],
      [SYNC_PENDING_KEY, '{"version":2,"owners":{}}'],
    ])
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) }
    const result = deleteRunRecords(storage)
    assert.notEqual(result.status, 'failed')
    assert.equal(map.has(RUN_STORAGE_KEYS.records), false)
    for (const key of [RUN_SYNC_QUEUE_KEY, IMPORT_LEDGER_KEY, SYNC_PENDING_KEY]) assert.equal(map.has(key), true, key)
  })
  test('삭제 결과에는 서버 삭제를 뜻하는 상태가 없고, 저장소 실패는 성공처럼 보이지 않는다', () => {
    let left = 0
    const failing = { getItem: () => '{"version":1,"data":[]}', setItem: () => undefined, removeItem: () => { throw new Error('x') } }
    const action = createDeleteAction({ storage: failing, leave: () => void (left += 1) })
    assert.equal(action.confirm().status, 'failed')
    assert.equal(left, 0)
  })
  test('로컬 내보내기는 저장소의 기록만 읽는다: 서버 응답을 받는 인자가 없고, 내용은 로컬 기록 6개 열로 고정이다(서버 data-export에서 빠진 구간 기록 유무와 무관)', () => {
    const none = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
    assert.equal(exportRecords('JSON', { storage: none }).status, 'empty')
    const record = {
      recordId: 'rec-s1', sessionId: 's1', mode: 'gps', startedAt: Date.UTC(2026, 10, 20, 9), endedAt: Date.UTC(2026, 10, 20, 10),
      goal: { targetDistanceKm: 5, targetDurationSec: 1800 }, musicTrackId: null, reflection: null, sensorReport: null,
      result: { elapsedMs: 3_600_000, distanceM: 5000, avgPaceSecPerKm: 360, completion: 'goal', splits: [{ index: 1, distanceM: 1000, durationMs: 360_000, paceSecPerKm: 360 }], gpsGaps: [] },
    } as unknown as RunRecord
    const out = exportRecords('CSV', { readRecords: () => ({ ok: true, records: [record], skipped: 0 }) as never, now: () => 1 })
    assert.equal(out.status, 'ok')
    if (out.status === 'ok') {
      assert.equal(out.file.content.split(/\r?\n/)[0], 'recordId,date,mode,distanceKm,durationSec,paceSecPerKm')
      assert.equal(out.file.recordCount, 1)
    }
  })
})
