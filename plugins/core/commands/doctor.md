---
description: 하네스 설치 상태를 점검해요 (Node, git, 설정 파일, v1 하네스 중복 등록 여부)
---
아래 명령을 실행하고 ✗ 항목마다 해결 방법을 한 줄씩 알려주세요.
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" doctor
```
v1 하네스(~/.harness)의 전역 훅이 아직 `~/.claude/settings.json` 에 등록돼 있다고 나오면, 두 하네스가 동시에 돌아 같은 동작이 두 번 차단될 수 있다고 설명하고 docs/MIGRATION-FROM-V1.md 의 절차를 안내하세요. 사용자 설정 파일은 직접 고치지 말고 안내만 합니다.
