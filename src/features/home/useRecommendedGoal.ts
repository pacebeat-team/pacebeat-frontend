import { useMemo, useState } from 'react'
import { computeBaselinePace } from '../measurement/baseline.ts'
import { getMetrics } from '../measurement/metrics.ts'
import { calculateRecommended3KmGoal } from '../running/recommendationPolicy.ts'
import type { Recommended3KmGoal } from '../running/recommendationPolicy.ts'
import { createRunStorage } from '../running/runStorage.ts'
import { measurementStore, useMeasurementStore } from '../../stores/measurementStore.ts'
import { useOnboardingStore } from '../../stores/onboardingStore.ts'

const REMOTE_BASELINE_PACE_KEY = 'pacebeat:sync:baseline-pace:v1'

function readSyncedBaselinePace(): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(REMOTE_BASELINE_PACE_KEY) ?? null
    if (raw === null) return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  } catch {
    return null
  }
}

// 앱 계층(features/home)에서 온보딩·기초 측정·저장된 러닝 기록을 모아 P!PACE 4단계 추천 목표를 계산한다.
// (features/running 내부는 기초 측정/온보딩 Store를 직접 가져오지 않는 경계 규칙을 지킨다.)
export function resolveCurrentBaselinePaceSec(): number | null {
  const { session, metrics, now } = measurementStore.getState()
  if (session !== null) {
    const localPace = computeBaselinePace(getMetrics(metrics, session, now))
    if (localPace !== null && localPace > 0) return localPace
  }
  return readSyncedBaselinePace()
}

export function useRecommended3KmGoal(nowMs?: number): Recommended3KmGoal {
  const [mountNowMs] = useState(() => Date.now())
  const effectiveNowMs = nowMs ?? mountNowMs
  const experienceLevel = useOnboardingStore((state) => state.experienceLevel)
  const weeklyRuns = useOnboardingStore((state) => state.weeklyRuns)
  const baselineCompleted = useOnboardingStore((state) => state.baselineMeasurementCompleted)
  const session = useMeasurementStore((state) => state.session)
  const metrics = useMeasurementStore((state) => state.metrics)
  const measurementNow = useMeasurementStore((state) => state.now)

  return useMemo(() => {
    let baselinePaceSecPerKm: number | null = null
    if (session !== null) {
      baselinePaceSecPerKm = computeBaselinePace(getMetrics(metrics, session, session.endedAt ?? measurementNow))
    }
    if (baselinePaceSecPerKm === null && baselineCompleted) {
      baselinePaceSecPerKm = readSyncedBaselinePace()
    }
    const records = (() => {
      try {
        return createRunStorage().loadRecords()
      } catch {
        return []
      }
    })()

    return calculateRecommended3KmGoal({
      experienceLevel,
      weeklyRuns,
      baselinePaceSecPerKm,
      records,
      nowMs: effectiveNowMs,
    })
  }, [experienceLevel, weeklyRuns, baselineCompleted, session, metrics, measurementNow, effectiveNowMs])
}
