# P!PACE (피페이스) Frontend

> 스마트 인솔 기반 실시간 러닝 코칭 & 러닝 데이터 분석 모바일 웹 서비스 **P!PACE** 프론트엔드 레포지토리입니다.

---

## 🏃‍♂️ 프로젝트 소개

**P!PACE**는 러너의 보폭, 균형, 압력 등 인솔 센서 데이터를 실시간으로 측정하여 최적의 페이스를 코칭하고, 러닝 기록 및 성장을 시각화해주는 모바일 웹 애플리케이션입니다.

- **Figma 기준 해상도**: `390 x 844`
- **반응형 대응 폭**: `360px ~ 430px` 모바일 뷰포트 지원
- **OS/브라우저 Safe-Area 대응**: 노치 및 홈 인디케이터 영역 완벽 처리 (`viewport-fit=cover`, `env(safe-area-inset-*)`)

---

## 🛠️ 기술 스택

| 분류 | 기술 |
| :--- | :--- |
| **Core** | React 19, TypeScript, Vite 8 |
| **Routing** | React Router 7 (`createBrowserRouter`) |
| **State Management** | Zustand |
| **Data Fetching** | TanStack Query v5 (`@tanstack/react-query`), Axios |
| **Styling** | TailwindCSS v4 (`@tailwindcss/vite`) |
| **Typography** | Pretendard (한글), Poppins (영문/숫자) |
| **Package Manager** | Yarn (v1.22.22) |
| **Lint & Formatting** | ESLint 9 (Flat Config), Prettier |

---

## 📂 프로젝트 구조

```text
src/
├── app/
│   └── router.tsx             # React Router 설정 (루트 및 5개 탭 라우팅)
├── assets/
│   └── videos/                # 스플래시 인트로 영상 및 포스터 에셋
├── components/
│   ├── common/
│   │   └── BottomNavigation.tsx  # 366x70 플로팅 하단 네비게이션 바
│   └── layout/
│       ├── AppLayout.tsx         # 모바일 공통 레이아웃 (Safe-Area, 여백 제어)
│       └── PageContainer.tsx     # 좌우 기본 패딩(12px) 래퍼 컴포넌트
├── pages/
│   ├── SplashPage.tsx         # 2단계 스플래시 인트로 화면
│   ├── HomePage.tsx           # 홈 화면
│   ├── RunningPage.tsx        # 러닝 화면
│   ├── RecordsPage.tsx        # 기록 화면
│   ├── GrowthPage.tsx         # 성장 화면
│   └── MyPage.tsx             # 마이 화면
├── styles/
│   └── globals.css            # TailwindCSS v4, 폰트 및 모바일 리셋
├── App.tsx                    # RouterProvider 진입점
└── main.tsx                   # ReactDOM 렌더링
```

---

## ✨ 핵심 구현 기능

### 1. 공통 모바일 레이아웃 (`AppLayout`)
- `w-full max-w-[390px] min-h-dvh mx-auto bg-[#FEFEFE]`
- 기기 상하단 safe-area 패딩 자동 적용 (`pt-[env(safe-area-inset-top)]`, `pb-[calc(102px+env(safe-area-inset-bottom))]`)
- 스크롤 시 고정 하단 네비게이션에 콘텐츠가 가려지지 않도록 충분한 클리어런스 확보
- 360px 기기에서도 가로 스크롤이 발생하지 않도록 방어 (`overflow-x-hidden`)

### 2. 하단 네비게이션 (`BottomNavigation`)
- 크기 `366 x 70`, 캡슐형 플로팅 디자인 (`rounded-[35px]`)
- 반응형 너비 `w-[calc(100%-24px)] max-w-[366px]`
- React Router `pathname` 기반 활성 탭 자동 감지
- 선택된 탭에만 브랜드 라임 컬러(`#C6F135`) 적용 (별도 배경 채움 없음)
- 5개 메인 탭: **홈**(`/home`), **러닝**(`/running`), **기록**(`/records`), **성장**(`/growth`), **마이**(`/my`)

### 3. 스플래시 화면 (`SplashPage`)
- **1단계 (`SPLASH / 01`)**: 마스코트 눈 깜빡임 영상(`splash-original.mp4`) 인라인 자동재생 (`autoPlay`, `muted`, `playsInline`)
- **2단계 (`SPLASH / 02`)**: 영상 종료(`onEnded`) 시 마스코트 + `P!PACE` 볼드 텍스트 로고 화면으로 매끄럽게 전환
- **3단계 (`HOME`)**: 피그마 인터랙션 명세에 따라 0.8초 후 홈 화면(`/home`) 자동 진입
- **안정성 (Fallback)**: 브라우저 자동재생 차단 또는 영상 오류 발생 시 즉시 로고 단계 및 홈으로 안전하게 우회 진입

---

## 🚀 시작 가이드

### 1. 패키지 설치
```bash
yarn install
```

### 2. 개발 서버 실행
```bash
yarn dev
```
기본 로컬 주소: `http://localhost:5173`

### 3. 프로덕션 빌드
```bash
yarn build
```
TypeScript 컴파일(`tsc -b`) 및 Vite 프로덕션 번들링이 수행됩니다.

### 4. 린트 검사
```bash
yarn lint
```

---

## 🎨 디자인 가이드

- **배경색**: `#FEFEFE`
- **브랜드 라임**: `#C6F135`
- **네비게이션 다크**: `#1E1E22`
- **비활성 텍스트/아이콘**: `#8E8E93`
- **기본 좌우 여백**: `12px` (`PageContainer` 기본값)
