# 백엔드 계약 조사 보고서

- 조사일: 2026-11-24
- 대상: `pacebeat-team/pacebeat-backend` (공개 저장소, 읽기 전용 복제)
- 성격: 조사 전용. 코드 수정·커밋·푸시·Issue/PR 없음. 기존 `docs/api-gap-analysis.md`는 수정하지 않았다.
- 보조 확인(읽기 전용, 데이터 변경 없음): `GET /health` 헤더, `OPTIONS` CORS preflight 몇 개, 공개 Supabase JWKS `GET`. 비밀값은 열람·기록하지 않았다.
- 한계: 저장소 코드와 공개 응답만 근거다. 운영 서버의 실제 환경변수·DB 데이터·Supabase 대시보드 설정은 확인할 수 없다. 실제 Supabase 로그인, 서버 저장, 실기기 확인은 수행하지 않았다.

분류 표기: **일치**(코드와 계약 일치) / **FE**(프론트엔드 수정 필요) / **BE**(백엔드 수정 필요) / **합의**(양쪽 정책 합의 필요) / **확인불가**(저장소만으로 확인 불가능)

## 1. 질문별 확인 결과 (18개)

| # | 질문 | 분류 | 근거와 결론 |
|---|---|---|---|
| 1 | Supabase Auth 로그인 방식·JWT 전달 | 확인불가 + FE | 백엔드에 로그인 엔드포인트가 없다. `app/core/security.py`의 `get_current_user`가 `HTTPBearer`로 `Authorization: Bearer <access_token>`만 받는다. 로그인 방식(이메일/소셜/OTP)은 Supabase 대시보드 설정이라 저장소로 알 수 없다. 프론트엔드에는 로그인 UI가 없고 `auth.setSession`을 호출하는 곳이 없어 동기화 전체가 휴면 상태다. |
| 2 | JWT 알고리즘·검증 방식 | **BE(유력)** | `security.py`는 `algorithms=["HS256"]`, `SUPABASE_JWT_SECRET`, `verify_aud=False`로 검증한다. 그런데 이 Supabase 프로젝트의 공개 JWKS에는 ES256(EC P-256) 키가 하나 있다. 프로젝트가 비대칭 서명 키를 쓴다면 발급 토큰이 ES256이라 HS256 검증이 전부 실패한다. 실제 토큰 `alg` 헤더 확인 전까지는 "유력"이다. |
| 3 | Supabase URL·anon/publishable key | 확인불가 | URL은 `https://ezwykshzxqiftzmulbrc.supabase.co`로 확보됨. anon 키는 저장소에 없다(`.env.example`도 마스킹). 공개용 키이므로 담당자에게 받으면 된다. 추측·생성하지 않았다. |
| 4 | 테스트 계정·데이터 | 확인불가 | `tests/test_domain_rules.py`는 DB 없는 단위 테스트뿐이다. 시드/픽스처 계정은 없다. `sql/001_init_schema_and_rls.sql`의 시드는 음악 프리셋뿐이다. |
| 5 | `client_session_id` ↔ `run_id`, upsert | **일치 + FE 주의** | `run_service.py`의 `upsert_run_session`: `ON CONFLICT (user_id, client_session_id) DO UPDATE`. 같은 `client_session_id`는 같은 행(멱등)이며 `run_id`(`run_sessions.id`)는 서버가 만든다. 갱신되는 필드: `ended_at, elapsed_ms, distance_m, avg_pace_sec_per_km, cadence_spm, step_count, target_pace_keep_ratio_pct, pace_status, cadence_status, gps_gaps, reflection_*`. **갱신되지 않는 필드(최초값 고정)**: `started_at, mode, completion, 목표값, music_track_id`. 구간(`run_splits`)은 삭제 후 재삽입으로 교체된다. 프론트의 `deriveRecordId = rec-${sessionId}`와 충돌하지 않는다. 생성 응답은 항상 201이다(재전송 포함). |
| 6 | `GET /runs` 응답·정렬·필터·페이지네이션 | **일치 (제약 있음)** | `routers/runs.py`의 `list_runs`: 쿼리 `from`, `to`(ISO datetime, `started_at` 기준 양끝 포함), `ORDER BY s.started_at DESC`, **페이지네이션 없음**(전체 반환). 요약 항목에는 구간·회고가 없어 상세 `GET /runs/{id}`가 필요하다. 기록이 많아지면 응답이 커진다(향후 BE 개선 후보). |
| 7 | 프로필 PATCH unset/null/명시 삭제 | **일치** | `users.py`의 `update_my_profile`은 `model_dump(exclude_unset=True)`를 쓴다. 키를 보내지 않으면 유지, `null`을 보내면 해당 컬럼을 null로 갱신(명시 삭제)이다. 프론트는 단계 1에서 이에 맞췄다(미설정 필드 생략, 명시 삭제만 null). |
| 8 | Baseline `quality_status` 허용값·pace 저장 조건 | **일치 (FE 반영 완료)** | 허용값(`MetricStatusType`): `valid, insufficient_data, no_data, gps_poor, single_foot, sensor_disconnected`. `schemas/user.py`의 `enforce_null_when_insufficient`: `skipped`이거나 `quality_status != valid`이면 pace를 null로 강제, `valid_duration_ms < 120000`이면 `insufficient_data`로 바꾸고 pace를 null로 만든다. 따라서 pace를 저장하려면 `quality_status="valid"`와 120초 이상이 필요하다. 프론트는 pace가 계산될 때만 `valid`를 보낸다. 120초 미만이어도 `valid`로 보내면 서버가 강등하므로 안전하다. |
| 9 | Guidance PATCH 전체/부분 | **BE 또는 합의** | `update_my_guidance`는 `GuidanceSettingsPayload` 전체를 받아 4개 컬럼을 모두 `UPDATE`한다(부분 갱신 아님, `exclude_unset` 없음). 프론트가 `voiceGuide`만 보내면 나머지 3개가 스키마 기본값으로 덮인다. 프론트가 항상 4개를 모두 보내거나, 백엔드를 `exclude_unset` 부분 갱신으로 바꿔야 한다. |
| 10 | Home/Growth 기간·타임존·주 시작 | **합의** | Home(`home.py`): 주 시작 = UTC 기준 월요일 0시(`now - timedelta(days=now.weekday())`). Growth(`growth.py`): `weekly`는 최근 7일, 그 외는 30일의 **롤링 윈도우**이며 UTC이고 **버킷이 하나**뿐이다(일/주별 시계열 아님). 한국 사용자(KST) 기준 월요일 경계와 최대 9시간 어긋난다. 정책 결정이 필요하다. |
| 11 | 개별 러닝 삭제 | **BE 필요 (미지원)** | `runs.py`에 DELETE 라우트가 없다. 삭제는 `DELETE /users/me`(전체 데이터 삭제)뿐이다. |
| 12 | 계정 삭제(Supabase Auth 사용자 포함) | **BE 필요** | `delete_my_account_data`: `run_sessions, insole_devices, user_baselines, user_profiles`만 `DELETE`한다. Supabase Auth 사용자는 삭제하지 않으므로 같은 계정으로 다시 로그인할 수 있다. 라우트 이름·응답(204)도 "데이터 삭제"에 가깝다. |
| 13 | Export 실제 형식 | **BE 필요 (부분)** | `POST /users/data-export` → `UserService.export_user_data`가 JSON 딕셔너리를 반환한다(파일 다운로드가 아님). **`run_splits`는 포함되지 않는다.** 화면이 약속하는 내용과 비교 후 결정 필요. |
| 14 | 음악 프리셋 ID·허용값 | **일치** | `GET /music/presets`(`run_repo.list_active_music_presets`)가 `music_presets`의 활성 행을 반환. SQL 시드의 id가 프론트 `MUSIC_TRACKS`의 id와 동일하다. 프론트 `endpoints.ts`의 `musicPresets/list` 응답 타입만 아직 `unknown`이다. |
| 15 | Posture SDK·센서 계약 | **확인불가 + 합의** | 서버는 자세 리포트를 받는 필드(`run_posture_reports`, `has_posture_report`)와 `single_foot`·`sensor_disconnected` 상태를 가질 뿐, SDK·센서 수집은 저장소에 없다. 인솔 SDK와 값의 단위는 담당자 확인이 필요하다. |
| 16 | 인솔 연결 상태 보고 주체 | **합의** | `devices.py`에 등록(POST)/상태 갱신(PATCH `/{side}`)/해제(DELETE) API가 있어 **클라이언트가 보고하는 구조**다(서버는 BLE를 모른다). 프론트가 어느 시점에 보고할지 결정해야 한다. |
| 17 | CORS·Supabase Redirect URL | **BE 필요 + 확인불가** | `app/main.py`의 `CORSMiddleware`는 `settings.CORS_ORIGINS`를 쓰며 `config.py` 기본값은 `["http://localhost:5173"]`다. 운영 프리플라이트 확인에서도 허용 origin이 `http://localhost:5173`뿐이었다. 배포한 프론트 origin은 허용 목록에 추가해야 한다. Supabase Redirect URL은 대시보드 설정이라 확인할 수 없다. |
| 18 | Railway vs Koyeb | **일치(실제=Railway)** | `Dockerfile`/문서는 Koyeb 중심(`${PORT}`)이지만, 실제 운영 URL은 `pacebeat-backend-production.up.railway.app`이다. 코드가 포트 환경변수를 쓰므로 둘 다 동작하나 문서가 실제와 다르다. |

