# API 연동 조사와 Issue 초안 (2026-11-23)

상태: **조사 + 기반 구조까지.** 어떤 화면도 서버 API를 호출하지 않는다. 기존 로컬 저장(localStorage)은 그대로다.
기준 자료: 백엔드 `GET /openapi.json`(Pacebeat API 1.0.0, 읽기 요청만 사용), `pacebeat-team/pacebeat-backend`의 `backend-specification.md`·`README.md`·`app/core/{security,errors,config}.py`·`app/main.py`.
운영 서버(`pacebeat-backend-production.up.railway.app`)에는 `GET /health`, `GET /openapi.json`, `GET /docs`만 요청했다. 데이터 변경 요청은 보내지 않았다. 토큰·키는 어디에도 기록하지 않았다.

## 1. 확인된 백엔드 명세

- 인증: 모든 `/api/v1/*`가 `Authorization: Bearer <JWT>`를 요구한다(OpenAPI `HTTPBearer`). 백엔드는 **Supabase Auth가 발급한 JWT를 HS256 + `SUPABASE_JWT_SECRET`으로 검증**한다(`security.py`). 토큰이 없으면 401 `AUTH_MISSING_TOKEN`, 잘못되면 401 `AUTH_INVALID_TOKEN`.
- **회원가입·로그인·로그아웃·토큰 갱신 엔드포인트는 백엔드에 없다.** 프론트가 Supabase Auth를 직접 써야 한다.
- 오류 본문: `{ "status_code": number, "error_code": string, "message": string }`(`errors.py`). 422도 `error_code: VALIDATION_ERROR`로 이 모양이다.
- 날짜·시각은 ISO 8601 date-time. 페이스는 sec/km 정수, 측정 불가는 `0`이 아닌 `null` + `MetricStatusType`(valid, insufficient_data, no_data, gps_poor, single_foot, sensor_disconnected).
- CORS: `http://localhost:5173`은 허용(확인함). Netlify 도메인은 배포 후 백엔드에 전달해야 한다. **우리 개발 서버 포트가 5173이 아니면 브라우저가 막는다.**
- 환경: 운영(production) 주소 하나만 확인했다. 개발·스테이징 서버는 확인되지 않았다.

### API 목록 (21개, 모두 인증 필요, `/health` 제외)
| 분류 | 메서드 경로 | 비고 |
|---|---|---|
| System | GET /health | 인증 없음. `{"status":"ok","database":"connected"}` 확인 |
| My | GET·PATCH /api/v1/users/me | 프로필·동의·안내 설정 통합 |
| My | DELETE /api/v1/users/me | 계정·전체 데이터 삭제(204) |
| My | GET·PUT /api/v1/users/me/baseline | 기초 측정 |
| My | PATCH /api/v1/users/me/guidance | 안내 설정 |
| My | POST /api/v1/users/me/data-export | 응답 스키마 문서에 없음 |
| My | GET·POST /api/v1/devices/insoles, PATCH·DELETE …/{side} | 스마트 인솔 |
| Home | GET /api/v1/home/summary | 서버 계산 요약 |
| Running | POST /api/v1/runs/targets/validate | 목표 페이스 계산·경고 |
| Running | GET /api/v1/music/presets | 응답 스키마 문서에 없음 |
| Running/Records | POST /api/v1/runs | `client_session_id` 멱등 저장(201) |
| Records | GET /api/v1/runs?from&to | 응답 스키마 문서에 없음 |
| Records | GET /api/v1/runs/{run_id}, PATCH …/reflection | |
| Growth | GET /api/v1/growth/running, /posture?period=weekly\|monthly | 기간별 버킷 |

### 미확정·문서에 없는 것
- 로그인 방식(이메일/소셜/익명), Supabase anon 키(전달문에 값이 비어 있음), 토큰 저장·갱신 정책, Auth Redirect URL.
- 목록·내보내기·음악 프리셋의 응답 형식, `from`/`to` 형식(날짜인지 date-time인지), 페이지네이션·정렬 규칙(없음으로 보이나 명시 없음).
- 러닝 기록 **개별 삭제** 엔드포인트 없음(계정 전체 삭제만 있음). 기록 수정은 회고(reflection)만 있다.
- 주간·월간 버킷의 기준 시간대(KST인지)와 주 시작 요일.
- 자세 측정(SDK) 계약. 백엔드 모델은 있으나(`PostureReportPayload`) SDK가 무엇을 주는지 확정되지 않았다.
- 백엔드 서비스·SQL 코드는 읽지 않았다(명세·보안·오류·설정 파일만). 동작 검증은 하지 못했다.

## 2. 문서와 구현·프론트의 차이

