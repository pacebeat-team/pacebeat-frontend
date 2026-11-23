// 인증 세션 저장. 키는 버전을 붙여 다른 앱 데이터와 분리한다. 저장소를 쓸 수 없거나 값이 손상됐으면 "세션 없음"으로 본다(예외를 밖으로 내지 않는다).
// 주의: 토큰은 브라우저 저장소(localStorage)에 평문으로 남는다(supabase-js 기본 방식과 같은 위험). 로그에는 절대 출력하지 않는다.
export interface AuthSession {
  readonly accessToken: string
  readonly refreshToken: string
  // 액세스 토큰 만료 시각(epoch ms)
  readonly expiresAt: number
}

export interface AuthStorage {
  load(): AuthSession | null
  save(session: AuthSession): void
  clear(): void
}

export const AUTH_STORAGE_KEY = 'pacebeat:auth:session:v1'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.accessToken === 'string' &&
    v.accessToken !== '' &&
    typeof v.refreshToken === 'string' &&
    v.refreshToken !== '' &&
    typeof v.expiresAt === 'number' &&
    Number.isFinite(v.expiresAt)
  )
}

export function createAuthStorage(kv: KeyValueStorage | null = browserStorage()): AuthStorage {
  return {
    load() {
      if (kv === null) return null
      try {
        const raw = kv.getItem(AUTH_STORAGE_KEY)
        if (raw === null) return null
        const parsed: unknown = JSON.parse(raw)
        const data = typeof parsed === 'object' && parsed !== null ? (parsed as { version?: unknown; data?: unknown }) : null
        if (data === null || data.version !== 1 || !isAuthSession(data.data)) return null
        const { accessToken, refreshToken, expiresAt } = data.data
        return { accessToken, refreshToken, expiresAt }
      } catch {
        return null
      }
    },
    save(session) {
      try {
        kv?.setItem(AUTH_STORAGE_KEY, JSON.stringify({ version: 1, data: session }))
      } catch {
        // 저장 실패는 무시한다(이번 실행 동안은 메모리 세션으로 동작).
      }
    },
    clear() {
      try {
        kv?.removeItem(AUTH_STORAGE_KEY)
      } catch {
        // 무시
      }
    },
  }
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
