// Supabase Auth 설정. 값은 환경변수에서만 읽고 코드·문서에 넣지 않는다. 하나라도 없으면 null이다(= 인증 꺼짐, 게스트 흐름만 동작).
export interface SupabaseConfig {
  readonly url: string
  readonly anonKey: string
}

type EnvLike = { readonly VITE_SUPABASE_URL?: unknown; readonly VITE_SUPABASE_ANON_KEY?: unknown }

function cleanUrl(value: unknown): string | null {
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

export function readSupabaseConfig(env: EnvLike = (import.meta as { env?: EnvLike }).env ?? {}): SupabaseConfig | null {
  const url = cleanUrl(env.VITE_SUPABASE_URL)
  const anonKey = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : ''
  return url === null || anonKey === '' ? null : { url, anonKey }
}