1. **OpenAPI의 422 응답은 `HTTPValidationError`로 나오지만 실제 핸들러는 표준 오류 본문(VALIDATION_ERROR)을 돌려준다.** 클라이언트는 표준 본문 기준으로 해석한다.
2. **안내 설정이 다르다.** 프론트 `{beatGuide, voiceGuide, frequency: perKm|offPace|both, autoPause}` ↔ 백엔드 `{voice_guidance_enabled, vibration_guidance_enabled, guidance_frequency_km(0.5~10), vibration_intensity}`. 박자 안내·자동 일시정지·"벗어날 때만"에 대응하는 필드가 없고, 진동은 프론트에서 지원하지 않는다. 확정 정책(자동 일시정지 등)을 서버에 저장할지 협의가 필요하다.
3. **기록 식별자.** 프론트는 `recordId`/`sessionId`(로컬 생성)를 쓰고 `/records/:recordId`, `/growth/posture/:recordId` 경로에 쓴다. 백엔드는 `client_session_id`(우리가 보낸 값, 멱등 키)와 서버 `run_id`(uuid)를 가진다. 어느 값을 경로 id로 쓸지, 로컬 기록과 서버 기록을 어떻게 합칠지 정해야 한다.
4. **자세 리포트 모양.** 프론트 `PostureSummary{measuredSide, balance, pressure(3구역 합 100)}` ↔ 백엔드 발별 `left/right_pressure_distribution(forefoot·midfoot·heel)`, `left/right_load_ratio_pct`, 접지 시간, 착지 유형, `feedback_items`. 프론트의 "압력 분포는 한쪽 기록도 포함, 균형은 양쪽만" 정책과 백엔드 성장 집계(`single_foot` 처리)가 같은지 확인되지 않았다. 프론트는 28일·7일 vs 7일을 기록에서 직접 계산하지만 백엔드는 주간/월간 버킷을 준다. 두 방식을 어떻게 맞출지 정해야 한다.
5. **Home/추천 목표/음악.** 프론트는 로컬에서 계산·정적 목록을 쓴다. 백엔드는 `home/summary`(추천 목표와 근거), `music/presets`를 준다. 트랙 id 체계(프론트 정적 id)와 맞는지 확인되지 않았다.
6. **삭제·내보내기.** 프론트(⑥)는 로컬 기록 중심 삭제·CSV/JSON 내보내기를 가진다. 백엔드는 계정 전체 삭제와 JSON 내보내기만 있다. 삭제 범위(로컬 vs 서버)와 순서 정책이 필요하다.
7. **로그인 없는 사용.** 프론트 온보딩은 "계정 없이 먼저 둘러볼 수 있어요"인데 백엔드는 모든 API가 JWT를 요구한다. 익명 로그인 허용 여부, 비로그인 시 로컬 전용 동작을 정해야 한다.
8. 일치하는 것: 성별(female/male/null), 러닝 경험·주간 횟수(beginner·occasional·regular, 1·2·3+), 완주 구분(goal/partial/time), 구간·GPS 끊김 구간 필드 모양, 회고 난이도·이유 값, 페이스 sec/km·null 정책.

## 3. 이번에 구현한 기반(서버 호출 없음)
- `src/lib/api/config.ts` 환경변수 `VITE_API_BASE_URL`(없으면 연동 꺼짐)
- `client.ts` fetch 기반 공통 클라이언트(Bearer 주입 지점, 시간 초과, 401 알림, 취소), `errors.ts`(ApiError·NetworkError)
- `types.ts` OpenAPI 타입, `endpoints.ts` 21개 얇은 호출 함수, `queryKeys.ts`, `queryClient.ts`(4xx 재시도 안 함, 쓰기 재시도 안 함)
- `src/main.tsx`에 `QueryClientProvider` 추가(읽는 화면 없음), `.env.example`
- 테스트 `src/lib/api/api.test.ts`(가짜 fetch만 사용, 실제 서버 호출 없음)
- 의도적으로 하지 않은 것: Supabase 로그인, 토큰 저장·갱신, 화면 연결, 로컬 저장 교체, 목 서버.
- 의존성: `@tanstack/react-query`·`axios`는 이미 package.json에 있었다(추가 없음). HTTP는 fetch로 구현했고 axios는 쓰지 않았다.

## 4. Issue 초안 (등록은 직접 하세요. 실제 Issue는 만들지 않았습니다)

### 4-1. 구성과 진행 순서
- 확인 시점: 2026-11-23. 저장소 Issue #1~#65(API 연동 Issue 없음), 열린 PR #60~#68. 별도의 "API 계약 확인" Issue는 만들지 않았고, 백엔드 협의 항목은 각 Issue의 "백엔드 협의 또는 미확정 사항"에 나누어 적었다.
- **공통 시작 조건**: 화면 PR #60~#68이 `develop`에 병합된 뒤 코드 변경을 시작한다(수정 대상 화면이 그 PR에 있다). 기반 코드(`src/lib/api`)는 로컬 통합 브랜치(`integration/all-screens`)에서 작성했고 백업 브랜치에는 없다.
- 각 Issue의 하위 작업에 **[진행 가능]**(백엔드 답변 없이 가능)과 **[Blocker]**(답변·외부 자료 필요)를 표시했다. Blocker가 있어도 나머지 하위 작업은 막히지 않는다.

| 순서 | Issue | 선행 조건 |
|---|---|---|
| 1 | Issue 1 API Client 및 Supabase Auth | 화면 PR #60~#68 병합. 하위 작업 A(API Client)는 인증 정보 없이 시작 가능, B(Auth)는 로그인 방식·anon 키 필요 |
| 2 | Issue 2 프로필·온보딩·Running·Records | Issue 1, **#59(PR #62) develop 병합** |
| 2 | Issue 3 Growth·My | Issue 1. 러닝 통계는 서버에 기록이 있어야 의미가 있어 Issue 2의 저장 부분과 순서를 맞춘다 |
| 3 | Issue 4 통합 테스트·회귀 | Issue 1~3 구현 후 |

