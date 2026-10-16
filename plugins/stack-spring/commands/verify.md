---
description: 전체 빌드와 테스트를 실행하고 결과를 요약해요 (Gradle 우선, 없으면 Maven)
argument-hint: "[모듈 경로 또는 테스트 클래스]"
---
1. 빌드 도구 확인: `gradlew` → `build.gradle` → `mvnw` → `pom.xml` 순서.
2. 실행 (Windows 면 gradlew.bat / mvnw.cmd):
   - 인자 없음: `./gradlew build` 또는 `./mvnw -B verify`
   - 모듈 경로: `./gradlew -p <모듈> build`
   - 테스트 클래스: `./gradlew test --tests "<클래스>"` / `./mvnw -Dtest=<클래스> test`
3. 결과를 `통과 N / 실패 N / 건너뜀 N` 과 실패한 테스트별 원인 한 줄로 요약하세요. 실패 원인은 `build/test-results/**/*.xml` 또는 `target/surefire-reports` 에서 확인합니다.
4. 고치지는 말고, 고칠 방향만 제안하세요.
