import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { StateStorage } from 'zustand/middleware'
import {
  NICKNAME_HINT_MESSAGE,
  NICKNAME_SUGGESTIONS,
  NICKNAME_TOO_LONG_MESSAGE,
  NICKNAME_TOO_SHORT_MESSAGE,
  NICKNAME_VALID_MESSAGE,
  getNicknameFeedback,
  getNicknameInitial,
  submitNickname,
} from './nickname.ts'
import type { NicknameWriter } from './nickname.ts'
import { createProfileStore, PROFILE_STORAGE_KEY } from './profileStore.ts'
import { countNicknameChars, validateNickname } from './validation.ts'

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

function createRecordingWriter() {
  const calls: unknown[][] = []
  const writer: NicknameWriter = {
    setProfile: (...args) => {
      calls.push(args)
    },
  }
  return { writer, calls }
}

describe('안내 문구', () => {
  test('확정한 문구를 쓴다', () => {
    assert.equal(NICKNAME_HINT_MESSAGE, '2~10자로 입력해 주세요.')
    assert.equal(NICKNAME_TOO_SHORT_MESSAGE, '2자 이상 입력해 주세요.')
    assert.equal(NICKNAME_TOO_LONG_MESSAGE, '10자 이하로 입력해 주세요.')
    assert.equal(NICKNAME_VALID_MESSAGE, '2~10자 조건을 만족해요.')
  })
})

describe('getNicknameFeedback', () => {
  test('빈 값은 오류가 아닌 중립 안내이고 제출할 수 없다', () => {
    assert.deepEqual(getNicknameFeedback(''), {
      tone: 'neutral',
      message: NICKNAME_HINT_MESSAGE,
      count: 0,
      canSubmit: false,
    })
  })

  test('공백만 입력해도 중립 안내이고 글자 수는 0이다', () => {
    for (const raw of [' ', '   ', '\t', '\n ']) {
      const feedback = getNicknameFeedback(raw)
      assert.equal(feedback.tone, 'neutral', JSON.stringify(raw))
      assert.equal(feedback.count, 0)
      assert.equal(feedback.canSubmit, false)
    }
  })

  test('1자는 "2자 이상" 오류다', () => {
    assert.deepEqual(getNicknameFeedback('가'), {
      tone: 'error',
      message: NICKNAME_TOO_SHORT_MESSAGE,
      count: 1,
      canSubmit: false,
    })
  })

  test('앞뒤 공백을 빼고 1자면 여전히 오류다', () => {
    const feedback = getNicknameFeedback('  가  ')
    assert.equal(feedback.tone, 'error')
    assert.equal(feedback.count, 1)
    assert.equal(feedback.canSubmit, false)
  })

  test('2자와 10자는 유효하다', () => {
    assert.deepEqual(getNicknameFeedback('가나'), {
      tone: 'valid',
      message: NICKNAME_VALID_MESSAGE,
      count: 2,
      canSubmit: true,
    })
    const ten = getNicknameFeedback('가나다라마바사아자차')
    assert.equal(ten.tone, 'valid')
    assert.equal(ten.count, 10)
    assert.equal(ten.canSubmit, true)
  })

  test('11자 이상은 입력할 수 있지만 오류이고 제출할 수 없다', () => {
    const eleven = getNicknameFeedback('가나다라마바사아자차카')
    assert.deepEqual(eleven, {
      tone: 'error',
      message: NICKNAME_TOO_LONG_MESSAGE,
      count: 11,
      canSubmit: false,
    })
    assert.equal(getNicknameFeedback('가'.repeat(30)).count, 30)
    assert.equal(getNicknameFeedback('가'.repeat(30)).canSubmit, false)
  })

  test('앞뒤 공백은 글자 수에 넣지 않는다', () => {
    const feedback = getNicknameFeedback('  가나다라마바사아자차  ')
    assert.equal(feedback.count, 10)
    assert.equal(feedback.canSubmit, true)
  })

  test('중간 공백은 글자 수에 포함한다', () => {
    const feedback = getNicknameFeedback('가 나')
    assert.equal(feedback.count, 3)
    assert.equal(feedback.canSubmit, true)
  })

  test('이모지는 코드포인트 기준으로 1자로 센다', () => {
    assert.equal(getNicknameFeedback('😀😀').count, 2)
    assert.equal(getNicknameFeedback('😀😀').canSubmit, true)
    assert.equal(getNicknameFeedback('😀'.repeat(10)).canSubmit, true)
    assert.equal(getNicknameFeedback('😀'.repeat(11)).canSubmit, false)
  })

  test('카운터와 검증은 같은 기준이다', () => {
    const samples = ['', ' ', '가', ' 가 ', '가나', '가나다라마바사아자차', '가나다라마바사아자차카', '😀 😀', '  ab  ']
    for (const raw of samples) {
      const validation = validateNickname(raw)
      const feedback = getNicknameFeedback(raw)
      assert.equal(feedback.count, countNicknameChars(validation.value), JSON.stringify(raw))
      assert.equal(feedback.canSubmit, validation.valid, JSON.stringify(raw))
    }
  })
})

