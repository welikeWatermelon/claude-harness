---
name: spring-api-conventions
description: Spring Boot 에서 새 API(Controller/Service/DTO)를 만들거나 응답·예외 처리를 다룰 때 사용. 프로젝트 CLAUDE.md 컨벤션을 우선하고, 없으면 이 기본 컨벤션을 따른다.
---
# Spring API 기본 컨벤션
(프로젝트 CLAUDE.md / docs/architecture/CONVENTIONS.md 가 있으면 그것이 우선)

## 계층
`Controller → Service → Repository` 단방향. Controller 에 비즈니스 로직 없음. 다른 도메인 데이터는 그 도메인의 **Service(또는 공개 컴포넌트)** 를 통해서만.

## 응답·예외
- 성공: `ApiResponse.success(data)` 같은 공통 래퍼 사용 (프로젝트에 있는 이름 그대로)
- 실패: `throw new CustomException(ErrorCode.XXX)` → `GlobalExceptionHandler` 가 변환. 서비스에 메시지 문자열 하드코딩 금지 → ErrorCode enum 에 추가
- 엔티티를 응답으로 직접 반환하지 않음. Response DTO 의 `static from(Entity)` 팩토리

## DTO
- Request: `record` + Jakarta Validation (`@NotBlank`, `@NotNull`, `@Size`)
- Response: `record` 또는 불변 객체

## 서비스
- 클래스 레벨 `@Transactional(readOnly = true)`, 쓰기 메서드만 `@Transactional`
- 외부 API 호출은 트랜잭션 밖으로 (필요하면 Facade 에서 조합)
- 생성자 주입(`@RequiredArgsConstructor` + `private final`), 필드 주입 금지

## 인증
- `@AuthenticationPrincipal` 로 사용자 컨텍스트, 권한 규칙은 SecurityConfig 필터 체인 또는 서비스 레이어 (프로젝트 방식 따름)
- 멀티테넌트면 서비스 첫 줄에서 테넌트 ID 확인 (예: BizMap `SecurityUtils.getCurrentCompanyId()`)
