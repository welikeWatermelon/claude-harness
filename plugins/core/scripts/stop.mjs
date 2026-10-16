#!/usr/bin/env node
// core / Stop — 턴 종료 시 이번 턴 변경 내역을 로그 한 줄로 요약
// 승인 토큰(strict)은 여기서 지우지 않고 다음 UserPromptSubmit 에서 지웁니다.
//   이유: stack-spring 의 Stop 훅이 빌드 실패로 block 하면 턴이 이어지는데,
//         여기서 토큰을 지우면 이어진 작업(빌드 오류 수정)이 strict 게이트에 막혀요.
import { runHook } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { loadSession } from '../lib/state.mjs';
import { logEvent } from '../lib/logger.mjs';

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const s = loadSession(root, input.session_id);
    const summary = { files: s.turnFiles, prompt: (s.lastPrompt || '').slice(0, 200), hadToken: !!s.token };
    if (summary.files.length) logEvent(root, cfg, input.session_id, 'turn_end', summary);
  },
  { failClosed: false, name: 'core/stop' },
);
