import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { StateStorage } from 'zustand/middleware'
import {
  ALL_CONSENT_KEYS,
  CONSENT_ITEMS,
  CONSENT_POLICY_VERSION,
  REQUIREMENT_MET_MESSAGE,
  REQUIREMENT_UNMET_MESSAGE,
  canContinue,
  createInitialDraft,
  getRequirementMessage,
  isAllChecked,
  submitConsent,
  toggleAll,
  toggleItem,
} from './consent.ts'
import type { ConsentDraft, ConsentWriter } from './consent.ts'
import { createProfileStore, PROFILE_STORAGE_KEY } from './profileStore.ts'
import { OPTIONAL_CONSENT_KEYS, REQUIRED_CONSENT_KEYS } from './types.ts'
import type { ConsentKey } from './types.ts'

const NOW = 1_700_000_000_000

function createFakeStorage() {
  const map = new Map<string, string>()
  const storage: StateStorage = {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value)
    },
    removeItem: (name) => {
      map.delete(name)
    },
  }
  return { storage, map }
}

function draftOf(checked: readonly ConsentKey[]): ConsentDraft {
  const draft = createInitialDraft()
  for (const key of checked) draft[key] = true
  return draft
}

const ALL_REQUIRED: readonly ConsentKey[] = REQUIRED_CONSENT_KEYS

// 호출 순서와 인자를 기록하는 가짜 writer
function createRecordingWriter() {
  const calls: { name: string; args: unknown[] }[] = []
  const writer: ConsentWriter = {
    setConsent: (...args) => {
      calls.push({ name: 'setConsent', args })
    },
    recordConsent: (...args) => {
      calls.push({ name: 'recordConsent', args })
    },
  }
  return { writer, calls }
}

describe('동의 항목 정의', () => {
  test('Figma 순서와 문구의 항목 5개를 정의한다', () => {
    assert.deepEqual(
      CONSENT_ITEMS.map((item) => [item.key, item.label]),
      [
        ['ageOver14', '[필수] 만 14세 이상이에요'],
        ['termsOfService', '[필수] 서비스 이용약관'],
        ['privacyPolicy', '[필수] 개인정보 수집·이용'],
        ['locationTerms', '[필수] 위치기반서비스 이용약관'],
        ['marketing', '[선택] 마케팅 정보 수신'],
      ],
    )
  })

  test('필수 4개와 선택 1개를 구분한다', () => {
    assert.deepEqual(
      CONSENT_ITEMS.filter((item) => item.required).map((item) => item.key),
      [...REQUIRED_CONSENT_KEYS],
    )
    assert.deepEqual(
      CONSENT_ITEMS.filter((item) => !item.required).map((item) => item.key),
      [...OPTIONAL_CONSENT_KEYS],
    )
    assert.deepEqual([...ALL_CONSENT_KEYS], [...REQUIRED_CONSENT_KEYS, ...OPTIONAL_CONSENT_KEYS])
  })

  test('"보기"는 만 14세 이상 항목에만 없다', () => {
    assert.deepEqual(
      CONSENT_ITEMS.filter((item) => !item.hasDetail).map((item) => item.key),
      ['ageOver14'],
    )
  })

  test('약관 버전은 확정 전이라 null이다', () => {
    assert.equal(CONSENT_POLICY_VERSION, null)
  })
})

describe('createInitialDraft', () => {
  test('모든 동의가 false다', () => {
    const draft = createInitialDraft()
    assert.deepEqual(Object.keys(draft).sort(), [...ALL_CONSENT_KEYS].sort())
    for (const key of ALL_CONSENT_KEYS) assert.equal(draft[key], false, key)
  })

  test('저장된 동의가 있으면 5개 항목 값만 가져온다', () => {
    const draft = createInitialDraft({
      ageOver14: true,
      termsOfService: true,
      privacyPolicy: false,
      locationTerms: true,
      marketing: true,
      // 버전과 시각 같은 다른 필드는 draft에 들어오지 않는다
      ...({ policyVersion: 'v1', consentedAt: 1 } as object),
    })
    assert.deepEqual(draft, {
      ageOver14: true,
      termsOfService: true,
      privacyPolicy: false,
      locationTerms: true,
      marketing: true,
    })
  })
})

