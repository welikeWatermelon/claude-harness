---
description: (프론트·앱) 백엔드 API 계약에서 타입을 다시 생성하고 깨진 곳을 고쳐요 (웹 TS / iOS Swift / Android Kotlin)
---
1. 타입 생성:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" sync
   ```
   - `fullstack.frontend.language` = `ts`(기본): openapi-typescript 로 `typesOut` 에 생성 (처음이면 npx 가 내려받아요)
   - `swift`: 명세를 `swiftSpecOut` 으로 복사 + `openapi-generator-config.yaml` 이 없으면 생성 → Xcode 빌드 때 swift-openapi-generator 가 코드 생성
   - `kotlin`: 명세를 `kotlinSpecOut` 으로 복사 → openapi-generator Gradle 태스크로 생성
2. 깨진 곳 찾기:
   - ts: lockfile 기준 패키지 매니저로 `tsc --noEmit` (또는 typecheck 스크립트)
   - kotlin: `./gradlew compileDebugKotlin` (Windows: `gradlew.bat`)
   - swift: Windows 에서는 빌드할 수 없어요 → 바뀐 스키마·필드 이름으로 `.swift` 사용처를 Grep 해서 고치고, Mac 빌드 확인을 결정 대기 목록에 남기세요
3. 생성된 파일(`generated/`, `DO NOT EDIT` 표시)은 직접 고치지 않아요 — 하네스가 막아요(F1).
4. 깨진 곳 처리 원칙
   - API 함수·타입·매핑 코드 → 새 계약에 맞게 수정
   - 화면에 보여주던 값이 사라졌거나 의미가 바뀐 경우 → 임의로 바꾸지 말고 `.harness/pending-decisions.md` 에 결정 항목으로 적고 관련 화면 작업만 보류 (백엔드를 고쳐야 할 수 있음)
5. 백엔드 레포의 `docs/api/API_CHANGES.md` 가 보이면 해당 항목 아래에 프론트 대응 결과를 한 줄씩 적기를 제안하세요.
