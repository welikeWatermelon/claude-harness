#!/usr/bin/env node
// stack-react / PreToolUse(Edit|Write|MultiEdit)
//   R2 : eslint·tsconfig·prettier 설정 수정은 사용자 확인 (규칙을 끄거나 strict 를 낮춰 오류를 "해결"하는 것 방지)
//   R3·R4·R6·R7·R8·R9 : 코드 규칙 (lib/rules-web.mjs, 신규 위반만)
import { runHook, deny, ask, pass } from '../lib/hook-io.mjs';
import { editContext, checkRules, blockMessage } from '../lib/rules-hook.mjs';
import { REACT_RULES, CONFIG_FILES } from '../lib/rules-web.mjs';
import { severityOf } from '../lib/code-rules.mjs';
import { logEvent } from '../lib/logger.mjs';

await runHook(
  async (input) => {
    const ec = editContext(input);
    if (!ec) return pass();
    if (CONFIG_FILES.test(ec.rel) && ec.oldText !== null) {
      const sev = severityOf({ id: 'R2', severity: 'warn' }, ec.cfg);
      if (sev !== 'off') {
        logEvent(ec.sessionRoot, ec.cfg, ec.sessionId, 'rule', { id: 'R2', severity: sev, file: ec.rel });
        const msg = `[R2] 린트/타입 설정(${ec.rel})을 바꾸려고 해요. 규칙을 끄거나 strict 를 낮춰서 오류를 없애는 거라면 거절하고 코드를 고치게 하세요.`;
        if (sev === 'block') deny(msg + '\n(설정 파일 수정이 block 으로 설정돼 있어요. 필요하면 사용자에게 직접 고쳐달라고 하세요.)');
        ask(msg);
      }
    }
    const r = checkRules(ec, REACT_RULES, 'react');
    if (r && r.blocks.length) deny(blockMessage(ec, r.blocks));
    return pass();
  },
  { failClosed: false, name: 'stack-react/pre-edit' },
);