## 2. 추가로 발견한 계약 불일치

1. **JWT 알고리즘 불일치 가능성**(질문 2): 가장 치명적이다. 모든 인증 API가 401이 될 수 있다.
2. **Guidance PATCH가 전체 교체**(질문 9): 부분 전송 시 다른 설정이 기본값으로 초기화된다.
3. **러닝 upsert의 불변 필드**(질문 5): 재전송으로 `started_at, mode, completion, 목표, 음악`은 고칠 수 없다. 프론트는 이 필드를 수정 가능하다고 가정하면 안 된다.
4. **Export에 `run_splits` 누락**(질문 13).
5. **Account delete가 Auth 사용자를 남김**(질문 12).
6. **Growth는 단일 UTC 롤링 버킷**(질문 10): 일별/주별 차트를 그리려면 프론트가 `GET /runs`로 직접 집계해야 한다.
7. **`GET /runs`에 페이지네이션 없음**(질문 6).
8. **쓰이지 않는 중복 서비스**: `growth_service`, `home_service`, `device_service`는 라우터가 쓰지 않는다. 라우터 인라인 SQL이 실제 동작이므로 서비스 코드를 근거로 삼으면 안 된다.
9. **RLS는 백엔드 DB 역할이 우회**한다. 사용자 격리는 쿼리의 `user_id` 조건에 전적으로 의존한다.
10. **테스트 범위**: DB가 필요한 계약(upsert, 삭제, 집계)은 자동 테스트가 없다.

