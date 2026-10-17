---
description: 백엔드(Node/Python/Go/JVM) 타입체크·컴파일·린트·테스트를 한 번에 실행하고 요약해요
---
프로젝트 루트와 하위 폴더에서 백엔드 프로젝트를 찾아 순서대로 실행하세요. 명령을 실행하기 전에 어떤 터미널(Git Bash / PowerShell)에서 무엇을 돌리는지 한 줄로 알려주세요.

- **Node** (package.json 에 express·@nestjs/core·fastify·koa·hono): lockfile 로 패키지 매니저 판별 → `typecheck` 스크립트(없으면 `tsc --noEmit`) → `lint` → `test`
- **Python** (pyproject.toml·requirements.txt·manage.py): `python -m compileall -q .`(가상환경 제외) → `ruff check .`(설치돼 있으면) → `pytest -q`(있으면). Windows 는 `python`, 그 외 `python3`
- **Go** (go.mod): `go build ./...` → `go vet ./...` → `go test ./...`
- **Kotlin/Java** (Spring 아님): `gradlew classes testClasses`(Windows `gradlew.bat`) 또는 `mvnw test-compile` → `test`

각 단계 통과/실패와 실패 원인(파일:라인)을 요약하세요. 이 커맨드에서는 고치지 말고 방향만 제안하세요.
$ARGUMENTS
