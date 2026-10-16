# 훅 동작 명세

대화에서 정한 형식(목적 / 종류 / 트리거 / 동작 / 결과 / 예외)으로 모든 훅을 적었습니다.
결과 표기: **deny** = 도구 호출 거부(Claude 에게 이유 전달) · **ask** = 사용자 확인 창 · **block** = Claude 가 멈추지 않고 이유를 보고 계속 작업 · **context** = 모델 컨텍스트에 문장 추가

---

## core

### C1. 보호 브랜치 수정 차단
| 항목 | 내용 |
|---|---|
| 목적 | main 에서 바로 코드를 고치는 실수 방지 (v1 도입 계기: 브랜치 전환 없이 main 을 수정해 롤백한 일) |
| 종류 | PreToolUse |
| 트리거 | Edit · Write · MultiEdit · NotebookEdit / Bash · PowerShell |
| 동작 | 현재 브랜치가 `protectedBranches`(기본 main·master·develop)인지 확인. 파일 도구는 레포 안 파일이면, 셸은 commit·merge·rebase·cherry-pick·revert·reset·파일 쓰기 명령이면 대상 |
| 결과 | deny + "`git switch -c feature/<설명>` 먼저" 안내 → Claude 가 브랜치를 만들고 재시도 |
| 예외 | git 레포 아님 / 커밋이 하나도 없는 새 레포 / 레포 밖 파일(예: `~/.claude/plans`) / `.harness/` / `protectedBranchAllowPaths` / 브랜치 생성 명령(`git switch -c`, `git checkout -b`) / `git pull`·`fetch`·`switch` |

### C2. 보호 브랜치 push 차단
| 목적 | 원격 main 오염 방지 (커밋 → 자동 배포로 이어지는 경로 차단) |
|---|---|
| 종류 / 트리거 | PreToolUse / Bash · PowerShell 의 `git push` |
| 동작 | push 대상 ref 계산: `origin main`, `HEAD:main`, 인자 없는 push(현재 브랜치) |
| 결과 | deny + "작업 브랜치 push 후 PR" |
| 예외 | 보호 브랜치가 아닌 대상 |

### C3. 파괴·우회 명령
| 목적 | 되돌릴 수 없는 명령 차단, 손실 가능 명령은 확인 |
|---|---|
| 종류 / 트리거 | PreToolUse / Bash · PowerShell |
| deny | `rm -rf /`·`~`·`.`·`*`, `git push --force`/`-f`/`+ref`, `--no-verify`, `curl … \| sh`, mkfs·format X:, shutdown/reboot, DROP DATABASE/SCHEMA, `.harness/mode·state` 쓰기 |
| ask | `git reset --hard`, `git clean -f`, `git checkout -- .`, `git branch -D`, `--force-with-lease`, DROP/TRUNCATE TABLE, WHERE 없는 DELETE, `chmod 777`, publish/deploy, sudo |
| 예외(오탐 방지) | `docker exec`·`kubectl exec`(exec 는 세그먼트 맨 앞일 때만), `--format`, `2>&1`·`>/dev/null` 리다이렉트, WHERE 있는 DELETE |

### C4. 시크릿 보호
| 목적 | AI 컨텍스트로 시크릿 값이 들어가거나 커밋되는 것 방지 |
|---|---|
| 종류 | PreToolUse |
| 트리거 | Read · Grep (파일) / Bash (cat·type·Get-Content·head·grep 등 + 시크릿 파일, printenv, `echo $*SECRET*`) / Edit·Write (시크릿 파일 쓰기) / `git commit` |
| 대상 파일 | `.env*`(example·sample·template 제외), `*.pem·key·p12·jks`, `id_rsa`, `application-prod.*`, `credentials`, `.mcp.json`, `backend.env` — `secrets.readDeny/readAllow` 로 조정 |
| 결과 | 읽기 deny / 쓰기 ask / 커밋: 스테이징 파일·추가된 줄에서 토큰 형식(ghp_, github_pat_, sk-ant-, AKIA, PRIVATE KEY)·`password: 평문` 발견 시 deny |
| 예외 | `${ENV}` 참조, `<placeholder>`, `changeme`/`example` 값 |