## 3. 백엔드 코드로 확정한 API 계약

- 인증: `Authorization: Bearer <JWT>` (HS256 + `SUPABASE_JWT_SECRET`, aud 미검증). 사용자 id는 토큰에서 얻는다.
- `POST /runs` → 201, 멱등 키 `(user_id, client_session_id)`.
- `GET /runs?from=&to=` → `started_at DESC` 배열, 페이지네이션 없음. `GET /runs/{run_id}`는 상세(구간·gps_gaps 포함).
- `PATCH /runs/{run_id}/reflection`: 회고 갱신.
- `PATCH /users`: `exclude_unset` 부분 갱신, `null`은 명시 삭제.
- `PUT /users/baseline`: `valid`이고 120초 이상일 때만 pace 저장.
- `PATCH /users/guidance`: 4개 필드 전체 교체.
- `POST /users/data-export`: JSON, 구간 제외. `DELETE /users`: 4개 테이블 삭제, 204.
- `GET /music/presets`: 활성 프리셋 목록(id가 프론트와 동일).
- `GET /home/summary`: UTC 월요일 기준. `GET /growth/running`, `/growth/posture`: 7일/30일 롤링, 단일 버킷.
- `devices`: POST/PATCH/DELETE `/{side}`와 요약 GET.
- CORS: 환경변수 `CORS_ORIGINS`, 기본 `http://localhost:5173`.

