---
name: frontend-conventions
description: Vue·Nuxt 웹, Android(Kotlin), iOS(Swift) 화면·상태·네트워크 코드를 새로 만들거나 구조를 바꿀 때 사용. 프로젝트 CLAUDE.md 가 우선.
---
# 프론트·모바일 컨벤션 (프로젝트 규칙이 있으면 그것이 우선)

## Vue 3 / Nuxt 3
- `<script setup lang="ts">` + `defineProps<T>()`/`defineEmits<T>()`
- 서버 상태는 composable(`useXxx`)이나 Pinia 스토어로, 컴포넌트에서 fetch/axios 직접 호출 금지
- props 는 읽기 전용 → `emit` 또는 `defineModel`
- `v-for` 에는 고유 `:key`, `v-html` 은 정화된 값만
- Nuxt: 비밀값은 `runtimeConfig`(서버 전용), 공개값만 `runtimeConfig.public`

## Android (Kotlin)
- UI 상태는 ViewModel 의 `StateFlow`, 화면은 `collectAsStateWithLifecycle`/`repeatOnLifecycle` 로 수집
- 코루틴은 `viewModelScope`/`lifecycleScope`, I/O 는 `Dispatchers.IO`
- `!!` 대신 `?.`/`?:`, API 주소·키는 `BuildConfig`(flavor 별)
- 토큰은 암호화 저장소, Logcat 에 남기지 않기
- 빌드 확인: `gradlew.bat :app:compileDebugSources` (PowerShell/Git Bash 모두 가능)

## iOS (Swift)
- UI 갱신은 `@MainActor`, 비동기는 async/await + `Task` 취소 처리
- 옵셔널은 `guard let`/`if let`/`??`, `try!`·`as!` 금지
- 클로저에서 `[weak self]`, delegate 는 `weak var`
- 토큰은 Keychain, API 주소·키는 `.xcconfig`(커밋 안 하는 파일) → Info.plist 로 주입
- Windows 에서는 빌드할 수 없어요: 정적 규칙만 걸리니 Mac 에서 Xcode 빌드 확인을 결정 대기 목록/인수인계에 남기세요

## 하네스가 자동으로 거는 규칙 (stack-frontend)
| ID | 내용 | 기본 |
|---|---|---|
| V1 / V2 / V3 | v-html / v-for 에 :key 없음 / props 직접 변경 | 경고 |
| W3 | 이유 없는 eslint-disable·@ts-ignore | 차단 |
| W4 / W6 / W8 | any / API 주소 하드코딩 / 컴포넌트에서 fetch·axios | 경고 |
| W7 | VITE_·NUXT_PUBLIC_ 이름에 SECRET·PASSWORD 등 | 차단 |
| A1 / A2 / A3 | `!!` / GlobalScope / runBlocking | 경고 |
| A4 / A5 | 민감정보 Log / URL 하드코딩 | 경고 |
| I1 / I2 / I3 | 강제 언래핑·try!·as! / 민감정보 print / DispatchQueue.main.sync | 경고 |
| X1 | local.properties·google-services.json·keystore·GoogleService-Info.plist·.xcconfig 수정 | 확인 |
| X3 | 하드코딩된 API 키·비밀값 | 차단 |

강도는 `.claude/harness.json` 의 `"rules": { "I1": "off" }` 처럼 바꿀 수 있어요.