describe('canContinue (CTA 활성화)', () => {
  test('필수 4개와 마케팅 2상태의 32가지 조합 모두, 필수 4개가 선택된 경우에만 true다', () => {
    let trueCount = 0
    for (let required = 0; required < 16; required++) {
      for (const marketing of [false, true]) {
        const draft = createInitialDraft()
        REQUIRED_CONSENT_KEYS.forEach((key, index) => {
          draft[key] = (required & (1 << index)) !== 0
        })
        draft.marketing = marketing
        const expected = required === 0b1111
        assert.equal(canContinue(draft), expected, `required=${required.toString(2)} marketing=${marketing}`)
        if (expected) trueCount++
      }
    }
    assert.equal(trueCount, 2) // 필수 4개 모두 선택한 두 경우(마케팅 선택/미선택)뿐
  })

  test('필수 3개만 선택하면 마케팅을 선택해도 false다', () => {
    assert.equal(canContinue(draftOf(['ageOver14', 'termsOfService', 'privacyPolicy', 'marketing'])), false)
  })

  test('필수 4개를 선택하면 마케팅 선택 여부와 관계없이 true다', () => {
    assert.equal(canContinue(draftOf(ALL_REQUIRED)), true)
    assert.equal(canContinue(draftOf([...ALL_REQUIRED, 'marketing'])), true)
  })

  test('아무것도 선택하지 않으면 false다', () => {
    assert.equal(canContinue(createInitialDraft()), false)
  })
})

describe('isAllChecked', () => {
  test('5개가 모두 선택되어야 true다', () => {
    assert.equal(isAllChecked(draftOf(ALL_CONSENT_KEYS)), true)
  })

  test('필수 4개만 선택하면 false다 (마케팅 빠짐)', () => {
    assert.equal(isAllChecked(draftOf(ALL_REQUIRED)), false)
  })

  test('마케팅만 선택하거나 아무것도 선택하지 않으면 false다', () => {
    assert.equal(isAllChecked(draftOf(['marketing'])), false)
    assert.equal(isAllChecked(createInitialDraft()), false)
  })

  test('하나만 빠져도 false다', () => {
    for (const missing of ALL_CONSENT_KEYS) {
      const draft = draftOf(ALL_CONSENT_KEYS)
      draft[missing] = false
      assert.equal(isAllChecked(draft), false, missing)
    }
  })
})

describe('toggleAll', () => {
  test('아무것도 선택하지 않았으면 전체 선택한다', () => {
    assert.deepEqual(toggleAll(createInitialDraft()), draftOf(ALL_CONSENT_KEYS))
  })

  test('일부만 선택했으면 전체 선택한다', () => {
    assert.deepEqual(toggleAll(draftOf(['ageOver14', 'privacyPolicy'])), draftOf(ALL_CONSENT_KEYS))
  })

  test('필수 4개만 선택했으면(마케팅 빠짐) 전체 선택한다', () => {
    assert.deepEqual(toggleAll(draftOf(ALL_REQUIRED)), draftOf(ALL_CONSENT_KEYS))
  })

  test('5개가 모두 선택되어 있으면 전체 해제한다', () => {
    assert.deepEqual(toggleAll(draftOf(ALL_CONSENT_KEYS)), createInitialDraft())
  })

  test('연속 두 번 누르면 전체 선택 후 전체 해제된다', () => {
    const selected = toggleAll(createInitialDraft())
    assert.equal(isAllChecked(selected), true)
    assert.equal(isAllChecked(toggleAll(selected)), false)
  })

  test('원본 draft를 바꾸지 않는다', () => {
    const original = draftOf(['ageOver14'])
    toggleAll(original)
    assert.deepEqual(original, draftOf(['ageOver14']))
  })
})