describe('getNicknameInitial', () => {
  test('입력이 없으면 빈 문자열이다', () => {
    assert.equal(getNicknameInitial(''), '')
    assert.equal(getNicknameInitial('   '), '')
  })

  test('앞뒤 공백을 뺀 첫 글자를 돌려준다', () => {
    assert.equal(getNicknameInitial('희규'), '희')
    assert.equal(getNicknameInitial('  희규'), '희')
  })

  test('이모지는 깨지지 않게 코드포인트 하나를 돌려준다', () => {
    assert.equal(getNicknameInitial('😀a'), '😀')
  })
})

describe('추천 이름', () => {
  test('삼색, 도도, 야통이고 모두 유효한 닉네임이다', () => {
    assert.deepEqual([...NICKNAME_SUGGESTIONS], ['삼색', '도도', '야통'])
    for (const name of NICKNAME_SUGGESTIONS) {
      assert.equal(getNicknameFeedback(name).canSubmit, true, name)
    }
  })
})

describe('submitNickname', () => {
  test('유효한 닉네임을 앞뒤 공백을 제거해 저장하고 true를 돌려준다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    assert.equal(submitNickname(store.getState(), '  희규  '), true)
    assert.equal(store.getState().profile.nickname, '희규')
  })

  test('유효하지 않으면 저장하지 않고 false를 돌려준다', () => {
    for (const raw of ['', '   ', '가', '가나다라마바사아자차카']) {
      const { writer, calls } = createRecordingWriter()
      assert.equal(submitNickname(writer, raw), false, JSON.stringify(raw))
      assert.equal(calls.length, 0)
    }
  })

  test('유효하지 않은 제출은 기존에 저장된 닉네임을 바꾸지 않는다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ nickname: '희규' })
    assert.equal(submitNickname(store.getState(), '가'), false)
    assert.equal(store.getState().profile.nickname, '희규')
  })

  test('닉네임만 바꾸고 다른 프로필 값은 유지한다', () => {
    const store = createProfileStore(createFakeStorage().storage)
    store.getState().setProfile({ birthYear: 2000, gender: 'female', heightCm: 170, weightKg: 65 })
    submitNickname(store.getState(), '삼색')
    assert.deepEqual(store.getState().profile, {
      nickname: '삼색',
      birthYear: 2000,
      gender: 'female',
      heightCm: 170,
      weightKg: 65,
    })
  })

  test('저장한 닉네임은 새로고침 뒤에도 복원된다', () => {
    const { storage, map } = createFakeStorage()
    const store = createProfileStore(storage)
    submitNickname(store.getState(), '도도')
    assert.ok(map.has(PROFILE_STORAGE_KEY))
    const restored = createProfileStore(storage)
    assert.equal(restored.getState().profile.nickname, '도도')
  })

  test('추천 이름을 고르는 것만으로는 저장되지 않는다 (제출해야 저장)', () => {
    const store = createProfileStore(createFakeStorage().storage)
    // 화면은 추천 이름을 draft에 반영할 뿐이다. 이 시점에는 Store가 그대로다.
    const draft: string = NICKNAME_SUGGESTIONS[0]
    assert.equal(store.getState().profile.nickname, '')
    assert.equal(submitNickname(store.getState(), draft), true)
    assert.equal(store.getState().profile.nickname, '삼색')
  })
})
