#!/usr/bin/env node
// ops / PreToolUse(Bash|PowerShell) — 원격 명령 관문
//   - 원격 파괴 명령(rm -rf, docker rm/prune, systemctl stop, DROP, terraform destroy …) → 차단
//   - 운영(prod) 키워드가 들어간 원격 명령 → 확인(ask)
//   - ops.allowedHosts 가 설정돼 있고 그 밖의 호스트 → 확인(ask)
//   - ops 모드 → 모든 원격 명령 확인(ask)
import { runHook, deny, ask, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { getMode } from '../lib/state.mjs';
import { isRemote, remoteHosts, destructiveRemote, looksProd } from '../lib/remote-rules.mjs';
import { logEvent } from '../lib/logger.mjs';

await runHook(
  async (input) => {
    const cmd = String((input.tool_input || {}).command || '');
    if (!isRemote(cmd)) return pass();
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const mode = getMode(root, cfg);
    const hosts = remoteHosts(cmd);
    const month = new Date().toISOString().slice(0, 7);
    const log = (decision, rule) => logEvent(root, cfg, input.session_id, 'remote', { decision, rule, hosts, mode, command: cmd.slice(0, 500) }, `ops-${month}.jsonl`);

    const d = destructiveRemote(cmd);
    if (d) {
      log('deny', 'remote-destructive');
      deny('[ops] 원격 서버에서 되돌릴 수 없는 명령(삭제·중지·DROP 등)은 AI 가 실행하지 않아요. 명령과 영향 범위, 롤백 방법을 정리해서 사용자에게 직접 실행을 요청하세요.');
    }
    const allowed = cfg.ops.allowedHosts || [];
    const outside = allowed.length ? hosts.filter((h) => !allowed.includes(h)) : [];
    if (outside.length) {
      log('ask', 'host-not-allowed');
      ask(`[ops] 허용 목록(.claude/harness.json ops.allowedHosts)에 없는 호스트예요: ${outside.join(', ')}`);
    }
    if (looksProd(cmd, cfg.ops.prodKeywords)) {
      log('ask', 'prod');
      ask('[ops] 운영(prod) 환경 대상 명령으로 보여요. 실행 전에 확인해주세요.');
    }
    if (mode === 'ops') {
      log('ask', 'ops-mode');
      ask(`[ops] ops 모드 — 원격 명령은 하나씩 확인받아요: ${cmd.slice(0, 160)}`);
    }
    log('allow', 'remote');
    return pass();
  },
  { failClosed: true, name: 'ops/remote-guard' },
);