describe('toggleItem', () => {
  test('선택하고 다시 누르면 해제된다', () => {
    const once = toggleItem(createInitialDraft(), 'termsOfService')
    assert.equal(once.termsOfService, true)
    assert.equal(toggleItem(once, 'termsOfService').termsOfService, false)
  })

  test('다른 항목은 바뀌지 않는다', () => {
    const draft = toggleItem(draftOf(['ageOver14', 'marketing']), 'privacyPolicy')
    assert.deepEqual(draft, draftOf(['ageOver14', 'marketing', 'privacyPolicy']))
  })

  test('원본 draft를 바꾸지 않는다', () => {
    const original = createInitialDraft()
    toggleItem(original, 'marketing')
    assert.equal(original.marketing, false)
  })

  test('개별 선택으로 전체 동의 상태가 계산된다', () => {
    let draft = createInitialDraft()
    for (const key of ALL_CONSENT_KEYS) {
      assert.equal(isAllChecked(draft), false)
      draft = toggleItem(draft, key)
    }
    assert.equal(isAllChecked(draft), true)
    assert.equal(isAllChecked(toggleItem(draft, 'marketing')), false)
  })
})

describe('getRequirementMessage', () => {
  test('필수 동의가 모자라면 계속할 수 있는 조건을 안내한다', () => {
    assert.equal(getRequirementMessage(createInitialDraft()), '필수 항목에 동의하면 계속할 수 있어요.')
    assert.equal(getRequirementMessage(draftOf(['ageOver14', 'marketing'])), REQUIREMENT_UNMET_MESSAGE)
  })

  test('필수 동의를 충족하면 선택 항목 안내를 돌려준다', () => {
    assert.equal(getRequirementMessage(draftOf(ALL_REQUIRED)), '선택 항목에 동의하지 않아도 가입할 수 있어요.')
    assert.equal(getRequirementMessage(draftOf(ALL_CONSENT_KEYS)), REQUIREMENT_MET_MESSAGE)
  })
})

describe('submitConsent', () => {
  test('필수 동의가 모자라면 저장하지 않고 false를 돌려준다', () => {
    const { writer, calls } = createRecordingWriter()
    assert.equal(submitConsent(writer, draftOf(['ageOver14', 'termsOfService', 'privacyPolicy', 'marketing']), { now: NOW }), false)
    assert.equal(submitConsent(writer, createInitialDraft(), { now: NOW }), false)
    assert.deepEqual(calls, [])
  })

  test('필수 동의를 충족하면 true를 돌려준다', () => {
    const { writer } = createRecordingWriter()
    assert.equal(submitConsent(writer, draftOf(ALL_REQUIRED), { now: NOW }), true)
  })

  test('setConsent를 먼저, recordConsent를 나중에 호출한다', () => {
    const { writer, calls } = createRecordingWriter()
    submitConsent(writer, draftOf(ALL_REQUIRED), { now: NOW })
    assert.deepEqual(
      calls.map((call) => call.name),
      ['setConsent', 'recordConsent'],
    )
  })

  test('setConsent에는 5개 동의 항목만 전달한다', () => {
    const { writer, calls } = createRecordingWriter()
    submitConsent(writer, draftOf([...ALL_REQUIRED, 'marketing']), { now: NOW })
    assert.deepEqual(calls[0].args[0], {
      ageOver14: true,
      termsOfService: true,
      privacyPolicy: true,
      locationTerms: true,
      marketing: true,
    })
  })

  test('약관 버전은 null, 시각은 전달한 값으로 recordConsent를 호출한다', () => {
    const { writer, calls } = createRecordingWriter()
    submitConsent(writer, draftOf(ALL_REQUIRED), { now: NOW })
    assert.deepEqual(calls[1].args, [null, NOW])
  })

  test('시각을 생략하면 현재 시각(epoch ms)을 기록한다', () => {
    const { writer, calls } = createRecordingWriter()
    const before = Date.now()
    submitConsent(writer, draftOf(ALL_REQUIRED))
    const after = Date.now()
    const at = calls[1].args[1] as number
    assert.ok(Number.isInteger(at) && at >= before && at <= after)
  })

  test('policyVersion 옵션을 주면 그 값을 기록한다 (확정 후 교체용)', () => {
    const { writer, calls } = createRecordingWriter()
    submitConsent(writer, draftOf(ALL_REQUIRED), { now: NOW, policyVersion: '2026-11' })
    assert.deepEqual(calls[1].args, ['2026-11', NOW])
  })
})

