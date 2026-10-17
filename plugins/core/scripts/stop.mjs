#!/usr/bin/env node
// core / Stop
//   1) 결정 대기 목록 질문 차례: 미해결 결정(.harness/pending-decisions.md)이 있으면 한 번 block 해서
//      "이제 모아둔 질문을 한 번에 하세요" 라고 알림 → 같은 메시지 안에서는 다시 막지 않음
//   2) 이번 턴 변경 내역 로그 요약
// 승인 토큰(계획 게이트)은 여기서 지우지 않아요. 유효 여부는 plan-gate.tokenValid 가 판단.
//   (stack-spring Stop 훅이 빌드 실패로 block 해서 턴이 이어질 때 승인이 사라지면 안 되기 때문)
import { runHook, block, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { loadSession, updateSession } from '../lib/state.mjs';
import { logEvent } from '../lib/logger.mjs';
import { openItems } from '../lib/pending.mjs';

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const s = loadSession(root, input.session_id);
    if (s.turnFiles.length) logEvent(root, cfg, input.session_id, 'turn_end', { files: s.turnFiles, prompt: (s.lastPrompt || '').slice(0, 200) });

    const items = cfg.deferQuestions ? openItems(root) : [];
    if (items.length && s.flushTurn !== (s.promptCount || 0)) {
      updateSession(root, input.session_id, (x) => {
        x.flushTurn = x.promptCount || 0;
        return x;
      });
      logEvent(root, cfg, input.session_id, 'decisions_flush', { items: items.map((i) => i.id) });
      return block(
        `[하네스] 결정 대기 목록에 미해결 ${items.length}건이 있어요. 지시받은 작업 중 남은 게 있으면 먼저 끝내고, 이제 모아둔 질문을 한 번에 하세요.\n` +
          items.map((i) => `  - ${i.id}: ${i.title}`).join('\n') +
          '\nAskUserQuestion 으로 한 번에 묻고(한 번에 최대 4개, 각 질문에 추천안 표시), 그 도구가 없으면 마지막 답변에 질문 목록으로 정리하세요. ' +
          '답을 받으면 해당 항목을 [x] 로 바꾸고 "→ 답: ..." 을 적은 뒤, 보류했던 작업을 이어서 하세요. 사용자가 자리에 없으면 답을 기다리며 멈춰도 돼요.',
      );
    }
    return pass();
  },
  { failClosed: false, name: 'core/stop' },
);