Issue 2와 3은 하위 작업이 서로 독립이라 병렬로 진행할 수 있다(Issue 3의 러닝 통계만 Issue 2의 기록 저장 이후). Issue 3의 자세 SDK 하위 작업은 외부 Blocker이며 다른 작업을 막지 않는다.

### 4-2. Issue 본문 (그대로 복사해 등록)
각 블록은 4개의 백틱으로 감쌌다. 안의 내용만 복사한다.

#### Issue 1

````markdown
**제목:** [Feat] API Client 및 Supabase Auth 구축

## 1. 배경 및 목적
백엔드(Swagger/OpenAPI 1.0.0)가 배포되었고, `/health`를 뺀 모든 `/api/v1/*`가 `Authorization: Bearer <JWT>`를 요구한다. 백엔드에는 회원가입·로그인·로그아웃·토큰 갱신 API가 **없고**, Supabase Auth가 발급한 JWT를 백엔드가 검증한다(`app/core/security.py`: HS256 + `SUPABASE_JWT_SECRET`). 프론트에는 `@tanstack/react-query`와 `axios`가 package.json에 있으나 사용되지 않으며, 로컬 통합 브랜치에 `src/lib/api/`(client, config, errors, types, endpoints, queryKeys, queryClient)가 작성되어 있다. 이 Issue는 모든 서버 연동이 쓰는 공통 기반과 인증 세션을 만든다.

## 2. 작업 범위
**A. API Client 기반 [진행 가능 — 인증 정보 불필요]**
- 기존 `src/lib/api/` 정리 및 정식 반영
- 공통 HTTP 클라이언트: 환경변수 `VITE_API_BASE_URL`(비어 있으면 서버 연동 꺼짐), 요청·응답·오류 처리, 시간 초과, 취소, Bearer 주입 지점
- 표준 오류 본문 `{status_code, error_code, message}` 해석, 네트워크 오류 구분
- OpenAPI 요청·응답 타입, 얇은 엔드포인트 함수(화면 연결 없음)
- TanStack Query 설정(4xx 재시도 없음, 쓰기 재시도 없음), Query Key, 캐시 정책(staleTime 등)
- 서버 연동이 꺼진 상태(환경변수 없음)에서 기존 앱이 변함없이 동작함을 검증

**B. Supabase Auth 세션 연동 [Blocker: 로그인 방식·anon 키 등 확인 필요]**
- 로그인·로그아웃·세션 유지, 토큰 공급(`getAccessToken`)과 갱신, 401 처리, 인증 상태 Store
- 확인된 정보만 사용한다. 미확인 값은 구현을 추측하지 않고 Blocker로 둔다.

## 3. 세부 작업 체크리스트
A. API Client
- [ ] [진행 가능] `src/lib/api/*`를 정식 브랜치로 반영하고 코드 리뷰
- [ ] [진행 가능] `src/main.tsx`의 `QueryClientProvider` 반영, `.env.example` 반영, README에 환경변수 설명
- [ ] [진행 가능] 오류 유형(401/403/404/422/5xx/네트워크/시간 초과/취소) 구분과 테스트(가짜 fetch)
- [ ] [진행 가능] 서버 오류·네트워크 오류 표시 규칙(로딩·오류·빈 상태). Figma에 없는 문구는 `docs/unconfirmed-copy.md`에 기록하고 임의 확정하지 않는다
- [ ] [진행 가능] 서버 실패 시 기존 로컬 동작을 유지하는 규칙 문서화
- [ ] [진행 가능] OpenAPI가 바뀔 때 `types.ts`를 갱신하는 절차 문서화
- [ ] [진행 가능] fetch(현재) 유지 vs axios 사용을 팀이 결정(추가 의존성 없음·테스트 용이 vs 기존 선언된 의존성)
- [ ] [진행 가능] 환경변수 없음/있음 두 상태에서 전체 화면 회귀 확인(서버 요청 0건)

B. Supabase Auth
- [ ] [Blocker] 로그인 방식 확정(이메일/소셜/익명)
- [ ] [Blocker] Supabase anon(publishable) 키 수령 → `VITE_SUPABASE_ANON_KEY`(`.env.local`, 커밋 금지). 키 값은 코드·문서·Issue·로그에 쓰지 않는다
- [ ] [Blocker] Auth Redirect URL(Netlify 도메인), 로컬 개발 포트
- [ ] [Blocker] 토큰 갱신·만료·401 처리 정책, 백엔드의 JWT 검증 방식이 Supabase 프로젝트의 서명 방식(HS256/비대칭)과 맞는지 확인
- [ ] Supabase 클라이언트(supabase-js) 도입 여부 결정 — 의존성 추가가 필요하면 팀 승인
- [ ] 세션 저장 위치와 새로고침 복원, `getAccessToken` 연결, 401 시 세션 만료 흐름(`onUnauthorized`)
- [ ] 비로그인(둘러보기) 동작 규칙 — 온보딩은 "계정 없이 먼저 둘러볼 수 있어요"인데 모든 API가 JWT를 요구
- [ ] 로그인 화면·진입 흐름은 Figma에 없으면 임의로 만들지 않고 디자인 확인 후 진행
- [ ] 로그아웃 시 로컬 데이터 처리 규칙(기본: 지우지 않음) 팀 결정

