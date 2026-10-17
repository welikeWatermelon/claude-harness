---
description: (프론트) 백엔드 API 계약에서 TypeScript 타입을 다시 생성하고 깨진 곳을 고쳐요
---
1. 타입 생성:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" sync
   ```
   (openapi-typescript 로 `fullstack.frontend.typesOut` 에 생성. 처음이면 npx 가 내려받아요)
2. 타입체크로 깨진 곳 찾기: lockfile 기준 패키지 매니저로 `tsc --noEmit` (또는 typecheck 스크립트).
3. 깨진 곳 처리 원칙
   - API 함수·타입·매핑 코드 → 새 계약에 맞게 수정
   - 화면에 보여주던 값이 사라졌거나 의미가 바뀐 경우 → 임의로 바꾸지 말고 `.harness/pending-decisions.md` 에 결정 항목으로 적고 관련 화면 작업만 보류 (백엔드를 고쳐야 할 수 있음)
4. 백엔드 레포의 `docs/api/API_CHANGES.md` 가 보이면 해당 항목 아래에 프론트 대응 결과를 한 줄씩 적기를 제안하세요.
