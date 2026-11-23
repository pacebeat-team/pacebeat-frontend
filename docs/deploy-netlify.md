# Netlify 배포 가이드

배포 설정은 저장소 루트의 `netlify.toml`에 있다. Netlify에서 GitHub 저장소를 연결하면 이 파일을 자동으로 읽는다.

## 1. 빌드 설정 (netlify.toml과 동일 — UI에 따로 입력하지 않아도 되지만 확인용)

| 항목 | 값 |
|---|---|
| Build command | `yarn build` (= `tsc -b && vite build`) |
| Publish directory | `dist` |
| Node 버전 | 22 (`NODE_VERSION`, netlify.toml에 지정. Vite 요구: ^20.19 또는 >=22.12) |
| 패키지 매니저 | yarn v1 (`yarn.lock` 감지) |
| SPA 대응 | `/* → /index.html` 200 rewrite (React Router 새로고침·직접 접속) |
| 캐시 | `/assets/*`는 1년 immutable, `index.html`은 매번 재검증 |

Branch to deploy: **Netlify가 읽을 수 있는 원격(GitHub) 브랜치**. 현재 작업 브랜치 `integration/screens-api`는 로컬에만 있고 미커밋 변경도 있어 Netlify가 빌드할 수 없다. 커밋·푸시(또는 develop 병합)는 사용자가 결정한다.

## 2. 환경변수 (Netlify > Site configuration > Environment variables)

`VITE_` 변수는 빌드 결과(브라우저 번들)에 그대로 들어가는 **공개 값**이다. service_role 키·비밀키는 절대 넣지 않는다. 값을 바꾸면 **재배포(빌드)** 해야 반영된다.

| 이름 | 값 | 상태 |
|---|---|---|
| `VITE_API_BASE_URL` | `https://pacebeat-backend-production.up.railway.app` (끝 슬래시 없이) | 확보됨 |
| `VITE_SUPABASE_URL` | `https://ezwykshzxqiftzmulbrc.supabase.co` | 확보됨 |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon(publishable) 키 | **미수령 — 백엔드 담당자에게 받아야 함** |

anon 키가 없을 때: 배포와 빌드는 막히지 않는다. 앱은 인증 비활성(게스트·로컬 저장) 모드로 동작하며, 로그인과 서버 동기화만 동작하지 않는다. 키는 추측·생성하지 않는다.

## 3. 배포 전 검증 결과 (로컬, 2026-11-23)

- `tsc -b` 통과, ESLint 통과
- Node 테스트 1456/1456 (계정 격리·인증 경계 테스트 `syncIsolation`, `syncBoundary`, `syncStability`, `accountBoundary` 포함)
- Vitest forks 16/16, threads 16/16
- 프로덕션 빌드 성공 (`dist/`: index.html, assets, favicon). 소스맵 없음
- 번들 스캔: `service_role`, JWT 형태(eyJ…), `sk_`, 비밀키, 실제 URL 모두 없음(환경변수 없이 빌드)
- 환경변수 없이 빌드한 번들을 `vite preview`로 띄워 확인: `/records` 등 직접 접속이 동작하고 온보딩이 뜨며, 외부 API 요청이 없다(외부 요청은 Pretendard 폰트 CSS의 jsDelivr 하나뿐)

미수행: 실제 Supabase 로그인, 실제 서버 저장/불러오기, 실기기(iPhone) 확인. 배포 후 아래 4번으로 확인한다.

## 4. 배포 후 확인 경로

새로고침해도 404가 나지 않아야 한다(직접 주소 입력).

- `/` → `/onboarding/intro`
- `/onboarding/permissions`
- `/home`, `/records`, `/records/<id>`
- `/growth`, `/growth/posture`
- `/my`, `/my/profile`, `/my/guidance`, `/my/account`, `/my/data`, `/my/data/export`, `/my/data/delete`
- `/measurement/guide`, `/running/time`
- 존재하지 않는 경로(예: `/zzz`) → 앱의 not-found 처리

