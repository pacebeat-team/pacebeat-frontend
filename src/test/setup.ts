import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// 테스트마다 렌더한 화면을 정리한다(Vitest는 globals를 쓰지 않아 자동 정리가 되지 않는다).
afterEach(() => cleanup())
