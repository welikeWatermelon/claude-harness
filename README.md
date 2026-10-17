# claude-harness

Claude Code 를 "코드 생성기"가 아니라 **통제·검증되는 작업자**로 쓰기 위한 개인 하네스.
GitHub 레포 하나가 Claude Code **플러그인 마켓플레이스(`yj-harness`)** 이고, 프로젝트마다 필요한 플러그인만 **project 범위**로 켭니다.

| 플러그인 | 무엇을 하나 | 언제 켜나 |
|---|---|---|
| **core** | 보호 브랜치·위험 명령·시크릿 차단, 작업 모드(standard/strict/night/readonly/ops), 변경 이력, main 자동 동기화, 컴팩션 스냅샷, `/core:init` | 모든 프로젝트 |
| **workflow** | 논리 단위 커밋, PR 설명, 인수인계, 결정·실패 기록, 완료 조건 합의, 무인 실행 프롬프트 세트, worktree / plan-critic·verifier 에이전트 | 모든 프로젝트 |
| **stack-spring** | 코드 규칙 S1~S22, Java 편집 시 컴파일, 끝내기 전 빌드 검증, Flyway 보호 / 리뷰·테스트·성능 에이전트, 스킬 5개 (Gradle 우선, 없으면 Maven) | Spring Boot |
| **stack-react** | 코드 규칙 R1~R11 (편집 시 eslint --fix, 끝내기 전 타입체크·관련 테스트) / 리뷰 에이전트, 스킬 2개 | React·Next |
| **stack-backend** | Spring 이 아닌 백엔드 — Node(Express/NestJS)·Python(FastAPI/Django)·Go·Kotlin/Java: 규칙 B1~B11, 마이그레이션 보호, 끝내기 전 타입체크·컴파일·vet / 리뷰 에이전트 | 그 외 백엔드 |
| **stack-frontend** | React 가 아닌 프론트 — Vue·Nuxt, Android(Kotlin), iOS(Swift): 규칙 V·A·I·W·X, 앱 설정 파일 보호, 끝내기 전 vue-tsc·Gradle 검증 / 리뷰 에이전트 | 그 외 프론트·앱 |
| **ops** | 원격 명령 감사 로그·파괴 명령 차단·prod 확인 / 배포 점검·로그 분석 에이전트 | 서버 작업하는 프로젝트 |
| **fullstack** | 백엔드·프론트 분리 레포의 API 계약 연동: springdoc 명세 생성·비교(oasdiff 있으면 사용), 웹·iOS·Android 사용처 추적, 규칙 F1~F10, PR 계약 검사 워크플로 / 명세 작성·계약 리뷰 에이전트 | 백엔드 레포와 프론트 레포 양쪽 (`/fullstack:setup`) |

요구사항: Claude Code, **Node.js 18+** (훅이 node 로 실행돼요), git.

---

## 설치

**① PC 마다 한 번** — Claude Code 안에서
```
/plugin marketplace add welikeWatermelon/claude-harness
```

**② 프로젝트마다 한 번** — 그 프로젝트 폴더에서 연 Claude Code 안에서
```
/plugin install core@yj-harness        → 범위: project 선택
/core:init
```
`/core:init` 이 스택(Spring / React / 그 외 백엔드 / 그 외 프론트)을 감지해서 `CLAUDE.md` 를 코드 기준으로 작성하고, `.claude/settings.json` 에 필요한 플러그인(core·workflow·stack-*)을 등록해요. Claude Code 를 다시 열면 나머지 플러그인 설치 안내가 뜹니다. 생긴 파일을 커밋하세요.

**③ 팀원** — clone 후 그 폴더에서 Claude Code 실행 → 설치 안내 승인. 팀원의 다른 프로젝트에는 영향 없어요.

**④ 하네스를 고친 뒤** — 레포에 push 하고, 각 PC 의 Claude Code 안에서
```
/plugin marketplace update yj-harness
```
(`/plugin` → Marketplaces → yj-harness → Enable auto-update 를 켜두면 생략 가능)

> 터미널에서 하려면 (PowerShell/Git Bash, 프로젝트 루트):
> `claude plugin install core@yj-harness --scope project`

---

## 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `/core:mode night` | 자기 전에. 파일 편집만 허용, 빌드·테스트·서버·git 쓰기 차단 |
| `/core:mode strict` | 본인에게 계획 게이트 켜기 (승인 전 수정 차단, 승인 후엔 계획 파일만) |
| `/core:plan-done` | 승인받은 계획 끝내기 |
| `/core:mode readonly` | 분석만 |
| `/core:mode standard` | 기본으로 복귀 |
| `/core:status` · `/core:log` | 현재 상태 · 언제 어떤 요청으로 무엇이 바뀌었나 |
| `/workflow:done <작업>` | 완료 조건(통과할 테스트 목록) 먼저 합의 |
| `/workflow:decide` | 자리 비운 사이 모인 결정을 한 번에 정리하고 보류 작업 재개 |
| `/fullstack:setup` · `:spec` · `:api-sync` · `:feature` | 레포 연결 · 명세 생성·비교 · 프론트 타입 갱신 · 기능 끝까지 구현 |
| `/workflow:commit` | 논리 단위로 나눠 커밋 (계획 먼저 보여줌) |
| `/workflow:handoff` | 다른 노트북에서 이어받을 인수인계 작성 |
| `/workflow:failure <실수>` | 실패 기록 + 훅 승격 검토 |
| `/workflow:night-prompt <목표>` | 무인 실행용 프롬프트 세트 생성 |
| `/stack-spring:domain-map` | 도메인별 CLAUDE.md + 전담 에이전트 생성 |
| `/ops:deploy-check` · `/ops:triage` · `/ops:audit` | 배포 점검 · 에러 분석 · 원격 명령 감사 |

