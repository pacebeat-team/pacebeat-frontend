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

// 저장소 쓰기·삭제가 실패해도 예외를 던지지 않는다. (용량 초과 등) 메모리 상태는 그대로 유지되고 저장만 건너뛴다.
// 읽기 실패는 persist가 이미 처리해 초기 상태로 시작한다.
function withSafeWrites(storage: StateStorage): StateStorage {
  function guard(run: () => unknown): unknown {
    try {
      const result = run()
      if (result instanceof Promise) return result.catch(() => undefined)
    } catch {
      // 저장 실패는 무시한다.
    }
  }
  return {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => guard(() => storage.setItem(name, value)),
    removeItem: (name) => guard(() => storage.removeItem(name)),
  }
}

// 값이 undefined인 필드를 뺀다. undefined를 넘겨도 기존 값은 유지된다. (미입력은 null로 표현한다.)
function withoutUndefined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>
}

type FieldCheck = (value: unknown) => boolean

const isNumberOrNull: FieldCheck = (value) => value === null || typeof value === 'number'
const isStringOrNull: FieldCheck = (value) => value === null || typeof value === 'string'
const isBoolean: FieldCheck = (value) => typeof value === 'boolean'

// 저장된 값의 필드별 타입 검사. 맞지 않는 필드는 기본값으로 되돌린다.
const PROFILE_FIELD_CHECKS: Record<keyof ProfileData, FieldCheck> = {
  nickname: (value) => typeof value === 'string',
  birthYear: isNumberOrNull,
  gender: (value) => value === null || value === 'female' || value === 'male',
  heightCm: isNumberOrNull,
  weightKg: isNumberOrNull,
}

const CONSENT_FIELD_CHECKS: Record<keyof ConsentData, FieldCheck> = {
  ageOver14: isBoolean,
  termsOfService: isBoolean,
  privacyPolicy: isBoolean,
  locationTerms: isBoolean,
  marketing: isBoolean,
  policyVersion: isStringOrNull,
  consentedAt: isNumberOrNull,
}

// 기본값 위에 저장된 값을 얹는다. 빠졌거나 타입이 맞지 않는 필드는 기본값을 쓰고, 맞는 필드는 그대로 둔다.
function restoreFields<T extends object>(defaults: T, saved: unknown, checks: Record<keyof T, FieldCheck>): T {
  if (!isRecord(saved)) return defaults
  const restored = { ...defaults }
  for (const key of Object.keys(checks) as (keyof T)[]) {
    const value = saved[key as string]
    if (checks[key](value)) restored[key] = value as T[keyof T]
  }
  return restored
}

// storage를 주입하면 테스트에서 가짜 저장소를 쓸 수 있다. 생략하면 브라우저 localStorage를 쓴다.
export function createProfileStore(storage?: StateStorage) {
  const resolved = withSafeWrites(storage ?? getBrowserStorage() ?? createMemoryStorage())

  return createStore<ProfileState>()(
    persist(
      (set) => ({
        ...createInitialData(),
        setProfile: (patch) =>
          set((state) => {
            const changes = withoutUndefined(patch)
            return {
              profile: {
                ...state.profile,
                ...changes,
                ...(changes.nickname === undefined ? {} : { nickname: normalizeNickname(changes.nickname) }),
              },
            }
          }),
        setConsent: (patch) =>
          set((state) => ({ consent: { ...state.consent, ...withoutUndefined(patch) } })),
        recordConsent: (policyVersion, now = Date.now()) =>
          set((state) => ({ consent: { ...state.consent, policyVersion, consentedAt: now } })),
        reset: () => set(createInitialData()),
      }),
      {
        name: PROFILE_STORAGE_KEY,
        storage: createJSONStorage(() => resolved),
        partialize: (state): ProfileStateData => ({ profile: state.profile, consent: state.consent }),
        // 저장된 값에 빠졌거나 타입이 맞지 않는 필드는 기본값으로 채운다. profile과 consent를 각각 복원한다.
        merge: (persisted, current) => {
          const saved = isRecord(persisted) ? persisted : {}
          return {
            ...current,
            profile: restoreFields(current.profile, saved.profile, PROFILE_FIELD_CHECKS),
            consent: restoreFields(current.consent, saved.consent, CONSENT_FIELD_CHECKS),
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
