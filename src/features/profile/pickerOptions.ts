// 휠 선택 시트(PickerSheet)가 쓰는 선택지와 값 표기. React에 의존하지 않는 순수 함수다.

// min부터 max까지 step 간격으로 오름차순 선택지를 만든다. (min, max 포함)
export function buildRange(min: number, max: number, step = 1): number[] {
  const values: number[] = []
  for (let value = min; value <= max; value += step) values.push(value)
  return values
}

// 시트를 처음 열 때 선택해 둘 값. 저장된(draft) 값이 선택지에 있으면 그 값, 없으면 fallback을 쓴다.
// fallback도 선택지에 없으면 첫 번째 선택지를 쓴다.
export function resolveInitialValue(saved: number | null, options: readonly number[], fallback: number): number {
  if (saved !== null && options.includes(saved)) return saved
  if (options.includes(fallback)) return fallback
  return options[0] ?? fallback
}

// 인덱스를 0 ~ length-1 안으로 맞춘다. 선택지가 비어 있으면 0이다.
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(index, 0), length - 1)
}

// 화면 행에 보여 줄 값 문자열. 값이 없으면(null) 줄표 하나다. 단위는 따로 붙인다.
export function formatValue(value: number | null): string {
  return value === null ? '—' : String(value)
}
