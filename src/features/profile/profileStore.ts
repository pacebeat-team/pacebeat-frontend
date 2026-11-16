import { useStore } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'
import { createStore } from 'zustand/vanilla'
import { normalizeNickname } from './validation.ts'
import type { ConsentData, ConsentKey, ProfileData } from './types.ts'

export const PROFILE_STORAGE_KEY = 'pacebeat-profile'

export interface ProfileStateData {
  profile: ProfileData
  consent: ConsentData
}

interface ProfileActions {
  // 일부 필드만 바꾼다. 닉네임은 앞뒤 공백을 제거해 저장한다.
  setProfile: (patch: Partial<ProfileData>) => void
  // 동의 항목(필수 4개와 선택 1개)만 바꾼다. 버전과 시각은 recordConsent로 기록한다.
  setConsent: (patch: Partial<Record<ConsentKey, boolean>>) => void
  // 동의 시점의 약관 버전과 시각을 기록한다. 약관 버전이 확정되기 전에는 null을 넘겨도 시각은 기록된다.
  recordConsent: (policyVersion: string | null, now?: number) => void
  // 프로필과 동의를 모두 초기화한다.
  reset: () => void
}

export type ProfileState = ProfileStateData & ProfileActions

function createInitialData(): ProfileStateData {
  return {
    profile: { nickname: '', birthYear: null, gender: null, heightCm: null, weightKg: null },
    consent: {
      ageOver14: false,
      termsOfService: false,
      privacyPolicy: false,
      locationTerms: false,
      marketing: false,
      policyVersion: null,
      consentedAt: null,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getBrowserStorage(): StateStorage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // 저장소 접근이 막힌 환경(비공개 모드 등)
  }
}

// 저장소를 쓸 수 없을 때 쓰는 메모리 저장소. 새로고침하면 사라진다.
function createMemoryStorage(): StateStorage {
  const map = new Map<string, string>()
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value)
    },
    removeItem: (name) => {
      map.delete(name)
    },
  }
}

// storage를 주입하면 테스트에서 가짜 저장소를 쓸 수 있다. 생략하면 브라우저 localStorage를 쓴다.
export function createProfileStore(storage?: StateStorage) {
  const resolved = storage ?? getBrowserStorage() ?? createMemoryStorage()

  return createStore<ProfileState>()(
    persist(
      (set) => ({
        ...createInitialData(),
        setProfile: (patch) =>
          set((state) => ({
            profile: {
              ...state.profile,
              ...patch,
              ...(patch.nickname === undefined ? {} : { nickname: normalizeNickname(patch.nickname) }),
            },
          })),
        setConsent: (patch) => set((state) => ({ consent: { ...state.consent, ...patch } })),
        recordConsent: (policyVersion, now = Date.now()) =>
          set((state) => ({ consent: { ...state.consent, policyVersion, consentedAt: now } })),
        reset: () => set(createInitialData()),
      }),
      {
        name: PROFILE_STORAGE_KEY,
        storage: createJSONStorage(() => resolved),
        partialize: (state): ProfileStateData => ({ profile: state.profile, consent: state.consent }),
        // 저장된 값에 빠진 필드가 있어도 기본값으로 채운다. profile과 consent를 각각 합친다.
        merge: (persisted, current) => {
          const saved = isRecord(persisted) ? persisted : {}
          return {
            ...current,
            profile: { ...current.profile, ...(isRecord(saved.profile) ? saved.profile : {}) },
            consent: { ...current.consent, ...(isRecord(saved.consent) ? saved.consent : {}) },
          }
        },
      },
    ),
  )
}

export const profileStore = createProfileStore()

export function useProfileStore<T>(selector: (state: ProfileState) => T): T {
  return useStore(profileStore, selector)
}
