---
name: k6-experiment
description: k6 부하 테스트 스크립트를 쓰거나, 성능 개선 효과를 측정·비교할 때 사용.
---
# k6 실험 규칙
- 부하 모델: **open model** `constant-arrival-rate` (closed model 은 응답이 느려지면 부하도 줄어 결과가 흔들림 — KEEPING 에서 CV 20.6% → 0.15%)
- 한 번에 변인 하나. 같은 조건 3회 이상 반복, 평균과 CV 기록
- 게이트: `thresholds` 에 기준선 + 허용 오차 (`p(95)<850`, `http_req_failed<0.01`). 실패 시 exit 1 → CI/스크립트에서 판정
- 목표 부하 통과 여부 확인 후, 단계적으로 올려 붕괴선(성공률 급락 지점)을 찾음
- 결과 표: `변인 | 반복 | CV | p95 | 처리량 | 성공률 | 판정`
- 실행 위치(로컬/EC2), 인스턴스 사양, 힙 설정을 결과와 함께 적음
- 서버에서 실행하는 명령은 사용자 승인 후. ops 플러그인을 쓰면 원격 명령이 자동 기록돼요.

```js
export const options = {
  scenarios: { load: { executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s', duration: '2m', preAllocatedVUs: 100, maxVUs: 400 } },
  thresholds: { http_req_duration: ['p(95)<850'], http_req_failed: ['rate<0.01'] },
};
```
