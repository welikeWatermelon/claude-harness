# 로드맵

## 지금 (v2.0)
- [x] core / workflow / stack-spring / stack-react / ops 플러그인
- [x] 규칙·훅 통합 테스트, CI, `claude plugin validate --strict`

## 다음 후보 (우선순위 순)
1. **Windows 실사용 검증** — 사용자 PC 에서 KEEPING 으로 1주 운영, `/core:log` 의 차단 통계로 오탐 확인
2. **팀 배포 안정화** — 팀 프로젝트는 태그 고정 (`extraKnownMarketplaces` 를 `git` 소스 + `ref: v2.0.0` 으로), GitHub 레포 권한 Read, main 보호 규칙
3. **plan 범위 이탈 경고** — strict 모드에서 승인된 계획에 없는 파일을 수정하면 ask (v1 README 의 v2 후보)
4. **에러 자동 수정 파이프라인** — 로컬 감시 스크립트가 서버 로그 지문을 모아 `claude -p` 로 재현 테스트 → 수정 → `fix/` 브랜치 PR (머지는 사람). ops 플러그인 + night 모드 조합
5. **PR 자동 리뷰** — GitHub Actions 에서 `claude -p` 로 spring-reviewer 실행, 코멘트
6. **k6 성능 게이트** — perf-investigator 가 만든 thresholds 를 CI 로 (KEEPING 예정 작업 ①②)
7. **하네스 효과 측정** — 차단 횟수, Stop 재시도 횟수, 첫 시도 빌드 통과율을 주간 리포트로 (claudeGrass analyze 와 연결)
