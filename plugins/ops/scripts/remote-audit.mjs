#!/usr/bin/env node
// ops / PostToolUse(Bash|PowerShell) — 실행된 원격 명령과 결과 요약을 감사 로그에 남김
//   .harness/logs/ops-YYYY-MM.jsonl  (언제, 어떤 세션, 어떤 호스트에, 무슨 명령, 성공 여부, 출력 앞부분)
import { runHook, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { isRemote, remoteHosts } from '../lib/remote-rules.mjs';
import { logEvent } from '../lib/logger.mjs';

await runHook(
  async (input) => {
    const cmd = String((input.tool_input || {}).command || '');
    if (!isRemote(cmd)) return pass();
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const resp = input.tool_response;
    const text = typeof resp === 'string' ? resp : JSON.stringify(resp || '');
    const failed = !!(resp && (resp.is_error || resp.interrupted || (typeof resp.exit_code === 'number' && resp.exit_code !== 0)));
    logEvent(
      root,
      cfg,
      input.session_id,
      'remote_exec',
      { hosts: remoteHosts(cmd), command: cmd.slice(0, 500), failed, output: text.slice(0, 600) },
      `ops-${new Date().toISOString().slice(0, 7)}.jsonl`,
    );
    return pass();
  },
  { failClosed: false, name: 'ops/remote-audit' },
);
