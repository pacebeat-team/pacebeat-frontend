import { useStore } from 'zustand'
import { readSupabaseConfig } from './config.ts'
import { createAuthService } from './authService.ts'
import type { AuthState } from './authService.ts'
import { AUTH_STORAGE_KEY, createAuthStorage } from './storage.ts'

export type { AuthState, AuthStatus, SignInFailure, SignInResult } from './authService.ts'

// 앱의 인증 진입점. Supabase 설정이 없으면 status는 'disabled'이고 게스트 흐름(로컬 저장)만 동작한다. 화면은 아직 이것을 쓰지 않는다.
export const auth = createAuthService({ config: readSupabaseConfig(), storage: createAuthStorage() })

export function useAuthState<T>(selector: (state: AuthState) => T): T {
  return useStore(auth.store, selector)
}

// 앱 시작 시 한 번 호출한다: 저장된 세션 복구 + 다른 탭의 로그인·로그아웃 반영.
export function startAuth(): void {
  void auth.init()
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key === AUTH_STORAGE_KEY || event.key === null) auth.syncFromStorage()
    })
  }
}
