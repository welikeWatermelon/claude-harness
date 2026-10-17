// pending.mjs — "막히면 미뤄두고 계속하기" 결정 대기 목록
//
// 원칙
//   작업 중 사람의 결정이 필요한 지점(K)을 만나면 바로 묻지 않는다.
//   K 와 K 에 걸린 작업은 .harness/pending-decisions.md 에 적어두고 건너뛴 뒤,
//   나머지 지시받은 작업을 끝까지 한다. 질문은 마지막에 한 번에 한다.
//   → 사람이 자리를 비워도(밥 먹으러 가도) 결정이 필요 없는 일은 계속 진행되고,
//     돌아오면 결정할 것만 모여 있다.
//
// 파일 형식 (.harness/pending-decisions.md — Claude 가 쓰고 사람이 읽음)
//   - [ ] D1: <질문 한 줄>
//     - 막힌 이유: ...
//     - 선택지: A) ... (추천) / B) ...
//     - 보류한 작업: <파일·기능>   ← K 와 겹쳐서 같이 미룬 부분
//     - 임시 처리: <건너뛴 방법, 가정>
//   - [x] D0: ... → 답: ...
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { harnessDir } from './state.mjs';

export const PENDING_FILE = 'pending-decisions.md';

export function pendingPath(root) {
  return path.join(harnessDir(root), PENDING_FILE);
}

/** 미해결 항목 목록 [{id, title}] */
export function openItems(root) {
  const f = pendingPath(root);
  if (!existsSync(f)) return [];
  let text = '';
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    return [];
  }
  const items = [];
  for (const m of text.matchAll(/^\s*[-*]\s*\[\s\]\s*(D\d+)\s*[:：.]?\s*(.*)$/gm)) items.push({ id: m[1], title: m[2].trim() });
  return items;
}

export const DEFER_RULE =
  '결정 미루기 규칙: 작업 중 사람의 결정이 필요한 지점을 만나면 바로 묻지 말고 .harness/pending-decisions.md 에 "- [ ] D<번호>: 질문 / 막힌 이유 / 선택지(추천 표시) / 같이 보류한 작업 / 임시 처리" 형식으로 적은 뒤, ' +
  '그 결정과 겹치는 작업만 보류하고 나머지 지시받은 작업은 끝까지 진행하세요. 질문은 모든 작업이 끝난 뒤 한 번에 합니다. (작업 시작 전 계획 단계의 확인 질문은 괜찮아요)';
