// API 연결 설정. 값은 환경변수(VITE_API_BASE_URL)에서만 읽고 코드에 주소를 넣지 않는다.
// 설정이 없으면 null이다(= 서버 연동 꺼짐). 이 경우 앱은 기존 로컬 저장 방식으로만 동작한다.
export interface ApiConfig {
  readonly baseUrl: string
}

type EnvLike = { readonly VITE_API_BASE_URL?: unknown }

// 끝의 슬래시를 정리한 http(s) 주소만 받는다. 그 밖의 값은 설정이 없는 것으로 본다.
export function parseApiBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\/+$/, '')
  if (trimmed === '') return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:' ? trimmed : null
  } catch {
    return null
  }
}

export function readApiConfig(env: EnvLike = (import.meta as { env?: EnvLike }).env ?? {}): ApiConfig | null {
  const baseUrl = parseApiBaseUrl(env.VITE_API_BASE_URL)
  return baseUrl === null ? null : { baseUrl }
}