describe('submitConsent와 실제 profileStore', () => {
  test('CTA 전에는 draft를 조작해도 Store와 저장소에 아무것도 기록되지 않는다', () => {
    const { storage, map } = createFakeStorage()
    const store = createProfileStore(storage)
    let draft = createInitialDraft()
    draft = toggleAll(draft)
    draft = toggleItem(draft, 'marketing')
    draft = toggleAll(draft)
    assert.equal(isAllChecked(draft), true) // draft는 전체 선택 상태가 되었지만
    assert.equal(map.size, 0) // 저장소에는 아무것도 기록되지 않는다
    assert.equal(store.getState().consent.ageOver14, false)
    assert.equal(store.getState().consent.consentedAt, null)
  })

  test('저장하면 동의 항목, 약관 버전 null, 동의 시각이 Store에 반영된다', () => {
    const { storage } = createFakeStorage()
    const store = createProfileStore(storage)
    assert.equal(submitConsent(store.getState(), draftOf(ALL_REQUIRED), { now: NOW }), true)
    assert.deepEqual(store.getState().consent, {
      ageOver14: true,
      termsOfService: true,
      privacyPolicy: true,
      locationTerms: true,
      marketing: false,
      policyVersion: null,
      consentedAt: NOW,
    })
  })

  test('마케팅 동의 선택 여부가 그대로 저장된다', () => {
    const withMarketing = createProfileStore(createFakeStorage().storage)
    submitConsent(withMarketing.getState(), draftOf(ALL_CONSENT_KEYS), { now: NOW })
    assert.equal(withMarketing.getState().consent.marketing, true)

    const withoutMarketing = createProfileStore(createFakeStorage().storage)
    submitConsent(withoutMarketing.getState(), draftOf(ALL_REQUIRED), { now: NOW })
    assert.equal(withoutMarketing.getState().consent.marketing, false)
  })

  test('필수 동의가 모자라면 Store와 저장소가 그대로다', () => {
    const { storage, map } = createFakeStorage()
    const store = createProfileStore(storage)
    assert.equal(submitConsent(store.getState(), draftOf(['ageOver14', 'termsOfService']), { now: NOW }), false)
    assert.equal(map.size, 0)
    assert.equal(store.getState().consent.consentedAt, null)
    assert.equal(store.getState().consent.ageOver14, false)
  })

  test('저장 후 같은 저장소로 새 Store를 만들면 값이 복원된다', () => {
    const { storage, map } = createFakeStorage()
    const first = createProfileStore(storage)
    submitConsent(first.getState(), draftOf([...ALL_REQUIRED, 'marketing']), { now: NOW })
    assert.ok(map.has(PROFILE_STORAGE_KEY))

    const restored = createProfileStore(storage).getState().consent
    assert.deepEqual(restored, first.getState().consent)
    assert.equal(restored.policyVersion, null)
    assert.equal(restored.consentedAt, NOW)
    assert.equal(restored.marketing, true)
  })

  test('복원된 동의로 draft를 만들면 저장한 선택 상태와 같다', () => {
    const { storage } = createFakeStorage()
    const store = createProfileStore(storage)
    const saved = draftOf([...ALL_REQUIRED, 'marketing'])
    submitConsent(store.getState(), saved, { now: NOW })
    assert.deepEqual(createInitialDraft(createProfileStore(storage).getState().consent), saved)
  })

  test('프로필 필드는 바꾸지 않는다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ nickname: '희규', heightCm: 165 })
    const before = { ...store.getState().profile }
    submitConsent(store.getState(), draftOf(ALL_REQUIRED), { now: NOW })
    assert.deepEqual(store.getState().profile, before)
  })
})