## 4. 프론트엔드에서 수정할 항목

1. 로그인 UI와 `auth.setSession` 연결(로그인 방식 확정 후). 지금은 동기화 전체가 휴면 상태다.
2. Guidance 동기화가 항상 4개 필드 전체를 보내도록 변경(백엔드 수정 전까지의 안전책).
3. 러닝 재전송 시 불변 필드가 서버에서 무시된다는 가정을 반영(수정 가능 필드와 구분).
4. `endpoints.ts`의 `musicPresets/list` 응답 타입 구체화.
5. 개별 삭제·Export 구간 누락·계정 삭제 시 Auth 사용자 잔존을 화면 문구에 정직하게 반영하거나 해당 기능을 보류.
6. Growth는 서버 집계 대신 로컬/`GET /runs` 집계 여부 결정.
7. `GET /runs` 대량 응답에 대비한 `from/to` 범위 호출.

## 5. 백엔드에서 수정할 항목

1. **JWT 검증**을 실제 토큰 알고리즘에 맞춤(ES256이면 JWKS 검증). 최우선.
2. **CORS_ORIGINS**에 배포한 프론트 origin 추가.
3. 계정 삭제 시 Supabase Auth 사용자도 삭제(관리자 API는 서버 측에서만, 키는 서버에 보관).
4. Guidance PATCH를 `exclude_unset` 부분 갱신으로(합의 후).
5. Export에 `run_splits` 포함.
6. 개별 러닝 삭제 API(필요 시).
7. `GET /runs` 페이지네이션(`limit`/`cursor`) 검토.
8. 배포 문서를 실제(Railway)에 맞춰 수정. DB 필요한 계약 테스트 추가.

## 6. 담당자에게 실제로 물어봐야 하는 질문

1. 운영 Supabase가 발급하는 access token의 `alg`(HS256/ES256)는? 백엔드 검증 방식을 바꿀 계획이 있는가?
2. 지원하는 로그인 방식(이메일/소셜/OTP)과 프론트가 받는 토큰 방식(SDK 사용 여부)은?
3. `VITE_SUPABASE_ANON_KEY`(공개용 키) 전달.
4. 개발·테스트용 계정/데이터가 있는가? 없다면 만들어 줄 수 있는가?
5. Supabase Redirect URL / Site URL에 배포 프론트 주소 등록, `CORS_ORIGINS` 반영 일정.
6. 주/일 경계 타임존 정책(KST 기준 여부)과 Growth 버킷 구조 변경 의향.
7. 계정 삭제 정책(Auth 사용자 삭제 포함 여부)과 개별 삭제 지원 여부.
8. Posture SDK/센서 값의 단위와 인솔 연결 상태를 보고하는 시점·주체.
9. Guidance PATCH를 부분 갱신으로 바꿀 수 있는가.

## 7. API 연동 작업의 새로운 선행 순서

1. **인증 선결**: 질문 1·2·3(토큰 `alg`, 로그인 방식, anon 키)을 확정하고 JWT 검증을 정상화한다. 이것이 풀리기 전에는 다른 모든 연동이 401이다.
2. **환경 정리**: CORS_ORIGINS·Supabase Redirect URL에 배포 origin 등록, 실제 배포 호스트(Railway) 문서 정리.
3. **테스트 계정 확보 후 읽기 전용 스모크**: 로그인 → `GET /users` → `GET /runs`(빈 목록) 확인.
4. **프론트 로그인 연결**: 로그인 UI와 `auth.setSession`, 로그아웃 시 계정 격리(이미 구현된 큐·인증 세대 사용).
5. **쓰기 경로 순차 활성화**: 프로필 → 베이스라인 → 러닝 생성/재전송 → 회고 → 가이던스(전체 필드 전송).
6. **조회 경로**: 러닝 목록/상세 가져오기, 음악 프리셋, Home/Growth(타임존 합의 후).
7. **정책 합의가 필요한 기능**: 개별 삭제, 계정 삭제, Export 범위, Posture/인솔 보고는 합의 이후 단계로 미룬다.
8. 각 단계마다 실제 서버 검증을 별도로 기록한다(현재까지 실서버 검증은 0건).
