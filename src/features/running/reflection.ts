import type { ReflectionDifficulty, ReflectionReason, RunReflection } from './types.ts'

// 회고 값 검증 (순수 함수). 회고 시트 화면은 #47의 책임이다.

export const REFLECTION_MEMO_MAX = 100

export const REFLECTION_DIFFICULTIES: readonly ReflectionDifficulty[] = ['easy', 'moderate', 'hard']
export const REFLECTION_REASONS: readonly ReflectionReason[] = ['breath', 'legs', 'boredom', 'time']

export function isReflectionDifficulty(value: unknown): value is ReflectionDifficulty {
  return typeof value === 'string' && (REFLECTION_DIFFICULTIES as readonly string[]).includes(value)
}

export function isReflectionReason(value: unknown): value is ReflectionReason {
  return typeof value === 'string' && (REFLECTION_REASONS as readonly string[]).includes(value)
}

export function isValidReflection(value: unknown): value is RunReflection {
  if (typeof value !== 'object' || value === null) return false
  const reflection = value as Record<string, unknown>
  if (reflection.difficulty !== null && !isReflectionDifficulty(reflection.difficulty)) return false
  if (!Array.isArray(reflection.reasons) || !reflection.reasons.every(isReflectionReason)) return false
  if (new Set(reflection.reasons).size !== reflection.reasons.length) return false
  return typeof reflection.memo === 'string' && reflection.memo.length <= REFLECTION_MEMO_MAX
}
