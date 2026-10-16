# v1(~/.harness) → v2 옮기기

v1 은 `~/.claude/settings.json` 의 `hooks` 에 전역으로 등록돼 있고, 2026-07-22 부터 `~/.harness/DISABLED` 파일로 꺼져 있어요.
꺼져 있어도 **훅 자체는 매 도구 호출마다 python 을 띄웠다가 바로 종료**하므로, v2 를 쓰기 전에 등록을 빼는 게 좋아요.

## v1 → v2 대응

| v1 | v2 |
|---|---|
| 매 턴 정책문 1,500자 주입 | 모호한 요청일 때만 300자 안내 (C7) |
| 항상 계획 승인 게이트 | `strict` 모드에서만 (C5). 기본은 브랜치·시크릿·파괴 명령만 |
| 보호 브랜치 차단 | 동일 + push 대상 계산, 레포 밖 파일 예외 (C1, C2) |
| Bash 블랙리스트 (Python 정규식) | `shared/lib/bash-rules.mjs` — deny/ask/ok 3단계, v1 오탐 회귀 테스트 |
| 알 수 없는 도구 fail-closed | 등록된 matcher 도구만 검사, 나머지는 통과 |
| `~/.harness/logs` 전역 | 프로젝트별 `.harness/logs` (jsonl, 마스킹) |
| diff 패치 파일 저장 | 파일·줄 수·요청 문장 기록 (실제 diff 는 git 으로) |
| main 자동 동기화 | 동일 (C9) + 뒤처진 커밋 수 표시, HANDOFF 주입 |

## 절차 (사용자가 직접)

1. `~/.claude/settings.json` 을 열어 `hooks` 안에서 `.harness` 경로가 들어간 항목(UserPromptSubmit / PreToolUse / PostToolUse / Stop / SessionEnd / SessionStart)을 지웁니다. 다른 훅(알림 등)은 남기세요.
2. `~/.harness` 폴더는 지우지 말고 그대로 두면 지난 로그를 볼 수 있어요. 필요 없으면 나중에 정리.
3. 프로젝트에서 `/core:doctor` 를 실행해 "v1 하네스 전역 훅 미등록" 이 ✓ 인지 확인.

## 프로젝트별 기존 훅 정리 (선택)

| 프로젝트 | 기존 | v2 에서 |
|---|---|---|
| KEEPING `backend/.claude/settings.json` | post-edit.sh (compileJava) | stack-spring S1 이 대체 → 등록 제거 가능. smoke-build.sh 는 경로가 `/c/keeping` 으로 고정돼 지금은 동작 안 함 |
| MelonMe `.claude/settings.json` | 커밋 시 시크릿 검사(인라인) | core C4 가 대체 |
| bizMap `.claude/hooks/*.sh` | 미등록 상태 | 삭제해도 무방, PROGRESS 안내는 `/workflow:handoff` |
| 도메인 커맨드·에이전트 | 프로젝트 고유 | 그대로 유지 (하네스와 충돌 없음) |
