# 로드맵

## 지금 (v2.3)
- [x] 코드 규칙 엔진: 신규 위반만, 규칙별 off/warn/block (`rules`)
- [x] stack-spring S1~S22 (KEEPING failures.md 사고 4건을 규칙으로 승격), stack-react R1~R11
- [x] fullstack F1~F10: 생성 파일·스냅샷 보호, ErrorCode·enum·응답 래퍼 변경 경고, 성공 응답·경로 버전·format 비교, oasdiff 연동, PR 계약 검사 워크플로, iOS·Android 프론트
- [x] stack-backend (Node·Python·Go·비Spring JVM), stack-frontend (Vue·Nuxt·Android·iOS), 스택 감지 확장

## v2.2
- [x] fullstack 플러그인: 분리 레포 API 계약 연동 (springdoc 명세 비교, 프론트 사용처, 명세 작성·계약 리뷰 에이전트)
- [x] 결정 미루기: 작업 도중 질문 차단 → 대기 목록 → 마지막에 한 번에 질문, /workflow:decide
- [x] 다른 레포 파일 수정 시 그 레포의 보호 브랜치 적용

## v2.1
- [x] 계획 게이트를 팀원 한정으로 (planGate.requiredFor), 승인 범위를 계획 파일 단위로, 종료 조건 6가지

## v2.0
- [x] core / workflow / stack-spring / stack-react / ops 플러그인
- [x] 규칙·훅 통합 테스트, CI, `claude plugin validate --strict`

## 다음 후보 (우선순위 순)
1. **규칙 오탐 튜닝** — `/core:log` 의 `rule` 이벤트로 규칙별 발생 수를 보고, 오탐이 많은 규칙은 기본 강도를 낮추거나 패턴 수정
2. **Windows 실사용 검증** — 사용자 PC 에서 KEEPING 으로 1주 운영, `/core:log` 의 차단 통계로 오탐 확인
3. **팀 배포 안정화** — 팀 프로젝트는 태그 고정 (`extraKnownMarketplaces` 를 `git` 소스 + `ref: v2.0.0` 으로), GitHub 레포 권한 Read, main 보호 규칙
4. ~~plan 범위 이탈 차단~~ — v2.1 에서 구현 (계획 게이트 파일 범위, 팀원 한정)
5. **에러 자동 수정 파이프라인** — 로컬 감시 스크립트가 서버 로그 지문을 모아 `claude -p` 로 재현 테스트 → 수정 → `fix/` 브랜치 PR (머지는 사람). ops 플러그인 + night 모드 조합
6. **PR 자동 리뷰** — GitHub Actions 에서 `claude -p` 로 spring-reviewer 실행, 코멘트
7. **k6 성능 게이트** — perf-investigator 가 만든 thresholds 를 CI 로 (KEEPING 예정 작업 ①②)
8. **하네스 효과 측정** — 차단 횟수, Stop 재시도 횟수, 첫 시도 빌드 통과율을 주간 리포트로 (claudeGrass analyze 와 연결)
