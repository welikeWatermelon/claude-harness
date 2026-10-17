#!/usr/bin/env node
// stack-spring / PostToolUse(Edit|Write|MultiEdit)
//   1) .java/.kt 수정 → 그 파일이 속한 모듈만 compileJava (Gradle 우선, 없으면 Maven)
//      실패하면 오류를 Claude 에게 돌려줘서 바로 고치게 함
//      (KEEPING post-edit.sh 는 exit 1 이라 Claude 가 실패를 못 봤고, smoke-build.sh 는 경로가 하드코딩돼 있었음 → 둘 다 해결)
//   2) application*.yml/properties 수정 → 하드코딩 시크릿 경고 (KEEPING check-env.sh 일반화)
//   3) Stop 검증 대상 모듈을 기록
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runHook, block, addContext as _addContext, pass as _pass } from '../lib/hook-io.mjs';
import { takeWarnings } from '../lib/rules-hook.mjs';
import { projectRoot, loadConfig, toolFilePath, resolveFile } from '../lib/config.mjs';
import { detectJvmBuild, jvmArgs } from '../lib/build-detect.mjs';
import { run, tail } from '../lib/proc.mjs';
import { updateSession } from '../lib/state.mjs';
import { logEvent } from '../lib/logger.mjs';

const HARDCODED = /^\s*([\w.-]*(password|secret|api[-_]?key|access[-_]?key|private[-_]?key|token|client[-_]?secret)[\w.-]*)\s*[:=]\s*["']?(?!\$\{)([^\s"'#]{6,})/i;

await runHook(
  async (input) => {
    // PreToolUse 에서 보관한 규칙 경고(S1~S17)를 이 훅의 결과에 함께 실어 보냄
    const extra = takeWarnings(input, 'spring');
    const pass = () => (extra ? _addContext('PostToolUse', extra) : _pass());
    const addContext = (ev, text) => _addContext(ev, extra ? `${text}\n\n${extra}` : text);
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const f = toolFilePath(input.tool_input || {});
    if (!f) return pass();
    const abs = resolveFile(root, f);
    const sid = input.session_id;

    if (/application[^/\\]*\.(ya?ml|properties)$/i.test(abs)) {
      let hits = [];
      try {
        hits = readFileSync(abs, 'utf8')
          .split(/\r?\n/)
          .map((l, i) => [i + 1, l.match(HARDCODED)])
          .filter(([, m]) => m)
          .map(([n, m]) => `  L${n}: ${m[1]} = ****`);
      } catch {}
      if (hits.length) {
        return addContext('PostToolUse', `[stack-spring] ${path.basename(abs)} 에 하드코딩된 시크릿으로 보이는 값이 있어요. \${ENV_VAR} 참조로 바꾸고 실제 값은 .env/Secrets 로 옮기세요.\n${hits.slice(0, 5).join('\n')}`);
      }
      return pass();
    }

    if (!/\.(java|kt)$/i.test(abs)) return pass();
    const b = detectJvmBuild(abs, root);
    if (!b) return pass();

    updateSession(root, sid, (s) => {
      s.dirty = s.dirty || {};
      const set = new Set(s.dirty.spring || []);
      set.add(b.moduleDir);
      s.dirty.spring = [...set];
      return s;
    });

    if (!cfg.spring.compileOnEdit) return pass();
    const r = run(b.runner, jvmArgs(b, 'compile', abs), { cwd: b.runnerDir, timeoutSec: cfg.spring.compileTimeoutSec });
    logEvent(root, cfg, sid, 'verify', { target: path.relative(root, b.moduleDir) || '.', goal: 'compile', ok: r.ok, tool: b.tool });
    if (r.ok) return pass();
    if (r.timedOut) return addContext('PostToolUse', `[stack-spring] 컴파일 확인이 ${cfg.spring.compileTimeoutSec}초 안에 끝나지 않았어요. 턴 종료 시 다시 검증합니다.`);
    return block(
      `[stack-spring] ${path.relative(root, b.moduleDir) || '루트'} 모듈 컴파일 실패 (${path.basename(b.runner)} ${jvmArgs(b, 'compile', abs).join(' ')}). 아래 오류를 먼저 고치세요:\n${tail(r.out, 25)}${extra ? `\n\n${extra}` : ''}`,
    );
  },
  { failClosed: false, name: 'stack-spring/post-edit' },
);
