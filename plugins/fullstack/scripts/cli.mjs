#!/usr/bin/env node
// fullstack / cli — 커맨드가 호출하는 도우미
//   node cli.mjs spec                  (backend) 명세 생성 → 비교 → 스냅샷 갱신, 결과 JSON
//   node cli.mjs usages <검색어>        프론트 레포에서 사용처 검색
//   node cli.mjs sync                  (frontend) 계약 → TS 타입 생성 (openapi-typescript)
//   node cli.mjs setup --role backend|frontend --peer <경로> [--apply]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { run, IS_WIN } from '../lib/proc.mjs';
import { detectNodeProject } from '../lib/build-detect.mjs';
import { fsCfg, peerRoot, generateSpec, compareAndSave, findUsages, appendChangeLog } from './contract.mjs';

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : null;
};
const root = projectRoot({ cwd: process.cwd() });
const cfg = loadConfig(root);
const fs = fsCfg(cfg);
const readJson = (f, d) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
  } catch {
    return d;
  }
};

const cmd = args[0];
if (cmd === 'spec') {
  const gen = generateSpec(root, fs);
  if (!gen.ok) {
    console.log(JSON.stringify({ ok: false, error: gen.error }, null, 2));
    process.exit(0);
  }
  const r = compareAndSave(root, fs, gen);
  if (r.changes.length) appendChangeLog(root, fs, r.changes, '수동 실행');
  const breaking = r.changes.filter((c) => c.severity === 'breaking');
  console.log(JSON.stringify({ ok: true, snapshot: r.snapshot, first: r.first, changes: r.changes, usages: findUsages(peerRoot(root, fs), fs, breaking) }, null, 2));
} else if (cmd === 'usages') {
  const term = args[1];
  console.log(JSON.stringify(findUsages(peerRoot(root, fs), fs, [{ severity: 'breaking', kind: 'field', target: term.includes('.') ? term : `X.${term}`, detail: '' }]), null, 2));
} else if (cmd === 'sync') {
  const peer = peerRoot(root, fs);
  const spec = fs.frontend?.specFrom ? path.resolve(root, fs.frontend.specFrom) : peer ? path.join(peer, 'docs/api/openapi.json') : null;
  if (!spec || !existsSync(spec)) {
    console.log(`명세를 찾지 못했어요: ${spec || '(fullstack.peerPath 또는 frontend.specFrom 설정 필요)'}`);
    process.exit(0);
  }
  const out = path.resolve(root, fs.frontend?.typesOut || 'src/api/generated/schema.ts');
  mkdirSync(path.dirname(out), { recursive: true });
  const p = detectNodeProject(root, root);
  const npx = IS_WIN ? 'npx.cmd' : 'npx';
  const r = run(npx, ['--yes', 'openapi-typescript@7', spec, '-o', out], { cwd: p ? p.pkgDir : root, timeoutSec: 180 });
  console.log(r.ok ? `✓ 타입 생성: ${path.relative(root, out)} (원본: ${spec})` : `✗ 타입 생성 실패\n${r.out.slice(-1500)}`);
} else if (cmd === 'setup') {
  const role = flag('role');
  const peer = flag('peer');
  const apply = args.includes('--apply');
  const hjPath = path.join(root, '.claude', 'harness.json');
  const hj = readJson(hjPath, {});
  hj.fullstack = { ...(hj.fullstack || {}), role, peerPath: peer };
  const slPath = path.join(root, '.claude', 'settings.local.json');
  const sl = readJson(slPath, {});
  sl.permissions = sl.permissions || {};
  const dirs = new Set(sl.permissions.additionalDirectories || []);
  if (peer) dirs.add(path.resolve(root, peer));
  sl.permissions.additionalDirectories = [...dirs];
  const spPath = path.join(root, '.claude', 'settings.json');
  const sp = readJson(spPath, {});
  sp.enabledPlugins = { ...(sp.enabledPlugins || {}), 'fullstack@yj-harness': true };
  const plan = { 'harness.json.fullstack': hj.fullstack, 'settings.local.json.additionalDirectories': sl.permissions.additionalDirectories, 'settings.json.enabledPlugins': Object.keys(sp.enabledPlugins) };
  if (apply) {
    mkdirSync(path.dirname(hjPath), { recursive: true });
    writeFileSync(hjPath, JSON.stringify(hj, null, 2) + '\n');
    writeFileSync(slPath, JSON.stringify(sl, null, 2) + '\n');
    writeFileSync(spPath, JSON.stringify(sp, null, 2) + '\n');
  }
  const gradle = ['build.gradle', 'build.gradle.kts'].map((f) => path.join(root, fs.backendModule || '.', f)).find(existsSync);
  const hasPlugin = gradle ? /org\.springdoc\.openapi-gradle-plugin/.test(readFileSync(gradle, 'utf8')) : null;
  console.log(JSON.stringify({ root, applied: apply, plan, peerExists: peer ? existsSync(path.resolve(root, peer)) : null, springdocGradlePlugin: role === 'backend' ? hasPlugin : undefined }, null, 2));
} else {
  console.log('사용법: cli.mjs spec | usages <검색어> | sync | setup --role backend|frontend --peer <경로> [--apply]');
}