## 4. 관련 API endpoint
- `GET /health` (인증 없음, 연결 확인)
- 인증 검증용: `GET /api/v1/users/me` (토큰 없음 401 `AUTH_MISSING_TOKEN`, 잘못된 토큰 401 `AUTH_INVALID_TOKEN`)
- 그 외 엔드포인트는 타입·호출 함수만 준비하고 화면에 연결하지 않는다(Issue 2·3).
- 로그인·가입·갱신 endpoint: 백엔드에 없음(Supabase Auth 사용 — 정확한 호출 방식은 확인 필요)

## 5. 주요 수정 예상 영역
`src/lib/api/`, `src/main.tsx`, `.env.example`, 신규 인증 모듈·Store, `src/app/EntryGuard.tsx`·`src/app/entryFlow.ts`(진입 규칙. 기존 온보딩·프로필 완료 판정은 변경하지 않는다), `src/lib/api/api.test.ts` 및 신규 테스트

## 6. 선행 조건 및 의존성
- 화면 PR #60~#68이 `develop`에 병합된 후 시작
- A는 백엔드 답변 없이 시작 가능. B는 아래 협의 사항 해소 후
- Issue 2·3의 선행 Issue

## 7. 백엔드 협의 또는 미확정 사항
- 로그인 방식(이메일/소셜/익명), Supabase anon 키 전달, Auth Redirect URL — **미확정**
- 토큰 갱신·만료·401 정책, JWT 서명 방식 — **미확정**
- 개발·스테이징 서버와 테스트 계정(현재 확인된 서버는 운영 하나) — **미확정**
- 프론트 배포 도메인(Netlify)과 CORS 허용(현재 `http://localhost:5173`만 확인, 다른 개발 포트는 막힐 수 있음) — **미확정**
- 비로그인 사용 허용 여부 — **미확정**
- OpenAPI는 422를 `HTTPValidationError`로 문서화했지만 실제 핸들러는 표준 오류 본문(`VALIDATION_ERROR`)을 돌려줌 — 문서 정정 요청

## 8. 완료 조건 (Acceptance Criteria)
- `VITE_API_BASE_URL` 없이 앱이 기존과 동일하게 동작하고 서버 요청이 발생하지 않는다.
- 오류 유형별 처리가 테스트로 확인되고, 토큰·키가 코드·로그·테스트에 남지 않는다.
- (B 해소 후) 테스트 계정으로 로그인 → 새로고침 후 세션 유지 → 로그아웃이 동작하고, 만료된 토큰에서 정해진 흐름으로 간다.
- 인증 실패·서버 꺼짐 상태에서도 기존 로컬 화면과 저장 데이터가 훼손되지 않는다.
- `node --test`, Vitest, `tsc`, `eslint`, 프로덕션 빌드가 통과한다.

## 9. 검증 방법
- 가짜 fetch/가짜 Supabase 클라이언트 단위 테스트(실제 서버에 요청하지 않는다)
- 서버 연동 꺼짐 상태에서 브라우저로 주요 화면 회귀 확인
- 실제 로그인 확인은 개발/스테이징 서버와 테스트 계정으로만. 운영 서버에서 실제 사용자 데이터에 영향을 주는 요청은 하지 않는다.

## 10. 제외 범위 및 주의사항
- 프로필·러닝·기록·성장·설정 데이터의 화면 연결(Issue 2·3), 로컬 저장 교체, 목(mock) 서버
- 로그인 화면 신규 디자인, 소셜 로그인 공급자 선택
- 인증 정보가 확인되지 않은 부분은 추측하지 않는다.
````

#### Issue 2

````markdown
**제목:** [Feat] 프로필·온보딩·Running·Records API 연동

## 1. 배경 및 목적
프로필·온보딩 값은 로컬(`pacebeat-profile`, `pacebeat-onboarding`)에, 러닝 기록은 로컬(`pacebeat:run:records:v1`)에만 저장된다. 로그인 후 서버(`users/me`, `baseline`, `runs`)와 연동하되, **로컬 저장은 즉시 유지되는 1차 저장**이고 서버는 동기화 대상으로 둔다. 서버 연결 실패가 기존 동작을 훼손하지 않아야 한다.

## 2. 작업 범위
**A. 프로필·온보딩·기초 측정**
- 프로필 조회·수정(동의, 러닝 경험, 주간 횟수, 온보딩/프로필 완료 시각 포함)
- 기초 측정 결과 서버 저장·조회(`skipped`, `insufficient_data` 포함)
- 로컬 데이터 → 서버 데이터 이전 정책

**B. Running·Records**
- Running 세션 저장(멱등), 저장 실패 시 로컬 보존과 재시도
- Records 목록·상세 조회, 회고 데이터 수정
- 목표 검증·음악 프리셋·홈 요약의 서버 사용 여부(결정 후)
- 서버 데이터와 기존 화면 표시값의 일관성

## 3. 세부 작업 체크리스트
A. 프로필·온보딩·기초 측정
- [ ] [진행 가능] 로컬↔서버 필드 매핑표 작성(성별 female/male, 경험 beginner/occasional/regular, 주간 1/2/3+, 동의 필수 4개+마케팅 — 값 집합은 일치 확인됨)
- [ ] [진행 가능] 프로필·기초 측정 → 요청 변환 함수와 단위 테스트(페이스 sec/km 정수, 측정 불가는 null, 0으로 채우지 않음)
- [ ] [진행 가능] 프로필 완료 판정(필수 동의 4개 + 유효 닉네임 + completedAt)과 키·몸무게 선택 정책을 **변경하지 않음**을 테스트로 고정
- [ ] [Blocker: Issue 1 B] 프로필 조회·수정을 Query/mutation으로 연결, 실패 시 로컬 유지
- [ ] [Blocker: 정책 미확정] 로컬 값과 서버 값 충돌 시 우선순위, 최초 로그인 시 로컬 프로필 1회 업로드(업로드 후에도 로컬 데이터를 지우지 않음)
- [ ] 기초 측정은 Issue #31(보류)의 범위와 겹치지 않게 기존 구현·정책을 보존하고, 서버 저장 부분만 다룬다

