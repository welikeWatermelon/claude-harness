#!/usr/bin/env node
// stack-spring / Stop — "끝났다" 전에 빌드 통과를 강제
//   이번 세션에서 Java/Kotlin 을 바꾼 모듈만 검증 (verifyOnStop: compile=main+test 컴파일, test=테스트까지)
//   실패하면 decision:block 으로 Claude 가 멈추지 않고 오류를 고치게 함
//   무한 루프 방지: 연속 차단이 stopLoopLimit(기본 3) 에 닿으면 사용자에게 넘김
//   night 모드에서는 test 대신 compile 만 (Testcontainers 가 Docker 를 깨워 세션이 멎는 문제 — KEEPING v3 경험)
import path from 'node:path';
import { runHook, block, systemMessage, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { detectJvmBuild, jvmArgs } from '../lib/build-detect.mjs';
import { run, tail } from '../lib/proc.mjs';
import { loadSession, updateSession, getMode } from '../lib/state.mjs';
import { logEvent } from '../lib/logger.mjs';

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const sid = input.session_id;
    const mode = cfg.spring.verifyOnStop;
    if (mode === 'off') return pass();
    const s = loadSession(root, sid);
    const modules = (s.dirty && s.dirty.spring) || [];
    if (!modules.length) return pass();

    const harnessMode = getMode(root, cfg);
    if (harnessMode === 'readonly') return pass();
    const goal = mode === 'test' && harnessMode !== 'night' ? 'test' : 'compileAll';

    const failures = [];
    const passed = [];
    for (const m of modules) {
      const b = detectJvmBuild(m, root);
      if (!b) continue;
      const r = run(b.runner, jvmArgs(b, goal), { cwd: b.runnerDir, timeoutSec: cfg.spring.verifyTimeoutSec });
      const label = path.relative(root, b.moduleDir) || '.';
      logEvent(root, cfg, sid, 'verify', { target: label, goal, ok: r.ok, tool: b.tool, on: 'stop' });
      if (r.ok) passed.push(label);
      else failures.push(`■ ${label} (${path.basename(b.runner)} ${jvmArgs(b, goal).join(' ')})\n${tail(r.out, 30)}`);
    }

    if (!failures.length) {
      updateSession(root, sid, (x) => {
        x.dirty.spring = [];
        x.springStopBlocks = 0;
        return x;
      });
      return passed.length ? systemMessage(`✓ Spring 검증 통과 (${goal === 'test' ? '테스트' : '컴파일'}): ${passed.join(', ')}`) : pass();
    }

    const count = (s.springStopBlocks || 0) + 1;
    const limit = cfg.stopLoopLimit || 3;
    if (count > limit) {
      updateSession(root, sid, (x) => {
        x.springStopBlocks = 0;
        return x;
      });
      return systemMessage(`⚠ Spring 검증이 ${limit}회 연속 실패해서 더 붙잡지 않고 넘겨요. 사람이 확인이 필요해요.\n${failures.join('\n\n').slice(0, 1500)}`);
    }
    updateSession(root, sid, (x) => {
      x.springStopBlocks = count;
      return x;
    });
    return block(
      `[stack-spring] 끝내기 전에 빌드 검증이 실패했어요 (${count}/${limit}). 아래 오류를 고친 뒤 마무리하세요. 고칠 수 없는 원인(환경 문제 등)이면 이유를 설명하고 멈추세요.\n\n${failures.join('\n\n')}`,
    );
  },
  { failClosed: false, name: 'stack-spring/stop-verify' },
);
