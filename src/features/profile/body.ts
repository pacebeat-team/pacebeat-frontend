import { buildRange } from './pickerOptions.ts'
import type { ProfileState } from './profileStore.ts'
import type { ProfileData } from './types.ts'
import { isValidHeightCm, isValidWeightKg } from './validation.ts'

// 키·몸무게 화면의 순수 로직. React와 profileStore 인스턴스에 의존하지 않는다.
// 화면은 선택 상태(BodyDraft)를 자체 상태로 들고 있다가, "시작하기"를 누를 때만 submitBody로 Store에 저장한다.

// 범위는 1단위 정수이며, 이 파일에서만 정한다. (validation.ts의 검증 정책은 바꾸지 않는다.)
export const HEIGHT_MIN_CM = 100
export const HEIGHT_MAX_CM = 220
export const WEIGHT_MIN_KG = 20
export const WEIGHT_MAX_KG = 200

// 저장된 값이 없을 때 시트를 열면 임시로 선택해 두는 값. "완료"를 누르기 전에는 저장되거나 draft에 반영되지 않는다.
export const HEIGHT_DEFAULT_CM = 165
export const WEIGHT_DEFAULT_KG = 60

// 시트에 보여 줄 값. 위에서 아래로 오름차순이다.
export const HEIGHT_OPTIONS: readonly number[] = buildRange(HEIGHT_MIN_CM, HEIGHT_MAX_CM)
export const WEIGHT_OPTIONS: readonly number[] = buildRange(WEIGHT_MIN_KG, WEIGHT_MAX_KG)

export function isHeightInRange(value: number): boolean {
  return Number.isInteger(value) && value >= HEIGHT_MIN_CM && value <= HEIGHT_MAX_CM
}

export function isWeightInRange(value: number): boolean {
  return Number.isInteger(value) && value >= WEIGHT_MIN_KG && value <= WEIGHT_MAX_KG
}

// 화면 안에서만 쓰는 임시 선택 상태. null은 아직 고르지 않은 상태다.
export interface BodyDraft {
  heightCm: number | null
  weightKg: number | null
}

// 이미 저장된 값이 있으면 그 값에서 시작한다. 선택 범위를 벗어난 값(소수 포함)은 미선택(null)으로 시작한다.
export function createBodyDraft(saved: Pick<ProfileData, 'heightCm' | 'weightKg'>): BodyDraft {
  return {
    heightCm: saved.heightCm !== null && isHeightInRange(saved.heightCm) ? saved.heightCm : null,
    weightKg: saved.weightKg !== null && isWeightInRange(saved.weightKg) ? saved.weightKg : null,
  }
}

// 저장에 필요한 Store 액션만 받는다. profileStore.getState()를 그대로 넘기거나 테스트용 가짜를 넘길 수 있다.
export type BodyWriter = Pick<ProfileState, 'setProfile'>

// "시작하기" 클릭 시 키와 몸무게를 저장한다. 둘 다 선택하지 않은(null) 상태도 저장할 수 있다.
// 값이 선택 범위를 벗어나면 아무것도 저장하지 않고 false를 돌려준다.
export function submitBody(writer: BodyWriter, draft: BodyDraft): boolean {
  const { heightCm, weightKg } = draft
  if (!isValidHeightCm(heightCm) || (heightCm !== null && !isHeightInRange(heightCm))) return false
  if (!isValidWeightKg(weightKg) || (weightKg !== null && !isWeightInRange(weightKg))) return false
  writer.setProfile({ heightCm, weightKg })
  return true
}
