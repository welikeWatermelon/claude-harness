---
description: Vue·Nuxt / Android / iOS 프로젝트의 타입체크·컴파일을 한 번에 실행하고 요약해요
---
프로젝트 루트와 하위 폴더에서 프론트·앱 프로젝트를 찾아 실행하세요. 명령을 실행하기 전에 어떤 터미널(Git Bash / PowerShell)에서 무엇을 돌리는지 한 줄로 알려주세요.

- **Vue**: lockfile 로 패키지 매니저 판별 → `typecheck` 스크립트(없으면 `vue-tsc --noEmit`) → `lint` → `build`
- **Nuxt**: `nuxi typecheck` → `lint` → `build`
- **Android** (build.gradle 에 com.android): `gradlew.bat :app:compileDebugSources`(Git Bash 는 `./gradlew`) → `lintDebug` → `testDebugUnitTest`
- **iOS** (.xcodeproj / Package.swift): macOS 면 `xcodebuild -scheme <스킴> -destination 'generic/platform=iOS Simulator' build` 또는 `swift build`. Windows 에서는 빌드할 수 없으니 바뀐 파일을 정적 규칙(I1~I3·X3) 기준으로 훑고 "Mac 빌드 확인 필요"로 보고

각 단계 통과/실패와 실패 원인(파일:라인)을 요약하세요. 이 커맨드에서는 고치지 말고 방향만 제안하세요.
$ARGUMENTS
