---
description: 도메인별 CLAUDE.md 와 도메인 전담 서브에이전트를 만들어요 (KEEPING 방식의 계층형 컨텍스트)
argument-hint: "[도메인 이름들, 생략 시 전체]"
---
도메인 경계가 명확할수록 AI 가 엉뚱한 곳을 덜 건드려요. KEEPING 에서 쓰던 구조를 만듭니다.

1. 도메인 패키지를 나열하고(`**/domain/*/` 또는 최상위 기능 패키지), 각 도메인에 대해 Read/Grep 으로 확인:
   - 담당 파일 범위, 핵심 엔티티·상태 전이, 사용하는 ErrorCode, 다른 도메인과의 호출 관계(누가 누구를 부르나), 락·멱등성·외부 API
2. 도메인마다 `<도메인 패키지>/CLAUDE.md` (40줄 이내):
   ```markdown
   # <도메인> 
   ## 담당 범위
   ## 핵심 규칙 (코드에서 확인한 것만)
   ## 교차 도메인 (호출 방향, 공개 API)
   ## 주의 (건드리면 안 되는 것)
   ```
3. 도메인마다 `.claude/agents/<도메인>-agent.md`:
   ```markdown
   ---
   name: <도메인>-agent
   description: Use when working on files under <경로>. <도메인 한 줄 설명>
   model: sonnet
   ---
   담당: <경로>
   시작 전 필독: <도메인 CLAUDE.md>, <관련 도메인 CLAUDE.md>
   핵심 규칙 요약 / 교차 도메인 / 주의
   ```
4. 루트 CLAUDE.md 의 "구조" 섹션에 도메인 인덱스 표를 추가하는 diff 를 제안.
전부 만들기 전에 도메인 목록과 관계도를 먼저 보여주고 승인받으세요. 코드에서 확인 못 한 규칙은 쓰지 마세요.
