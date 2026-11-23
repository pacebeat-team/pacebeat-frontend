# PR 초안 (로컬 문서 — GitHub에는 올리지 않았습니다)

> 이 문서는 등록용 초안입니다. push·PR 생성·병합은 하지 않았습니다. 본문은 프로젝트의 고정 PR 템플릿(관련 Issue/작업 내용/테스트/Review 요청사항/Checklist)에 맞춰 옮겨 쓰세요.

## 브랜치 전략 (Git 그래프 기준)

```
develop (fc3d829)
 ├─ integration/all-screens (a3767ac, 화면 통합 기준) ─ 미커밋 58개 → 기준선 커밋 3개
 └─ feature/69 → 70 → 71 → 72 (develop 기준 스택, 6bf768d)
        └──────────── merge (a4474d2) ───────────→ integration/screens-api (f5f52ca)
                                                   + #70 연결 1커밋, #71 연결 1커밋
```

- 권장: **PR 하나(통합 PR)** — `integration/screens-api` → `develop`.
  - 이유: API 브랜치 4개가 서로 쌓여 있고(#69→#72), 화면 연결 커밋은 화면 기준선과 API 양쪽에 의존한다. 개별 PR로 쪼개면 각각 단독으로 빌드·검증되지 않는다.
  - 화면 기준 정책: 화면 구현의 기준은 `integration/all-screens`의 통합 구현이다. **PR #60~#68은 병합하지 않으며 참고용**이다(이 브랜치도 #60~#68을 병합하지 않고 통합 기준선의 내용을 직접 담았다). 따라서 #60~#68 병합은 선행 조건이 아니다.
  - 선행 조건: 이 브랜치 하나가 화면 기준선 + API 기반 + 연결을 모두 담으므로 다른 PR 병합 없이 `develop`에 올릴 수 있다. 단, 기준선 커밋 3개는 기능별 분할이라 개별 커밋은 단독 빌드되지 않을 수 있다(PR은 squash 또는 전체 병합 권장).
- 대안(이슈별 PR): #69 → #70 → #71 → #72 순서로 develop에 스택 PR. 화면 연결 커밋(syncWiring)은 화면 기준선(`integration/all-screens` 내용)이 develop에 들어간 뒤 #70/#71 PR에 얹어야 한다(#60~#68 병합이 아니라 통합 기준선 반영이 전제).
- 보호된 브랜치(수정하지 않음): `integration/all-screens`, `backup/all-screens-2026-11-23`, feature/69~72.

## 통합 PR 초안

**제목**: `feat: 전체 화면 통합 + API 연동(인증·프로필·러닝 기록·안내 설정) (#69 #70 #71 #72)`

**관련 Issue**: #69, #70(부분), #71(부분), #72

**작업 내용**
- #69: API 클라이언트(Bearer, 타임아웃·취소, 401 갱신 1회+재시도, 에러 분류), TanStack Query, Supabase Auth 세션 복구·갱신·로그아웃·탭 간 동기화.
- #70: 프로필·동의·기초 측정·러닝 기록 매퍼, 러닝 저장 대기열(중복 방지·재시도·인증 대기·재시작 복원), **화면 연결**(`syncWiring`: 가입 완료·기초 측정 완료·러닝 결과 저장 시 서버 전송).
- #71: Growth·안내 설정·인솔 상태 매퍼, **음성 안내 설정 전송 연결**.
- #72: API 회귀 테스트(에러 매트릭스, 화면이 API를 직접 부르지 않음, 대기열이 로컬 기록을 건드리지 않음).
- 연결은 `src/features/serverSync/syncWiring.ts` 한 곳에서 기존 Store를 구독한다. 화면 컴포넌트는 바꾸지 않았다.
- 서버 꺼짐(`VITE_API_BASE_URL` 없음)·게스트에서는 아무것도 보내지 않고 기존 로컬 흐름만 쓴다.

**테스트** (통합 브랜치 `integration/screens-api`, 로컬)
- tsc 통과, ESLint 통과, vite build 통과
- Node 테스트 1396건 통과, Vitest 4파일 16건 통과(forks·threads 풀 모두)
- 브라우저(localhost, env 없음): 앱 부팅·온보딩 진입, 콘솔 오류 없음, 서버 호출 없음
- **미검증**: 실제 Supabase 로그인/JWT, 실서버 쓰기, 실기기 iPhone 19개 항목(`docs/run-real-device-checklist.md`, 전부 미수행)

**Review 요청사항 / 위험**
- `main.tsx` 병합 충돌은 양쪽 유지로 해결(`runSessionSync` 임포트 + `QueryClientProvider`/`startAuth`/`syncWiring`).
- 로컬 우선: 서버 응답으로 로컬 데이터를 덮어쓰지 않는다. 서버→로컬 반영은 하지 않았다(아래 미완료).
- `client_session_id = 로컬 sessionId`: 백엔드는 `(user_id, client_session_id)` upsert이고 재전송 시 덮어쓴다(소스 확인, 실서버 미검증).

**미완료 / 외부 의존성**
| 항목 | 상태 | 이유 |
|---|---|---|
| 로그인 수단(OAuth/OTP 등)·Supabase URL/anon key/redirect URL | 보류 | 미확정, 값을 만들지 않음. `auth.setSession()`이 연결 지점 |
| Records 서버 목록 병합·상세·회고 서버 수정 | 보류 | 서버 목록에 로컬 recordId 대응이 없고 run_id↔recordId 변환 규칙 미확정, 페이지네이션 없음 |
| Growth 서버 통계 화면 교체 | 보류(의도적) | 서버는 7/30일 롤링 UTC 집계, 로컬은 자세 28일·최근7 vs 이전7 정책 — 정책 충돌, 교체하지 않음 |
| 자세 리포트 서버 전송 | 보류 | SDK 계약 미확정(`docs/posture-report-prep.md`) |
| 데이터 내보내기 실제 파일 / 계정 삭제 | 보류 | 서버 응답 형식·정책 미확정. 기록 삭제→계정 삭제 대체 없음 |
| 로컬→서버 최초 이전(마이그레이션) | 보류 | 백업·복구 검증 없이 이전하지 않음. 기존 기록은 앱을 쓰며 새로 저장되는 기록만 전송 |
| 프로필 편집 후 재전송 | 미구현 | 현재는 가입 완료 시 1회 전송 |
| 기초 측정 건너뛰기 전송 | 미구현 | 건너뛰기 화면 신호 미확인 |

**Checklist**
- [x] tsc / ESLint / build / Node / Vitest 통과
- [x] 토큰·키 로그 없음, `.env.example`에는 이름만
- [x] 로컬 데이터 덮어쓰기 없음, 게스트 흐름 유지
- [ ] 실서버·실기기 검증(미수행)
