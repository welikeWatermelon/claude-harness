---
description: 언제·어떤 요청으로·어떤 파일이 바뀌었는지 변경 이력을 찾아줘요
argument-hint: "[건수 또는 검색어]"
---
변경 이력은 `.harness/logs/YYYY-MM-DD.jsonl` 에 있어요 (type: prompt / file_change / command / guard / plan_approved / mode_change / verify).

- 인자가 숫자면: `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" log $ARGUMENTS`
- 인자가 검색어면: `.harness/logs/` 의 jsonl 을 Grep 으로 검색하고, 시간순으로 "요청 → 바뀐 파일" 흐름을 정리해 주세요.
- 인자가 없으면 최근 20건.

결과는 "시각 | 요청 | 바뀐 파일" 표로 보여주세요.
