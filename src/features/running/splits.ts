import type { DistanceSample, RunSplit } from './types.ts'

// 구간(split) 계산 (순수 함수): 1km 단위 구간 페이스와 마지막 잔여 구간.
// - 입력은 러닝 경과 시간(일시정지 제외)과 누적 거리 샘플이다. 1km 경계를 지나는 시각은 샘플 사이를 직선으로 보간한다.
// - TIME 모드는 거리를 기록하지 않으므로 샘플이 없고 구간도 없다.

const SPLIT_M = 1000
// 이 거리보다 짧은 마지막 잔여 구간은 페이스가 의미 없으므로 만들지 않는다.
export const MIN_REMAINDER_SPLIT_M = 10

// 거리가 줄었거나 시간이 거꾸로 간 샘플은 버린다(누적 거리는 줄어들지 않는다).
export function appendDistanceSample(samples: readonly DistanceSample[], sample: DistanceSample): DistanceSample[] {
  if (!Number.isFinite(sample.elapsedMs) || !Number.isFinite(sample.distanceM) || sample.distanceM < 0) {
    return [...samples]
  }
  const last = samples[samples.length - 1]
  if (last !== undefined && (sample.distanceM < last.distanceM || sample.elapsedMs < last.elapsedMs)) {
    return [...samples]
  }
  return [...samples, sample]
}

// 누적 거리가 distanceM(m)에 처음 도달한 러닝 시간(ms). 도달하지 않았으면 null
function timeAtDistance(samples: readonly DistanceSample[], distanceM: number): number | null {
  for (let i = 0; i < samples.length; i += 1) {
    const to = samples[i]
    if (to.distanceM < distanceM) continue
    const from = i === 0 ? { elapsedMs: 0, distanceM: 0 } : samples[i - 1]
    const span = to.distanceM - from.distanceM
    if (span <= 0) return to.elapsedMs
    const ratio = (distanceM - from.distanceM) / span
    return from.elapsedMs + ratio * (to.elapsedMs - from.elapsedMs)
  }
  return null
}

function toPace(distanceM: number, durationMs: number): number | null {
  if (!(distanceM > 0) || !(durationMs > 0)) return null
  return Math.round(durationMs / 1000 / (distanceM / 1000))
}

export function computeSplits(samples: readonly DistanceSample[]): RunSplit[] {
  const last = samples[samples.length - 1]
  if (last === undefined || !(last.distanceM > 0)) return []

  const splits: RunSplit[] = []
  const fullCount = Math.floor(last.distanceM / SPLIT_M)
  let previousAt = 0
  for (let i = 1; i <= fullCount; i += 1) {
    const at = timeAtDistance(samples, i * SPLIT_M)
    if (at === null) break
    const durationMs = Math.round(at - previousAt)
    splits.push({ index: i, distanceM: SPLIT_M, durationMs, paceSecPerKm: toPace(SPLIT_M, durationMs) })
    previousAt = at
  }

  const remainderM = last.distanceM - fullCount * SPLIT_M
  if (remainderM >= MIN_REMAINDER_SPLIT_M) {
    const durationMs = Math.round(last.elapsedMs - previousAt)
    splits.push({
      index: fullCount + 1,
      distanceM: Math.round(remainderM),
      durationMs,
      paceSecPerKm: toPace(remainderM, durationMs),
    })
  }
  return splits
}
