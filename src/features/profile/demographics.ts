import { buildRange } from './pickerOptions.ts'
import type { ProfileState } from './profileStore.ts'
import type { Gender, ProfileData } from './types.ts'
import { isValidBirthYear } from './validation.ts'

// 출생연도·성별 화면의 순수 로직. React와 profileStore 인스턴스에 의존하지 않는다.
// 화면은 선택 상태(DemographicsDraft)를 자체 상태로 들고 있다가, "다음"을 누를 때만 submitDemographics로 Store에 저장한다.

// 출생연도 선택 범위의 시작. 끝은 현재 연도이며 실행할 때마다 계산한다.
export const BIRTH_YEAR_MIN = 1900

// 저장된 출생연도가 없을 때 시트를 열면 임시로 선택해 두는 값. "완료"를 누르기 전에는 저장되거나 draft에 반영되지 않는다.
export const BIRTH_YEAR_DEFAULT = 2000

export function getCurrentYear(): number {
  return new Date().getFullYear()
}

// 시트에 보여 줄 연도. 최신 연도부터 내림차순이다. currentYear는 테스트에서 주입할 수 있다.
export function getBirthYearOptions(currentYear: number = getCurrentYear()): number[] {
  return buildRange(BIRTH_YEAR_MIN, currentYear).reverse()
}

// 선택 범위 안의 연도인가
export function isBirthYearInRange(year: number, currentYear: number = getCurrentYear()): boolean {
  return Number.isInteger(year) && year >= BIRTH_YEAR_MIN && year <= currentYear
}

export interface GenderOption {
  label: string
  value: Gender
}

// Figma 순서와 문구. "선택 안 함"은 null이다. (Store에서도 null이 미선택·건너뜀을 뜻한다.)
export const GENDER_OPTIONS: readonly GenderOption[] = [
  { label: '여성', value: 'female' },
  { label: '남성', value: 'male' },
  { label: '선택 안 함', value: null },
]

// 화면 안에서만 쓰는 임시 선택 상태. Store에는 "다음"을 누를 때 저장한다.
export interface DemographicsDraft {
  birthYear: number | null
  gender: Gender
}

// 이미 저장된 값이 있으면 그 값에서 시작한다. 선택 범위를 벗어난 출생연도는 미선택(null)으로 시작한다.
export function createDemographicsDraft(
  saved: Pick<ProfileData, 'birthYear' | 'gender'>,
  currentYear: number = getCurrentYear(),
): DemographicsDraft {
  const birthYear = saved.birthYear !== null && isBirthYearInRange(saved.birthYear, currentYear) ? saved.birthYear : null
  return { birthYear, gender: saved.gender }
}

// 저장에 필요한 Store 액션만 받는다. profileStore.getState()를 그대로 넘기거나 테스트용 가짜를 넘길 수 있다.
export type DemographicsWriter = Pick<ProfileState, 'setProfile'>

// "다음" 클릭 시 출생연도와 성별을 저장한다. 둘 다 선택하지 않은(null) 상태도 저장할 수 있다.
// 출생연도가 선택 범위를 벗어나면 아무것도 저장하지 않고 false를 돌려준다.
export function submitDemographics(
  writer: DemographicsWriter,
  draft: DemographicsDraft,
  currentYear: number = getCurrentYear(),
): boolean {
  if (!isValidBirthYear(draft.birthYear)) return false
  if (draft.birthYear !== null && !isBirthYearInRange(draft.birthYear, currentYear)) return false
  writer.setProfile({ birthYear: draft.birthYear, gender: draft.gender })
  return true
}
