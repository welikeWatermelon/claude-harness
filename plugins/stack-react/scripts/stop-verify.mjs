#!/usr/bin/env node
// stack-react / Stop — 끝내기 전에 타입체크(기본)·린트·빌드 통과 강제
//   react.verifyOnStop: off | typecheck | lint | build
//   typecheck: tsconfig + typescript 가 있으면 `<pm> exec tsc --noEmit`, 없으면 lint 스크립트로 대체
import path from 'node:path';
import { runHook, block, systemMessage, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { detectNodeProject } from '../lib/build-detect.mjs';
import { run, tail } from '../lib/proc.mjs';
import { loadSession, updateSession, getMode } from '../lib/state.mjs';
import { logEvent } from '../lib/logger.mjs';
import { severityOf, readText } from '../lib/code-rules.mjs';
import { consoleLeftovers, relatedTests } from '../lib/rules-web.mjs';
import { existsSync } from 'node:fs';

/** R11: 이번 세션에서 바뀐 소스와 짝인 테스트 파일 (테스트 파일 자체를 바꿨으면 그것도) */
function testsFor(root, p, changed) {
  const out = new Set();
  for (const rel of changed) {
    const abs = path.join(root, rel);
    if (!abs.startsWith(p.pkgDir + path.sep)) continue;
    const inPkg = path.relative(p.pkgDir, abs).replace(/\\/g, '/');
    if (/(^|\/)(e2e|playwright|cypress)\//.test(inPkg)) continue; // 브라우저 E2E 는 vitest/jest 대상 아님
    if (/\.(test|spec)\.[jt]sx?$/.test(inPkg)) {
      if (existsSync(abs)) out.add(inPkg);
      continue;
    }
    if (!/\.(tsx?|jsx?|vue)$/.test(inPkg)) continue;
    for (const t of relatedTests(inPkg)) if (existsSync(path.join(p.pkgDir, t))) out.add(t);
  }
  return [...out].slice(0, 30);
}

function testCommand(p, files) {
  const pre = p.pm === 'npm' ? ['exec', '--'] : p.pm === 'yarn' ? [] : ['exec'];
  if (p.deps && p.deps.vitest) return [...pre, 'vitest', 'run', '--passWithNoTests', ...files];
  if (p.deps && p.deps.jest) return [...pre, 'jest', '--findRelatedTests', '--passWithNoTests', ...files];
  return null;
}

function plan(p, goal) {
  const exec = p.pm === 'npm' ? ['exec', '--', 'tsc', '--noEmit'] : p.pm === 'yarn' ? ['tsc', '--noEmit'] : ['exec', 'tsc', '--noEmit'];
  const script = (name) => (p.pm === 'npm' ? ['run', name] : [name]);
  if (goal === 'build' && p.scripts.build) return script('build');
  if (goal === 'lint' && p.scripts.lint) return script('lint');
  if (goal === 'typecheck') {
    if (p.scripts.typecheck) return script('typecheck');
    if (p.hasTs) return exec;
    if (p.scripts.lint) return script('lint');
  }
  return null;
}

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const cfg = loadConfig(root);
    const sid = input.session_id;
    const goal = cfg.react.verifyOnStop;
    if (goal === 'off') return pass();
    if (['readonly'].includes(getMode(root, cfg))) return pass();
    const s = loadSession(root, sid);
    const dirs = (s.dirty && s.dirty.react) || [];
    if (!dirs.length) return pass();

    const failures = [];
    const passed = [];
    for (const d of dirs) {
      const p = detectNodeProject(d, root);
      if (!p) continue;
      const args = plan(p, goal);
      if (!args) continue;
      const r = run(p.pmCmd, args, { cwd: p.pkgDir, timeoutSec: cfg.react.verifyTimeoutSec });
      const label = path.relative(root, p.pkgDir) || '.';
      logEvent(root, cfg, sid, 'verify', { target: label, goal, ok: r.ok, tool: p.pm, on: 'stop' });
      if (r.ok) passed.push(label);
      else failures.push(`■ ${label} (${p.pm} ${args.join(' ')})\n${tail(r.out, 30)}`);
      // R11: 바뀐 파일과 짝인 테스트만 실행 (night 모드·readonly 는 생략)
      if (r.ok && cfg.react.testOnStop && severityOf({ id: 'R11', severity: 'block' }, cfg) !== 'off' && getMode(root, cfg) !== 'night') {
        const files = testsFor(root, p, s.changedFiles || []);
        const cmd = files.length ? testCommand(p, files) : null;
        if (cmd) {
          const t = run(p.pmCmd, cmd, { cwd: p.pkgDir, timeoutSec: cfg.react.testTimeoutSec, env: { CI: 'true' } });
          logEvent(root, cfg, sid, 'verify', { target: label, goal: 'test', ok: t.ok, tool: cmd[cmd.indexOf('vitest') >= 0 ? cmd.indexOf('vitest') : cmd.indexOf('jest')], on: 'stop' });
          if (t.ok) passed.push(`${label} 테스트 ${files.length}개`);
          else if (severityOf({ id: 'R11', severity: 'block' }, cfg) === 'block') failures.push(`■ ${label} 관련 테스트 (${cmd.join(' ')})\n${tail(t.out, 40)}`);
        }
      }
    }
    if (!failures.length) {
      updateSession(root, sid, (x) => {
        x.dirty.react = [];
        x.reactStopBlocks = 0;
        return x;
      });
      // R5: 바뀐 파일에 남은 console.log — 프롬프트당 한 번만 알림
      const sev5 = severityOf({ id: 'R5', severity: 'warn' }, cfg);
      const s2 = loadSession(root, sid);
      if (sev5 !== 'off' && s2.reactConsoleTurn !== (s2.promptCount || 0)) {
        const left = consoleLeftovers(s2.changedFiles || [], (f) => readText(path.join(root, f)));
        if (left.length) {
          updateSession(root, sid, (x) => {
            x.reactConsoleTurn = x.promptCount || 0;
            return x;
          });
          logEvent(root, cfg, sid, 'rule', { id: 'R5', severity: sev5, count: left.length });
          return block(`[R5] 이번에 바꾼 파일에 console.log 가 남아 있어요. 디버깅용이면 지우고, 꼭 필요한 로그면 이유를 한 줄로 말한 뒤 끝내세요:\n${left.slice(0, 15).map((x) => '  ' + x).join('\n')}`);
        }
      }
      return passed.length ? systemMessage(`✓ React 검증 통과 (${goal}): ${passed.join(', ')}`) : pass();
    }
    const count = (s.reactStopBlocks || 0) + 1;
    const limit = cfg.stopLoopLimit || 3;
    if (count > limit) {
      updateSession(root, sid, (x) => {
        x.reactStopBlocks = 0;
        return x;
      });
      return systemMessage(`⚠ React 검증이 ${limit}회 연속 실패해서 넘겨요. 사람이 확인해주세요.\n${failures.join('\n\n').slice(0, 1500)}`);
    }
    updateSession(root, sid, (x) => {
      x.reactStopBlocks = count;
      return x;
    });
    return block(`[stack-react] 끝내기 전에 ${goal} 검증이 실패했어요 (${count}/${limit}). 오류를 고친 뒤 마무리하세요.\n\n${failures.join('\n\n')}`);
  },
  { failClosed: false, name: 'stack-react/stop-verify' },
);
