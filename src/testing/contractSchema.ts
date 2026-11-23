import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 계약 테스트 공용: 저장해 둔 OpenAPI 스냅샷(src/lib/api/openapi.snapshot.json)으로 값을 검사하는 최소 JSON Schema 검사기.
// 테스트 전용 모듈이다(앱 코드에서 가져오지 않는다).
// ---------------------------------------------------------------------------
// 최소 JSON Schema 검사기(이 스냅샷이 쓰는 키워드만): $ref, anyOf, type, enum, 범위, 길이, pattern, required, items, properties
// ---------------------------------------------------------------------------
export type Schema = Record<string, unknown>
export const spec = JSON.parse(readFileSync(new URL('../lib/api/openapi.snapshot.json', import.meta.url), 'utf8')) as {
  components: { schemas: Record<string, Schema> }
}

function resolve(schema: Schema): Schema {
  const ref = schema.$ref
  if (typeof ref !== 'string') return schema
  const name = ref.replace('#/components/schemas/', '')
  const target = spec.components.schemas[name]
  assert.ok(target, `스냅샷에 ${name} 스키마가 없다`)
  return target
}

export function validate(value: unknown, schemaIn: Schema, path = '$'): string[] {
  const schema = resolve(schemaIn)
  if (Array.isArray(schema.anyOf)) {
    const attempts = (schema.anyOf as Schema[]).map((s) => validate(value, s, path))
    return attempts.some((a) => a.length === 0) ? [] : [`${path}: anyOf 불일치 (${attempts.map((a) => a[0]).join(' | ')})`]
  }
  const errors: string[] = []
  const type = schema.type
  if (type === 'null') return value === null ? [] : [`${path}: null이어야 한다`]
  if (value === null || value === undefined) return [`${path}: ${value === null ? 'null' : 'undefined'} 불가`]
  if (type === 'string') {
    if (typeof value !== 'string') return [`${path}: 문자열이어야 한다`]
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${path}: 길이 < ${schema.minLength}`)
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path}: 길이 > ${schema.maxLength}`)
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern 불일치`)
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push(`${path}: date-time 아님`)
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path}: enum 밖의 값 ${value}`)
    return errors
  }
  if (type === 'integer' || type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path}: 숫자여야 한다`]
    if (type === 'integer' && !Number.isInteger(value)) errors.push(`${path}: 정수여야 한다`)
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: ${value} < ${schema.minimum}`)
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path}: ${value} > ${schema.maximum}`)
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) errors.push(`${path}: ${value} <= ${schema.exclusiveMinimum} (초과여야 함)`)
    return errors
  }
  if (type === 'boolean') return typeof value === 'boolean' ? [] : [`${path}: 불리언이어야 한다`]
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${path}: 배열이어야 한다`]
    const items = schema.items as Schema | undefined
    if (items !== undefined) value.forEach((v, i) => errors.push(...validate(v, items, `${path}[${i}]`)))
    return errors
  }
  if (type === 'object' || schema.properties !== undefined) {
    if (typeof value !== 'object' || Array.isArray(value)) return [`${path}: 객체여야 한다`]
    const props = (schema.properties ?? {}) as Record<string, Schema>
    const obj = value as Record<string, unknown>
    for (const key of (schema.required ?? []) as string[]) if (!(key in obj) || obj[key] === undefined) errors.push(`${path}.${key}: 필수 필드 누락`)
    for (const [key, v] of Object.entries(obj)) {
      if (v === undefined) continue // JSON으로 직렬화되면 생략된다
      if (!(key in props)) errors.push(`${path}.${key}: 스키마에 없는 필드`)
      else errors.push(...validate(v, props[key], `${path}.${key}`))
    }
    return errors
  }
  if (Array.isArray(schema.enum)) return schema.enum.includes(value) ? [] : [`${path}: enum 밖의 값`]
  return errors
}

// enum 스키마는 type 없이 enum+type string으로 나온다. 위 string 분기에서 처리된다.
export const schemaOf = (name: string): Schema => {
  const s = spec.components.schemas[name]
  assert.ok(s, name)
  return s
}
export const check = (name: string, body: unknown) => validate(body, schemaOf(name))
// JSON으로 직렬화했을 때 서버가 받는 모습(undefined 필드 제거).
export const wire = <T>(body: T): T => JSON.parse(JSON.stringify(body)) as T
