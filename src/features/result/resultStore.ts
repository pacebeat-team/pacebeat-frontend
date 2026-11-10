import { create } from 'zustand'

export type ReflectionDifficulty = '쉬웠어요' | '적당했어요' | '힘들었어요'
export type ReflectionReason = '숨이 참' | '다리 피로' | '지루함' | '시간 부족'

interface ResultState {
  difficulty: ReflectionDifficulty | null
  reasons: ReflectionReason[]
  memo: string
  reflectionSaved: boolean
  setDifficulty: (difficulty: ReflectionDifficulty) => void
  toggleReason: (reason: ReflectionReason) => void
  setMemo: (memo: string) => void
  saveReflection: (reflection?: {
    difficulty: ReflectionDifficulty
    reasons: ReflectionReason[]
    memo: string
  }) => void
  saveResult: (completed: boolean) => void
}

export const useResultStore = create<ResultState>((set, get) => ({
  difficulty: null,
  reasons: [],
  memo: '',
  reflectionSaved: false,
  setDifficulty: (difficulty) => set({ difficulty }),
  toggleReason: (reason) => set((state) => ({
    reasons: state.reasons.includes(reason)
      ? state.reasons.filter((item) => item !== reason)
      : [...state.reasons, reason],
  })),
  setMemo: (memo) => set({ memo: memo.slice(0, 100) }),
  saveReflection: (reflection) => set(reflection ? {
    ...reflection,
    memo: reflection.memo.slice(0, 100),
    reflectionSaved: true,
  } : { reflectionSaved: true }),
  saveResult: (completed) => {
    const state = get()
    window.localStorage.setItem('ppace-latest-result', JSON.stringify({
      completed,
      difficulty: state.difficulty,
      reasons: state.reasons,
      memo: state.memo,
    }))
  },
}))

