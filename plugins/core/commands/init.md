---
description: 현재 프로젝트에 하네스를 적용해요 — 스택 감지, CLAUDE.md 작성, 플러그인 project 범위 등록, 기록 파일 생성
argument-hint: "[spring,react 처럼 스택 강제 지정 (생략하면 자동 감지)]"
---
이 프로젝트에 하네스를 처음 적용합니다. 아래 순서를 그대로 따르세요.

1. **브랜치 확인**: 현재 브랜치가 보호 브랜치(main/master/develop)면 먼저 `git switch -c chore/harness-init` 으로 브랜치를 만드세요.

2. **계획 확인 (변경 없음)**: 아래 명령을 실행해 무엇이 만들어질지 확인하고 사용자에게 요약해 보여주세요.
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" init $ARGUMENTS
   ```
   `$ARGUMENTS` 가 있으면 `--stacks $ARGUMENTS` 형태로 넘기세요.

3. **CLAUDE.md 작성**: 빌드 파일(build.gradle / pom.xml / package.json), 패키지 구조, application.yml, 기존 docs/ 를 읽고 프로젝트 루트 CLAUDE.md 를 작성합니다.
   - 이미 CLAUDE.md 가 있으면 **덮어쓰지 말고** 아래 섹션 중 빠진 것만 추가하는 diff 를 제안하세요.
   - 공통 가드레일(브랜치·시크릿·위험 명령)은 플러그인이 강제하므로 CLAUDE.md 에 다시 쓰지 않습니다.
   - 120줄 이내로, 아래 섹션 구조를 지킵니다.
   ```markdown
   # <프로젝트명>
   ## 개요            (한두 줄: 무엇을 하는 서비스인지, 스택·버전)
   ## 빌드/테스트      (전체 빌드, 단일 테스트, 포맷/린트 명령 — 실제 명령 그대로)
   ## 구조            (모듈/도메인 목록 표, 도메인별 CLAUDE.md 위치)
   ## 컨벤션          (응답 포맷, 예외 처리, 트랜잭션 규칙 등 코드에서 확인된 것만)
   ## 워크플로우 (반드시 준수)
   - 기능 착수 전, "완료 조건 = 통과해야 할 테스트 목록"을 먼저 제시하고 승인받을 것
   - 승인 전에는 코드를 수정하지 말 것
   - 테스트를 먼저 작성하고, 구현 후 테스트 실행 결과(실제 출력)를 보여줄 것
   - 커밋 전 테스트 통과 확인
   ## 기록 규칙
   - 아키텍처/기술 선택 결정 시 docs/decisions.md 에 한 줄 추가 (날짜 | 결정 | 이유)
   - 같은 실수가 두 번 발생하면 docs/failures.md 에 기록하고 재발 방지 방법(훅 승격 여부)을 제안할 것
   ## 컴팩션 지침
   - 컴팩션 시 반드시 보존: 수정 중이던 파일 목록, 테스트 실행 명령, 현재 작업의 완료 조건
   ## 참조 문서
   @docs/decisions.md
   @docs/failures.md
   ```
   - 코드에서 확인하지 못한 내용은 쓰지 마세요. 추측이 필요한 칸은 `TODO(사용자 확인)` 으로 남깁니다.

4. **적용**: 사용자가 승인하면 실행합니다.
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" init --apply $ARGUMENTS
   ```
   그러면 `.claude/harness.json`, `.claude/settings.json`(플러그인 project 범위 등록 + 기본 allow), `.gitignore`, `docs/decisions.md`, `docs/failures.md` 가 준비돼요.

5. **마무리 안내**: 결과 JSON 의 `warning` 이 있으면 그대로 전달하고, 마지막에 아래를 알려주세요.
   - Claude Code 를 다시 열면 스택 플러그인 설치 안내가 뜬다는 것
   - 커밋할 파일: `CLAUDE.md`, `.claude/settings.json`, `.claude/harness.json`, `.gitignore`, `docs/decisions.md`, `docs/failures.md`
