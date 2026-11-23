import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// 화면 렌더링·상호작용 테스트 전용 설정(`yarn test:dom`).
// 기존 `node --test`(src/**/*.test.ts)와 겹치지 않도록 이 설정은 *.test.tsx만 실행한다.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
  },
})
