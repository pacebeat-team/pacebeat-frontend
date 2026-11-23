// 러닝 기록 하나에 붙는 "최종 자세 요약" (앱이 정한 정규화 모델).
//
// 중요: 이것은 SDK 계약이 아니다. SDK 계약(필드명·단위·구역 정의·좌우 판정 규칙)은 아직 정해지지 않았다.
// 이 모델은 "나중에 SDK 어댑터가 만들어 줘야 하는 앱 쪽 입력 형태"일 뿐이며, 화면과 집계는 이 모델에만 의존한다.
// SDK가 확정되면 SDK 응답 → PostureSummary 변환(어댑터)만 새로 쓰면 된다. 지금은 그 어댑터가 없어서 어떤 기록에도 값이 채워지지 않는다.
//
// 정책: 요약만 저장한다(원시 샘플·스트림은 저장하지 않는다). 값이 손상됐으면 이 요약만 버리고 러닝 기록은 보존한다. 잘못된 값을 0으로 바꾸지 않는다.
// 모델이 가정하는 것(Figma 화면에서 필요한 것만, 단위는 퍼센트):
// - measuredSide: 어느 쪽이 측정됐는가. both가 아니면 좌우 비교를 할 수 없다.
// - balance: 좌우 비율(%). 양쪽이 측정된 경우에만 있다.
// - pressure: 착지 압력 3구역 비율(%). Figma의 뒤꿈치·중간·앞꿈치 기준이고 합이 100이다.

export type PostureSide = 'both' | 'left' | 'right'

export interface PostureBalance {
  readonly left: number
  readonly right: number
}

export interface PosturePressure {
  readonly heel: number
  readonly mid: number
  readonly forefoot: number
}

export interface PostureSummary {
  readonly measuredSide: PostureSide
  // 양쪽이 모두 측정된 경우에만 값이 있다. 한쪽만 측정되면 null이다.
  readonly balance: PostureBalance | null
  // 측정하지 못했으면 null이다(0으로 채우지 않는다).
  readonly pressure: PosturePressure | null
}

// 비율 합이 100에서 벗어나도 되는 오차(반올림된 값을 받을 수 있게)
const SUM_TOLERANCE = 0.5

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isPercent = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
const sumsToHundred = (values: readonly number[]) => Math.abs(values.reduce((total, value) => total + value, 0) - 100) <= SUM_TOLERANCE

function parseBalance(value: unknown): PostureBalance | null {
  if (!isObject(value) || !isPercent(value.left) || !isPercent(value.right)) return null
  return sumsToHundred([value.left, value.right]) ? { left: value.left, right: value.right } : null
}

function parsePressure(value: unknown): PosturePressure | null {
  if (!isObject(value) || !isPercent(value.heel) || !isPercent(value.mid) || !isPercent(value.forefoot)) return null
  return sumsToHundred([value.heel, value.mid, value.forefoot]) ? { heel: value.heel, mid: value.mid, forefoot: value.forefoot } : null
}

// 저장된 값을 요약으로 해석한다. 하나라도 어긋나면 null(요약 전체 폐기)이다. 허용하지 않은 필드는 버린다(새 객체로 만든다).
export function parsePostureSummary(value: unknown): PostureSummary | null {
  if (!isObject(value)) return null
  const side = value.measuredSide
  if (side !== 'both' && side !== 'left' && side !== 'right') return null

  const balance = value.balance === null ? null : parseBalance(value.balance)
  if (value.balance !== null && balance === null) return null
  const pressure = value.pressure === null ? null : parsePressure(value.pressure)
  if (value.pressure !== null && pressure === null) return null

  // 양쪽 측정이면 좌우 비율이 있어야 하고, 한쪽만 측정이면 좌우 비율이 없어야 한다.
  if (side === 'both' ? balance === null : balance !== null) return null
  return { measuredSide: side, balance, pressure }
}

// 기록을 읽을 때 쓰는 보정: 유효하지 않으면(누락·손상 포함) null이다. 러닝 기록 자체는 이 결과와 무관하게 보존한다.
export function normalizeSensorReport(value: unknown): PostureSummary | null {
  return value === null || value === undefined ? null : parsePostureSummary(value)
}