B. Running·Records
- [ ] [진행 가능] `RunRecord` → 서버 저장 요청 변환 함수와 단위 테스트(completion goal/partial/time, TIME 모드는 distance·pace null, 구간·GPS 끊김·회고 포함)
- [ ] [진행 가능] 저장 재시도 설계(같은 `client_session_id` 재전송 시 중복 없음, 로컬 기록 유실 없음)
- [ ] [Blocker: 협의] 멱등 키와 화면 경로 id 결정: 서버 `run_id`(uuid) vs `client_session_id`, 로컬 `recordId`/`sessionId`와의 관계. `/records/:id`, `/growth/posture/:id` 경로에 미치는 영향 정리
- [ ] [Blocker: 협의] 목록 응답 형식, `from`/`to` 형식, 페이지네이션·정렬 확정 후 목록·상세 조회 연결(기존 Records Loading/Empty/Error 상태 정책 유지)
- [ ] 회고 수정(`PATCH reflection`), 메모 100자 제한이 프론트 정책과 일치하는지 확인
- [ ] [Blocker: 정책 미확정] 기존 로컬 기록의 서버 이전·대체 정책 — 미확정이면 구현하지 않는다
- [ ] 자동 일시정지, 세션 저장·복원(24시간 만료), 안내 설정 스냅샷 동작에 영향이 없음을 확인
- [ ] #59(Home↔Running↔Records 로컬 연결)의 표시값과 어긋나지 않는지 확인

## 4. 관련 API endpoint (OpenAPI 1.0.0에서 확인된 것)
- `GET /api/v1/users/me`, `PATCH /api/v1/users/me`
- `GET /api/v1/users/me/baseline`, `PUT /api/v1/users/me/baseline`
- `POST /api/v1/runs` (`client_session_id` 기반 멱등 저장, 201)
- `GET /api/v1/runs` (쿼리 `from`, `to`) — **응답 스키마가 문서에 없음, 확인 필요**
- `GET /api/v1/runs/{run_id}`
- `PATCH /api/v1/runs/{run_id}/reflection`
- (결정 후) `POST /api/v1/runs/targets/validate`, `GET /api/v1/music/presets`(응답 스키마 문서에 없음, 확인 필요), `GET /api/v1/home/summary`

## 5. 주요 수정 예상 영역
`src/features/profile/*`(profileStore, profileFlow), `src/stores/onboardingStore.ts`, `src/stores/measurementStore.ts`·`src/features/measurement/*`, `src/lib/baselineCompletion.ts`, `src/app/completionSync.ts`, `src/features/running/*`(runStorage, runSave, runResultStore, music, goal), `src/features/records/*`, `src/features/home/*`, `src/pages/profile/*`, `src/pages/running/*`, `src/pages/records/*`, `src/pages/my/*`(프로필 수정)

## 6. 선행 조건 및 의존성
- 화면 PR #60~#68이 `develop`에 병합된 후 시작
- **#59(PR #62)가 `develop`에 병합된 후 시작** (#59는 로컬 기록 연결, 이 Issue는 서버 동기화이므로 중복이 아니나 같은 화면을 수정한다)
- Issue 1 완료(A: API Client는 필수, B: Auth는 서버 호출 연결에 필수)
- Issue 3과 하위 작업을 병렬로 진행 가능(Issue 3의 러닝 통계는 이 Issue의 기록 저장 이후)
- 변환 함수·테스트 등 [진행 가능] 항목은 Issue 1 Auth 없이 먼저 진행 가능

## 7. 백엔드 협의 또는 미확정 사항
- 서버 `run_id`와 클라이언트 세션 ID(`client_session_id`)의 관계, 화면 경로 id — **미확정**
- `GET /runs` 응답 형식, `from`/`to` 형식(날짜/date-time), 페이지네이션·정렬 — **미확정**
- 로컬 기록·프로필의 서버 이전·충돌 정책 — **미확정(결정 전 구현 금지)**
- 개별 기록 삭제 endpoint 없음(계정 전체 삭제만) → 기록 삭제 정책은 Issue 3에서 다룸
- 닉네임 중복 규칙 유무(문서에 없음)
- 홈 요약·음악 프리셋·목표 검증을 서버 값으로 쓸지(프론트는 로컬 계산·정적 목록 사용) — **미확정**

## 8. 완료 조건 (Acceptance Criteria)
- 프로필 입력 → 서버 저장 → 재로그인/새로고침 후 같은 값이 보인다. 서버 실패에도 온보딩·프로필 진행과 로컬 값이 유지된다.
- 프로필 완료 조건·키·몸무게 정책과 기존 진입 가드 테스트가 변경 없이 통과한다.
- 러닝 저장 후 서버와 로컬에 같은 기록이 있고, 같은 `client_session_id`로 재전송해도 중복이 생기지 않으며, 저장 실패 시 로컬 기록이 유실되지 않는다.
- Home·Records·결과 화면의 거리·시간·페이스가 서버 값과 일치한다(TIME 기록은 거리·페이스를 표시하지 않음).
- 기존 Running·Records·프로필 테스트가 삭제·약화 없이 통과한다.