---

## 막히면 미뤄두고 계속하기

작업 도중 사람의 결정이 필요하면 Claude 는 바로 묻지 않고 `.harness/pending-decisions.md` 에 적은 뒤, 그 결정과 겹치는 작업만 보류하고 나머지를 끝까지 해요. 작업 시작 후의 중간 질문(AskUserQuestion)은 하네스가 막고, 모든 작업이 끝나면 Stop 훅이 "이제 한 번에 질문하세요" 차례를 열어줘요. 자리를 비웠다 돌아오면 `/workflow:decide`. (계획 단계 질문은 허용, `deferQuestions:false` 로 끌 수 있음)

## 설정 (`.claude/harness.json`, 개인은 `.claude/harness.local.json`)
```json
{
  "protectedBranches": ["main", "master", "develop"],
  "defaultMode": "standard",
  "planGate": { "requiredFor": ["newbie@team.com"], "ttlHours": 3 },
  "spring": { "compileOnEdit": true, "verifyOnStop": "compile" },
  "react": { "verifyOnStop": "typecheck" },
  "ops": { "allowedHosts": ["10.0.1.12"], "prodKeywords": ["prod"] }
}
```
- `planGate.requiredFor`: 여기 적은 팀원(git user.email 또는 user.name)만 **파일 수정 전 계획 승인**이 필요해요. 비워두면 아무에게도 강제하지 않아요. 승인 후엔 계획의 `## 변경 파일` 목록을 3시간 동안(또는 `/core:plan-done`·새 계획·브랜치 변경까지) 계속 수정할 수 있어요.

전체 기본값: `shared/lib/config.mjs` 의 `DEFAULTS`.

---

## 코드 규칙 (v2.3)

수정할 때마다 훅이 **이번 수정으로 새로 생긴 위반만** 검사해요 (기존 코드 때문에 작업이 막히지 않게).
- **차단(block)**: 수정 자체를 거부하고 이유를 Claude 에게 돌려줘요 → 고쳐서 다시 수정
- **경고(warn)**: 수정은 되고, 바로 다음에 Claude 에게 알려줘요 → 이번 작업 범위면 바로 고침
- **확인(ask)**: 사용자에게 물어봐요 (설정·키 파일)

강도는 프로젝트마다 바꿀 수 있어요 — `.claude/harness.json`:
```json
{ "rules": { "S6": "off", "R4": "block", "B7": "warn" } }
```

| 플러그인 | 차단 | 경고 / 확인 |
|---|---|---|
| stack-spring | S5 Boot3 에서 javax.* · S15 운영 ddl-auto·운영 init 에 테스트 SQL · S17 Lombok 의존성 없이 lombok | S1 같은 클래스 호출로 @Transactional 무효 · S2 트랜잭션 안 상태 변경 후 throw · S3 직접 할당 @Id + Persistable 없음 · S4 Redis 모델 계산 메서드 @JsonIgnore · S6 필드 주입 · S7 엔티티 반환 · S8 컨트롤러/private @Transactional · S9 EAGER · S10 다른 도메인 Repository · S11 리스너 재발행 · S12 트랜잭션 안 외부 호출 · S13 민감정보 로그 · S14 메트릭 고유값 태그 · S16 open-in-view · S18 끝낼 때 테스트 없음 · S19~S22 리뷰 에이전트 |
| stack-react | R3 이유 없는 eslint-disable·@ts-ignore · R7 공개 환경변수에 비밀값 · R9 'use client' 의 서버 코드 · R11 관련 테스트 실패 | R1 eslint --fix 후 남은 오류 · R2 eslint/tsconfig 수정(확인) · R4 any · R5 console.log · R6 API 주소 하드코딩 · R8 컴포넌트에서 fetch/axios · R10 리뷰 에이전트 |
| stack-backend | B2 커밋된 마이그레이션 수정 · B3 하드코딩 비밀값 | B1 SQL 문자열 조합 · B4 민감정보 로그 · B5 eval/shell=True/yaml.load/pickle · B6 bare except·가변 기본 인자 · B7 Go 에러 무시 · B8 cors()·에러 상세 응답 · B9 DEBUG=True · B10 테스트 없음 · B11 Kotlin !!·runBlocking |
| stack-frontend | W3 · W7 · X3 하드코딩 키 | V1 v-html · V2 v-for :key · V3 props 변경 · W4/W6/W8 · A1 !! · A2 GlobalScope · A3 runBlocking · A4 민감정보 Log · A5 URL 하드코딩 · I1 강제 언래핑·try!·as! · I2 민감정보 print · I3 main.sync · X1 앱 설정·키 파일(확인) |
| fullstack | F1 생성 파일 수정 · F2 계약 스냅샷 직접 수정 | F3 ErrorCode 삭제(프론트 사용처 표시) · F4 공통 응답 래퍼 변경 · F5 enum 값 변경 · F6 성공 응답 코드·경로 버전 변경 · F7 format·int64 정밀도 · F8 oasdiff · F9 `/fullstack:ci` · F10 iOS·Android 앱 |

자세한 동작은 [docs/HOOK-SPEC.md](docs/HOOK-SPEC.md).

## 개발

```bash
# 공통 코드는 shared/lib 만 고치고 복사
node scripts/sync-lib.mjs
# 테스트 (실제 git 레포를 만들어 훅을 실행, gradle 있으면 컴파일 검증까지)
node --test tests/*.test.mjs
# 매니페스트 검증
claude plugin validate . --strict
```
문서: [설계](docs/DESIGN.md) · [훅 명세](docs/HOOK-SPEC.md) · [v1 에서 옮기기](docs/MIGRATION-FROM-V1.md) · [로드맵](docs/ROADMAP.md)
