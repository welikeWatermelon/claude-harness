---
name: hook-promotion
description: Claude 가 같은 실수를 반복하거나, CLAUDE.md 규칙이 지켜지지 않을 때 사용. 그 규칙을 "확률적 권고(CLAUDE.md)"에서 "결정적 관문(훅)"으로 올릴지 판단하고 훅 규칙 초안을 만든다.
---
# 규칙을 훅으로 승격하기

CLAUDE.md 는 **확률적 권고**(모델이 읽고 따를 수도 안 따를 수도), 훅은 **결정적 관문**(코드가 매번 검사)이에요.

## 승격 기준 (하나라도 해당하면 훅)
- 위반 시 되돌리기 어렵다 (데이터 손실, 배포, 시크릿 노출, 히스토리 파괴)
- 같은 위반이 2회 이상 나왔다 (docs/failures.md)
- 기계적으로 판별 가능하다 (경로·명령·정규식·빌드 결과)

## 어느 이벤트에 거나
| 막고 싶은 것 | 이벤트 | 결과 |
|---|---|---|
| 특정 도구 호출 자체 | PreToolUse | deny / ask |
| 수정 결과의 형식·컴파일 | PostToolUse | Claude 에게 오류 전달 (exit 2 / additionalContext) |
| "끝났다"는 주장 | Stop | decision:block + 이유 → 이어서 고치게 함 (루프 상한 필요) |
| 요청 단계의 누락 | UserPromptSubmit | 짧은 안내 주입 |
| 컴팩션 때 잃는 것 | PreCompact + SessionStart(compact) | 스냅샷 저장·재주입 |

## 초안 형식
```
규칙 ID: <kebab-case>
이벤트/매처: PreToolUse / Bash
조건: <정규식 또는 판별 로직>
결과: deny | ask | block
메시지: <Claude 가 보고 바로 행동을 바꿀 수 있는 한국어 문장 — 대안 명령 포함>
오탐 예시: <걸리면 안 되는 명령>   ← 반드시 적기 (v1 에서 docker exec, --format 오탐이 있었음)
테스트: tests/ 에 통과/차단 케이스 각각 1개 이상
```
모든 프로젝트 공통이면 claude-harness 레포 `shared/lib/bash-rules.mjs` 또는 해당 플러그인 스크립트에, 프로젝트 한정이면 `.claude/harness.json` 설정 확장으로 제안해요.