## 9. 검증 방법
- 매핑·변환 함수 단위 테스트, 가짜 API로 화면 테스트(Vitest)
- 개발/스테이징 서버와 테스트 계정으로 실제 확인(없으면 운영 서버에 쓰기 요청을 보내지 않고 미검증으로 표기)
- 브라우저에서 저장→새로고침→재진입 확인(가상 GPS는 개발 빌드에서만). 실기기 GPS 검증은 별도 체크리스트로 구분

## 10. 제외 범위 및 주의사항
- 로그인·토큰(Issue 1), Growth·My·자세 리포트(Issue 3)
- 기존 로컬 저장 로직을 한 번에 교체하지 않는다. 이전·대체 정책이 확정되기 전에는 구현하지 않는다.
- GPS·자동 일시정지 로직, 세션 복원 정책, 프로필 완료 조건 변경 금지
- 확인되지 않은 필드·응답 형식을 임의로 확정하지 않는다.
````

#### Issue 3

````markdown
**제목:** [Feat] Growth·My API 연동

## 1. 배경 및 목적
성장 화면은 로컬 기록에서 집계하고, 자세 리포트는 SDK 계약 전이라 항상 No data이며, 안내 설정·데이터 내보내기·삭제는 로컬에서 처리한다. 서버에는 주간/월간 성장 통계, 자세 리포트, 안내 설정, 인솔 상태, 데이터 내보내기·삭제가 있으나 프론트 모델·정책과 차이가 있다. 기존 확정 정책을 보존하면서 서버와 연동한다.

## 2. 작업 범위
**A. 러닝 통계 [Issue 2의 기록 저장 이후 의미 있음]**
- Growth 주간·월간 러닝 통계, 기존 화면과 서버 데이터의 매핑
- 서버 데이터가 없거나 일부 누락(`status`: valid/insufficient_data/no_data 등)일 때의 표시 정책

**B. My 설정·데이터 [Issue 2와 독립]**
- 안내 설정 조회·수정
- 스마트 인솔 상태 조회(등록·해제는 확인 후)
- 데이터 내보내기·삭제

**C. 자세 리포트 [Blocker: SDK 계약 — A·B를 막지 않음]**
- 자세 리포트 데이터 연동. 계약 확정 전에는 매핑 분석 문서까지만.

## 3. 세부 작업 체크리스트
A. 러닝 통계
- [ ] [진행 가능] 서버 버킷(`RunningPeriodBucket`) → 화면 모델 매핑 함수와 단위 테스트. `0`이 아닌 null·status 처리, TIME 기록이 거리 합계·완주 집계에서 빠지는 규칙과 화면의 일치 확인
- [ ] [Blocker: 협의] 주간·월간 시간대와 주 시작 요일 — 확정 전까지 미확정으로 표시
- [ ] 서버 집계를 화면 기준으로 쓸지, 로컬 집계를 유지하고 비교만 할지 결정. 로딩·오류·빈 데이터 상태, 기존 "기록이 부족해요" 상태 유지
- [ ] 기존 Growth 테스트 유지

B. My
- [ ] [진행 가능] 안내 설정 매핑표 작성: 음성 켜짐 ↔ `voice_guidance_enabled`, 진동 ↔ `vibration_guidance_enabled`(프론트는 진동 미지원), 빈도(`perKm`/`offPace`/`both`) ↔ `guidance_frequency_km`(0.5~10, 대응 불명)
- [ ] 서버 필드가 없는 **박자 안내·자동 일시정지**는 제거하지 않고 서버 필드에 억지로 매핑하지 않는다(로컬 유지 또는 백엔드에 필드 추가 요청 — 협의 후 결정)
- [ ] **러닝 시작 시 설정 스냅샷 정책(진행 중 변경은 현재 세션에 영향 없음)과 자동 일시정지 동작을 유지**
- [ ] [Blocker: Issue 1 B] 로컬 설정과 서버 설정의 우선순위·최초 이전
- [ ] [Blocker: 협의] 데이터 내보내기: 응답 형식이 문서에 없음. 확인 전에는 기존 CSV/JSON 내보내기를 유지하고 서버 응답 형식을 임의로 확정하지 않는다. 센서 데이터 기본 제외 정책 유지
- [ ] 삭제: **개별 기록 삭제 endpoint가 없으므로 기존 삭제 정책을 유지**하고, 계정 전체 삭제(`DELETE /users/me`)를 개별 기록 삭제에 사용하지 않는다. 계정 전체 삭제를 연동한다면 사용자 확인 절차, 서버 삭제 실패 시 로컬을 먼저 지우지 않는 순서, 계정(Supabase) 삭제 포함 여부를 협의 후 구현
- [ ] 스마트 인솔 상태 표시: 서버 값만 사용하고 임의 값을 만들지 않는다(기본은 "연결 안 됨"). 실제 BLE 연결은 범위 밖
- [ ] Ready 화면 음성 안내 꺼짐 문구는 현재 임시이므로 디자인 확정 후 반영(`docs/unconfirmed-copy.md`)