### C5. 모드별 제한
| 모드 | 파일 수정 | 셸에서 막히는 것 |
|---|---|---|
| standard | 허용 | C1~C4 만 |
| strict | 계획 승인 전 deny | 변경성 명령 deny (승인 전) |
| night | 허용 | build · test · remote · git 쓰기 · install · DB |
| readonly | deny | 변경성 · build · remote · install |
| ops | 허용 | (ops 플러그인이 원격 명령마다 ask) |

### C6. 모드 전환
| 목적 | 모델이 스스로 제한을 푸는 것 방지 |
|---|---|
| 종류 / 트리거 | UserPromptSubmit / 프롬프트가 `/core:mode <이름>` 또는 `하네스 모드: <이름>` |
| 동작 | `.harness/mode` 기록 + 이력 |
| 결과 | context ("모드가 바뀌었다") |

### C7. 모호한 요청 → Plan 안내
| 목적 | "기능 만들어줘" 같은 요청에 바로 구현 들어가는 것 방지 (v1 Plan 강제의 가벼운 버전) |
|---|---|
| 종류 / 트리거 | UserPromptSubmit |
| 동작 | 구현 동사(만들어·구현·고쳐·추가해·리팩토링…)가 있고, 파일명·클래스명·코드·목록 같은 구체 신호가 없고, 100자 미만이면 모호 판정 |
| 결과 | context (300자 이내): Plan 모드로 바뀔 파일·완료 조건·질문 먼저 |
| 예외 | 질문·설명·분석 요청, 슬래시 커맨드, `vaguePromptNudge:false` |

### C8. 변경 이력
| 목적 | 언제·어떤 요청으로·어떤 파일이 바뀌었는지 추적 |
|---|---|
| 종류 / 트리거 | UserPromptSubmit(프롬프트) · PostToolUse(파일 변경·변경성/원격/DB 명령·계획 승인) · PreToolUse(deny/ask 결정) · Stop(턴 요약) |
| 저장 | `.harness/logs/YYYY-MM-DD.jsonl` — 토큰·JWT·비밀번호 마스킹, 30일 보관 |
| 조회 | `/core:log`, `/core:status` |

### C9. 세션 시작
| 목적 | 오래된 코드 위 작업 방지 + 다른 PC/새 세션에서 이어받기 |
|---|---|
| 종류 / 트리거 | SessionStart (startup · resume · compact · clear) |
| 동작 | startup: origin 기본 브랜치 fetch → 현재가 main 이고 깨끗하면 ff-only, 아니면 로컬 main 포인터만 갱신(뒤처진 커밋 수 표시) / startup·resume: `docs/HANDOFF.md`·`PROGRESS.md` 앞 40줄 / compact: 컴팩션 스냅샷 |
| 결과 | context (모드·브랜치·동기화 결과·보호 브랜치 경고·규칙 한 줄) |
| 예외 | origin 없음, 오프라인(fetch 실패는 경고만), 커밋 없는 레포 |

### C10. 컴팩션 스냅샷
| 목적 | CLAUDE.md "컴팩션 지침"(수정 중 파일·테스트 명령·완료 조건 보존)을 훅으로 보장 |
|---|---|
| 종류 / 트리거 | PreCompact → SessionStart(compact) |
| 동작 | 최근 요청 5개, 세션 변경 파일, `.harness/done-criteria.md`, compact 지시문을 `.harness/compact-snapshot.md` 로 저장 → 컴팩션 직후 재주입 |

---

## stack-spring

