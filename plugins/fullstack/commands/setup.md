---
description: 이 레포를 fullstack 연동에 등록해요 (backend/frontend 역할, 상대 레포 경로, springdoc Gradle 플러그인 확인)
argument-hint: "<backend|frontend> <상대 레포 경로, 예: ../holssi_front>"
---
1. `$ARGUMENTS` 에서 역할과 상대 레포 경로를 읽어요. 없으면 빌드 파일로 역할을 추정하고(build.gradle → backend, package.json+react → frontend), 상대 경로는 형제 폴더 중 후보를 보여주고 계획 단계에서 한 번 물어보세요.
2. 계획 확인 (변경 없음):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" setup --role <역할> --peer <경로>
   ```
   결과를 요약해서 보여주고 승인받으세요. 이 명령은 `.claude/harness.json`(fullstack 설정), `.claude/settings.local.json`(상대 레포를 Claude 가 열 수 있게 additionalDirectories), `.claude/settings.json`(플러그인 등록)을 바꿔요.
3. 승인되면 같은 명령에 `--apply` 를 붙여 실행.
4. **backend** 이고 결과의 `springdocGradlePlugin` 이 false 면, build.gradle 에 아래를 추가하는 diff 를 제안하세요 (버전은 프로젝트의 Spring Boot 버전에 맞는지 확인):
   ```groovy
   plugins { id 'org.springdoc.openapi-gradle-plugin' version '1.9.0' }
   openApi {
       apiDocsUrl.set("http://localhost:8080/v3/api-docs")
       outputDir.set(file("$buildDir"))
       outputFileName.set("openapi.json")
       customBootRun { args.set(["--spring.profiles.active=local"]) }   // DB 없이 뜨는 프로필이면 더 좋아요
   }
   ```
   springdoc-openapi-starter-webmvc-ui 의존성이 없으면 그것도 함께 제안하세요.
5. 마지막으로 `/fullstack:spec` 으로 첫 스냅샷(docs/api/openapi.json)을 만들고 커밋하자고 안내하세요. 프론트 레포에서도 `/fullstack:setup frontend <백엔드 경로>` 를 한 번 실행해야 해요.