C. 자세 리포트
- [ ] [진행 가능] 프론트 `PostureSummary`(measuredSide, balance, pressure)와 서버 `PostureReportPayload`(발별 압력 분포, 하중 비율, 접지 시간, 착지 유형, feedback_items) **차이 분석 문서화** — 코드는 만들지 않는다
- [ ] [Blocker: SDK 계약] SDK 응답 → `PostureSummary` 변환 어댑터. 타입·필드·단위·배열을 임의로 만들지 않는다
- [ ] [Blocker: 협의] 서버 자세 통계(`growth/posture`)를 쓸지 프론트 계산을 유지할지, 서버 `single_foot` 처리가 프론트 정책과 같은지 확인
- [ ] 확정 정책 보존: **최근 28일 집계, 측정별 동일 가중치, 좌우 밸런스는 양쪽 유효 기록만, 한쪽 측정은 압력 분포에만 포함(반대쪽 추정 금지), 최근 7일과 직전 7일의 비중복 비교**를 변경하지 않는다. 품질은 SDK가 줄 때만 표시, "측정 예시"는 예시 데이터에만
- [ ] 좌우 우세·균형 문구의 수치 기준은 미확정(`docs/unconfirmed-copy.md`)이며 임의로 정하지 않는다
- [ ] 데이터가 없거나 서버 오류일 때 No data 유지

## 4. 관련 API endpoint (OpenAPI 1.0.0에서 확인된 것)
- `GET /api/v1/growth/running` (쿼리 `period=weekly|monthly`)
- `GET /api/v1/growth/posture` (쿼리 `period=weekly|monthly`)
- 자세 리포트 저장·조회: `POST /api/v1/runs` 본문의 `posture_report`, `GET /api/v1/runs/{run_id}`의 `posture_report`·`has_posture_report`
- `GET /api/v1/users/me`(guidance 포함), `PATCH /api/v1/users/me/guidance`
- `GET /api/v1/devices/insoles`, `POST /api/v1/devices/insoles`, `PATCH /api/v1/devices/insoles/{side}`, `DELETE /api/v1/devices/insoles/{side}` (등록·변경·해제 연동 여부는 확인 필요)
- `POST /api/v1/users/me/data-export` — 응답 스키마가 문서에 없음, 확인 필요
- `DELETE /api/v1/users/me` (계정·전체 데이터 삭제, 204)

## 5. 주요 수정 예상 영역
`src/features/growth/*`(growthRecords), `src/pages/growth/*`, `src/features/posture/*`, `src/features/running/postureSummary.ts`, `src/features/my/*`(guidanceSettingsStore, dataExport, dataDelete, deleteAction, myView), `src/features/running/runGuidance.ts`, `src/pages/my/*`, `src/pages/running/ReadyPage.tsx`(표시만), `docs/unconfirmed-copy.md`

## 6. 선행 조건 및 의존성
- 화면 PR #60~#68이 `develop`에 병합된 후 시작
- Issue 1 완료(서버 호출 연결은 Auth 필요). 매핑 분석·변환 함수 등 [진행 가능] 항목은 먼저 가능
- A(러닝 통계)는 서버에 기록이 있어야 하므로 Issue 2의 기록 저장 이후. B(My)는 Issue 2와 병렬 가능
- C(자세)는 외부 SDK 계약이 Blocker이며 A·B를 막지 않는다

## 7. 백엔드 협의 또는 미확정 사항
- 주간·월간 버킷의 시간대와 주 시작 요일, 완주율 등 집계 계산식 — **미확정**
- 안내 설정 필드 매핑(박자 안내, 자동 일시정지, 빈도 `offPace` 대응), 서버에 필드를 추가할지 — **미확정**
- 데이터 내보내기 응답 형식(CSV/JSON 여부 포함) — **미확정**
- 개별 기록 삭제 endpoint 필요 여부, 계정 전체 삭제의 즉시/지연 처리와 Supabase 계정 삭제 포함 여부 — **미확정**
- 인솔 등록·상태 갱신의 호출 주체와 시점(실제 기기 연결 전) — **미확정**
- 자세 SDK 계약(필드·단위·구역·품질·한쪽 측정 표현)과 서버 자세 집계의 `single_foot` 처리·평균 규칙 — **미확정(외부 Blocker)**

## 8. 완료 조건 (Acceptance Criteria)
- 같은 기록으로 서버 통계와 화면 값이 일치하거나 차이가 의도로 문서화되어 있다. 데이터 없음·부족·서버 오류가 각각 올바르게 표시된다.
- 안내 설정이 서버·로컬에서 일관되고, 설정 스냅샷·자동 일시정지·박자 안내 설정이 유지된다.
- 삭제는 사용자 확인 후에만 실행되고 실패 시 데이터가 유실되지 않으며, 개별 기록 삭제에 계정 삭제 API를 쓰지 않는다.
- 자세 리포트의 확정 정책(28일, 동일 가중치, 좌우 밸런스, 7일 vs 7일)이 코드·테스트에서 변하지 않았고, SDK 계약 전에는 임의 타입·필드가 추가되지 않았다.
- 기존 Growth·My·자세 리포트·데이터 관리 테스트가 삭제·약화 없이 통과한다.

## 9. 검증 방법
- 매핑·변환 함수 단위 테스트, 가짜 API로 화면 테스트(Vitest), 기존 자세 집계 테스트 유지
- 개발/스테이징 서버와 테스트 계정으로 확인. **삭제·내보내기의 실제 호출은 운영 서버에서 하지 않는다.**
- 가짜 측정 데이터를 앱 코드·실제 저장소에 만들지 않는다(테스트 입력은 테스트 파일 안에만)