### S1. 편집 시 컴파일
| 목적 | 컴파일 오류를 다음 편집 전에 바로 고치게 |
|---|---|
| 종류 / 트리거 | PostToolUse / Edit·Write·MultiEdit 의 `.java`·`.kt` |
| 동작 | 파일에서 위로 올라가며 빌드 파일 탐색 → **gradlew → gradle → mvnw → mvn** 순. 해당 모듈만 `compileJava`(Maven `compile`) |
| 결과 | 실패 시 block + 오류 마지막 25줄 (Claude 가 봄) / 시간 초과는 context 로 알리고 Stop 에서 재검증 |
| 예외 | `spring.compileOnEdit:false`, 빌드 파일 없음 |

### S2. 턴 종료 빌드 검증
| 목적 | "다 했어요"라고 했는데 컴파일도 안 되는 상황 제거 |
|---|---|
| 종류 / 트리거 | Stop |
| 동작 | 이번 세션에 Java/Kotlin 을 바꾼 모듈만. `verifyOnStop`: compile(main+test 컴파일, 기본) / test / off. night 모드면 test 대신 compile |
| 결과 | 실패: block(이유+오류) → Claude 가 이어서 수정. 통과: 사용자에게 "✓ 검증 통과" |
| 예외 | 연속 실패 `stopLoopLimit`(3)회 초과 시 붙잡지 않고 사용자에게 넘김. readonly 모드 |

### S3. 적용된 Flyway 마이그레이션 수정 차단
| 목적 | checksum 불일치로 기동 실패 방지 (MelonMe 규칙을 훅으로 승격) |
|---|---|
| 종류 / 트리거 | PreToolUse / Edit·Write·MultiEdit 의 기존 `db/migration/V*__*.sql` |
| 결과 | deny + 새 버전 파일 안내 |
| 예외 | 새 파일, `spring.blockEditingAppliedMigrations:false` |

### S4. 설정 파일 하드코딩 시크릿 경고
| 목적 | yml 에 평문 비밀번호가 들어가는 것 조기 발견 (KEEPING check-env.sh 일반화) |
|---|---|
| 종류 / 트리거 | PostToolUse / `application*.yml·yaml·properties` |
| 결과 | context: 해당 줄 번호와 키 (값은 가림), `${ENV}` 로 바꾸라는 안내 |

---

## stack-react

### R1. 턴 종료 타입체크/린트
| 목적 | 프론트 변경 후 타입 오류 방치 방지 |
|---|---|
| 종류 / 트리거 | PostToolUse(변경 패키지 기록) → Stop |
| 동작 | lockfile 로 pnpm/yarn/bun/npm 판별. `verifyOnStop`: typecheck(기본: scripts.typecheck → `tsc --noEmit` → lint) / lint / build / off |
| 결과 | 실패 block, 통과 메시지, 3회 초과 시 넘김 |

---

## ops

### O1. 원격 명령 관문
| 목적 | AI 의 서버 접근 범위 통제 (KEEPING 실험에서 AI 가 서버 터미널에 접속해 변인을 바꾼 경험) |
|---|---|
| 종류 / 트리거 | PreToolUse / ssh·scp·rsync·sftp·aws·kubectl·helm·gcloud·az·docker -H·terraform |
| deny | 원격 rm -rf, docker rm/prune/compose down/stop, systemctl stop/restart, kill -9, DROP/TRUNCATE/DELETE, shutdown, aws terminate/delete/s3 rm, kubectl delete/drain, terraform destroy, crontab -r |
| ask | prod/production/live 키워드, `ops.allowedHosts` 밖 호스트, ops 모드의 모든 원격 명령 |
| 결과 | 모든 판단을 `.harness/logs/ops-YYYY-MM.jsonl` 에 기록 |

### O2. 원격 실행 감사
| 종류 / 트리거 | PostToolUse / 원격 명령 |
|---|---|
| 동작 | 호스트·명령·실패 여부·출력 앞 600자 기록 → `/ops:audit`, `/ops:incident` 타임라인 재료 |
