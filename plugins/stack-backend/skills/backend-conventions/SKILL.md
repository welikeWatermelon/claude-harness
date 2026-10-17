---
name: backend-conventions
description: Spring 이 아닌 백엔드(Node Express/NestJS, Python FastAPI/Django, Go, Kotlin/Java)에서 API·DB·설정 코드를 새로 만들거나 고칠 때 사용. 프로젝트 CLAUDE.md 가 우선.
---
# 백엔드 공통 컨벤션 (프로젝트 규칙이 있으면 그것이 우선)

## 공통
- 설정·비밀값은 환경변수에서 읽고, 필수 값이 없으면 기동 시 바로 실패시킨다 (`.env.example` 에 이름만)
- SQL 은 바인딩 파라미터만. 문자열 이어붙이기·f-string·템플릿 리터럴 금지
- 여러 쓰기는 한 트랜잭션. 트랜잭션 안에서 외부 HTTP 호출 금지 (커밋 후 처리)
- 에러 응답은 `{ code, message }` 처럼 일정한 형태. 스택·내부 메시지는 로그에만
- 로그에 비밀번호·토큰·카드번호 금지. 요청 ID 를 함께 남긴다
- 이미 커밋된 마이그레이션은 고치지 않고 새로 만든다

## Node (Express / NestJS)
- async 라우트 핸들러의 예외는 에러 미들웨어로 (Express 4 는 `next(err)` 또는 래퍼). 처리 안 된 Promise 금지
- 입력 검증: NestJS `ValidationPipe` + class-validator DTO, Express 는 zod 등 스키마
- `cors()` 는 origin 화이트리스트와 함께
- 동기 fs·crypto 함수를 요청 경로에서 쓰지 않는다

## Python (FastAPI / Django)
- FastAPI: Pydantic 모델로 입·출력, 의존성(Depends)으로 인증·DB 세션. `async def` 안에서 blocking I/O 금지
- Django: `transaction.atomic`, `select_related`/`prefetch_related` 로 N+1 방지, `DEBUG` 는 환경변수
- `except Exception as e:` 처럼 구체적으로, 가변 기본 인자 금지, `yaml.safe_load`

## Go
- 에러는 반드시 확인하고 `fmt.Errorf("...: %w", err)` 로 감싸서 올린다
- `context.Context` 를 첫 인자로 전달, DB·HTTP 호출에 타임아웃
- 고루틴은 종료 조건(ctx·WaitGroup·errgroup)과 함께

## Kotlin / Java (Spring 아님: Ktor, Micronaut, Quarkus, 순수 JVM)
- `!!` 대신 null 처리, `runBlocking` 은 main·테스트에서만
- 코루틴은 구조화된 스코프에서

## 하네스가 자동으로 거는 규칙 (stack-backend)
| ID | 내용 | 기본 |
|---|---|---|
| B1 | SQL 문자열 조합 | 경고 |
| B2 | 커밋된 마이그레이션 수정 | 차단 |
| B3 | 하드코딩된 비밀값 (AWS·GitHub·Stripe 키 형식, `password = "..."`) | 차단 |
| B4 | 민감정보 로그 | 경고 |
| B5 | eval·shell=True·yaml.load·pickle·TLS 검증 끄기 | 경고 |
| B6 | Python bare except, 가변 기본 인자 | 경고 |
| B7 | Go 에러 무시 | 경고 |
| B8 | Express cors() 무옵션, 에러 상세 응답 | 경고 |
| B9 | DEBUG=True·debug=True·TLS 검증 끄기 환경변수 | 경고 |
| B10 | 끝낼 때 소스만 바뀌고 테스트는 그대로 | 경고 |
| B11 | Kotlin `!!`, `runBlocking` | 경고 |

강도는 `.claude/harness.json` 의 `"rules": { "B7": "off" }` 처럼 바꿀 수 있어요.