## 10. 제외 범위 및 주의사항
- TTS·음악 재생·진동 기능 구현, BLE 인솔 연결, SDK 연동 구현(계약 확정 전)
- 프로필·러닝·기록 연동(Issue 2), 로그인(Issue 1), 화면 UI 변경
- 확정되지 않은 응답 형식·필드·시간대를 임의로 가정하지 않는다.
````

#### Issue 4

````markdown
**제목:** [Test] API 통합 테스트 및 회귀 검증

## 1. 배경 및 목적
Issue 1~3의 연동이 끝난 뒤 인증·네트워크·서버 오류, 로컬/서버 동기화 상황에서 화면과 데이터가 일관되게 동작하고, 기존 로컬 저장 기능에 회귀가 없는지 검증한다.

## 2. 작업 범위
- API Client·인증 테스트
- 프로필·온보딩·기초 측정 연동 테스트
- Running 저장·Records 조회 테스트
- Growth·My 연동 테스트
- 인증 만료, 네트워크 오류, 서버 오류, 유효성(422) 오류 처리
- 중복 요청·저장 실패 시 데이터 보존 검증
- 기존 로컬 저장·복원·내보내기·삭제 기능 회귀
- API 연동 전후 주요 화면 동작 확인

## 3. 세부 작업 체크리스트
- [ ] 기존 테스트 환경(`node --test`, Vitest)과 명령(`npm run test:all`)을 먼저 확인하고 도구를 교체·중복 도입하지 않는다
- [ ] API Client·인증: 토큰 주입, 401 처리, 세션 만료·갱신 실패 시 화면 동작
- [ ] 프로필·온보딩·기초 측정: 저장 성공/실패, 로컬 유지, 완료 조건·키·몸무게 정책 불변
- [ ] Running 저장: 같은 `client_session_id` 재전송 시 중복 없음, 오프라인·실패 후 재전송, 로컬 기록 유실 없음
- [ ] Records: 목록·상세·회고, 서버 값과 Home·결과 화면 표시값 일치, TIME 기록의 거리·페이스 미표시
- [ ] Growth·My: 통계 표시, 데이터 없음·부족·누락, 안내 설정 저장·스냅샷, 자동 일시정지 유지, 내보내기·삭제 흐름
- [ ] 오류 처리: 401/403/404/422/5xx/네트워크/시간 초과 각각의 화면 동작
- [ ] 서버 연동 꺼짐(환경변수 없음) 상태의 전체 화면 회귀
- [ ] 기존 로컬 저장·세션 복원(24시간 만료)·내보내기·삭제 회귀 테스트
- [ ] 가상 GPS는 개발 빌드에서만 사용, 실제 GPS와 섞이지 않음
- [ ] 브라우저에서 360/390/430px 확인
- [ ] 실기기(iPhone) 점검 항목 정리(HTTPS, GPS 권한·수신, 화면 잠금·백그라운드, 복원 등). 실행하지 않은 항목은 미검증으로 표기
- [ ] 발견된 결함은 최소 범위로 수정하거나 후속 Issue로 분리

## 4. 관련 API endpoint
Issue 1~3에서 연동된 endpoint 전체. 연동되지 않은 endpoint는 대상이 아니다. 정확한 목록은 연동 결과에 따라 확인 필요.

## 5. 주요 수정 예상 영역
테스트 파일(`src/**/*.test.ts`, `src/**/*.test.tsx`), `src/test/`, `docs/*`(점검 체크리스트). 결함 수정이 필요하면 해당 기능 영역.

## 6. 선행 조건 및 의존성
- Issue 1·2·3 구현 후 진행
- 화면 PR #60~#68이 `develop`에 병합된 상태
- 개발/스테이징 서버와 테스트 계정(Issue 1 협의 결과). 자세 SDK 연동은 계약이 확정된 경우에만 포함

## 7. 백엔드 협의 또는 미확정 사항
- 개발·스테이징 서버와 테스트 계정 제공 — **미확정**
- 오류 코드 목록(`error_code` 값)과 422 응답 문서 정정 — **미확정**
- 테스트 데이터 정리(삭제) 방법 — **미확정**

## 8. 완료 조건 (Acceptance Criteria)
- 시나리오별 결과가 기록되어 있고, 실패 항목이 없거나 후속 Issue로 분리되어 있다.
- 기존 테스트를 삭제·완화하지 않았고 `npm run test:all`, `tsc`, `eslint`, 프로덕션 빌드가 통과한다.
- 서버 연동 꺼짐/켜짐 모두에서 주요 화면이 정상이다.
- 실제로 확인하지 않은 항목(실기기, 실서버 인증 등)은 완료로 표시하지 않고 미검증으로 남아 있다.

## 9. 검증 방법
- 가짜 fetch/서버 응답 기반 단위·화면 테스트, 기존 회귀 테스트 전체 실행
- 개발/스테이징 서버와 격리된 테스트 계정으로만 통합 확인
- 브라우저 수동 시나리오(저장→새로고침→재진입, 오류 상황), 360/390/430px 확인

## 10. 제외 범위 및 주의사항
- **실제 사용자 데이터나 운영 서버에 영향을 주는 쓰기·삭제 요청을 테스트하지 않는다.** 테스트 데이터는 격리된 테스트 환경에서만 사용한다.
- 신규 기능 구현, 테스트 도구 교체·중복 도입, GPS 정확도 평가
````