환경변수 반영 확인(브라우저 개발자도구 Network): 게스트 상태에서는 API 호출이 없고, 로그인 후에는 `…railway.app` 요청이 `Authorization: Bearer`와 함께 나간다. 콘솔에 토큰이 출력되면 안 된다.

## 5. 백엔드 담당자 요청 (Netlify URL이 정해진 뒤)

1. 백엔드 `CORS_ORIGINS`에 Netlify 주소 추가 (예: `https://<site>.netlify.app`, 사용자 지정 도메인이 있으면 함께). 끝 슬래시와 경로 없이 origin만.
2. Supabase Auth > URL Configuration의 Redirect URLs(필요하면 Site URL)에 같은 주소 추가.
3. `VITE_SUPABASE_ANON_KEY` 전달.
4. 실제 계정으로 API 로그인 → 러닝 기록 저장/불러오기 → 로그아웃 후 게스트 데이터 분리 확인 (프런트의 로그인 연결 방식은 백엔드와 확정 필요).

## 6. 사용자가 직접 할 일 (Netlify)

1. 배포할 코드를 GitHub 원격에 올린다(커밋·푸시 또는 PR 병합).
2. Netlify > Add new site > Import an existing project > GitHub 저장소 선택.
3. 배포 브랜치 선택. Build command와 Publish directory가 위 1번 값으로 채워졌는지 확인.
4. Environment variables에 2번 표의 값 입력(anon 키는 받은 뒤).
5. Deploy. 끝나면 URL을 백엔드 담당자에게 전달하고 4번 경로를 확인한다.

## 7. 지원 범위 (2026-11-24 기준, 코드 구현 ≠ 실서버 검증)

실서버 검증은 아직 0건이다. 아래 "연결됨"은 확정된 계약(OpenAPI 스냅샷)에 맞춰 코드와 모의 서버 테스트로만 확인했다는 뜻이다.

| 기능 | 상태 |
|---|---|
| 이메일/비밀번호 로그인·로그아웃, 세션 복원·토큰 갱신 | 연결됨(Supabase GoTrue). 백엔드가 이 토큰을 검증하는지 **미확인**(백엔드는 HS256+JWT secret, 프로젝트 JWKS는 ES256) |
| 프로필·온보딩 PATCH(바뀐 값만), 기초 측정 | 연결됨 |
| 러닝 기록 저장(재시도·중복 방지), 서버 목록·상세 | 연결됨 |
| 안내 설정 | GET → 4개 항목 모두 유효할 때만 전체 PATCH. 검증 실패 시 보류 |
| 음악 프리셋 | 서버 값은 정렬에만 반영, 로컬 트랙이 기준 |
| 소셜 로그인(OAuth), 회원가입 | 미구현 |
| 개별 기록 삭제, 계정(Auth 포함) 삭제 | 지원 API 없음 — 가짜 호출 만들지 않음 |
| 자세 SDK, BLE 인솔 | 미구현 |
| 홈·성장 집계 | 로컬 기록 기준(서버 통계와 섞지 않음) |

알려진 한계: 안내 설정 GET↔PATCH 사이 경쟁과 여러 탭 동시 수정은 클라이언트에서 완전히 막을 수 없다(마지막 쓴 값이 남음). 이미 서버에 올라간 기록은 앱에서 지울 수 없다.

## 8. 환경변수 없이 빌드한 결과의 의미

환경변수 없이 만든 `dist`는 구조와 비밀값 유출 여부만 확인한 것이다. 운영 환경변수를 넣은 빌드 검증이 아니므로 로그인·서버 동기화는 이 빌드로 확인할 수 없다.

## 9. 외부 대시보드 설정 (배포 전 필요)

- Netlify: 위 2번 환경변수 3개, 배포 브랜치 지정.
- 백엔드(Railway): `CORS_ORIGINS`에 Netlify origin 추가.
- Supabase: Auth > URL Configuration(Site URL, Redirect URLs)에 Netlify 주소 추가, 이메일/비밀번호 로그인 활성 확인, 테스트 계정 준비.
- 백엔드 담당: Supabase 토큰 검증 방식(ES256/JWKS 또는 HS256) 확인.
