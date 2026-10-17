// contract.mjs — fullstack 플러그인 공통 로직 (명세 생성, 비교, 프론트 사용처 검색)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { run, tail } from '../lib/proc.mjs';
import { detectJvmBuild } from '../lib/build-detect.mjs';
import { diffOpenApi, searchTerms } from '../lib/openapi-diff.mjs';

export const API_FILE = /(Controller|Dto|DTO|Request|Response|ErrorCode|ExceptionHandler|Advice|Api)\.(java|kt)$|[\\/](dto|controller|api|web)[\\/].*\.(java|kt)$/;

export function fsCfg(cfg) {
  return cfg.fullstack || {};
}

export function peerRoot(root, fs) {
  return fs.peerPath ? path.resolve(root, fs.peerPath) : null;
}

/** springdoc 명세 생성 → JSON 객체 */
export function generateSpec(root, fs) {
  const o = fs.openapi || {};
  const modDir = path.resolve(root, fs.backendModule || '.');
  let cmd, args, cwd;
  if (Array.isArray(o.generateCommand) && o.generateCommand.length) {
    [cmd, ...args] = o.generateCommand;
    cwd = modDir;
  } else {
    const b = detectJvmBuild(modDir, root);
    if (!b) return { ok: false, error: `빌드 파일을 찾지 못했어요 (${modDir})` };
    if (b.tool !== 'gradle') return { ok: false, error: 'Maven 프로젝트는 fullstack.openapi.generateCommand 를 지정해주세요 (예: ["./mvnw","-q","verify"])' };
    cmd = b.runner;
    const rel = path.relative(b.runnerDir, b.moduleDir);
    args = ['-q', '--console=plain', ...(rel ? ['-p', b.moduleDir] : []), o.gradleTask || 'generateOpenApiDocs'];
    cwd = b.runnerDir;
  }
  const r = run(cmd, args, { cwd, timeoutSec: o.timeoutSec || 300 });
  const out = path.resolve(modDir, o.generatedFile || 'build/openapi.json');
  if (!r.ok) return { ok: false, error: `명세 생성 실패 (${path.basename(cmd)} ${args.join(' ')})\n${tail(r.out, 20)}` };
  if (!existsSync(out)) return { ok: false, error: `명세 파일이 없어요: ${out}` };
  try {
    return { ok: true, spec: JSON.parse(readFileSync(out, 'utf8')), file: out };
  } catch (e) {
    return { ok: false, error: `명세 JSON 파싱 실패: ${e.message}` };
  }
}

export function snapshotPath(root, fs) {
  return path.resolve(root, fs.backendModule || '.', (fs.openapi || {}).snapshot || 'docs/api/openapi.json');
}

/** 생성 → 스냅샷과 비교 → 스냅샷 갱신. {first, changes} */
export function compareAndSave(root, fs, gen) {
  const snap = snapshotPath(root, fs);
  let old = null;
  try {
    old = JSON.parse(readFileSync(snap, 'utf8'));
  } catch {}
  mkdirSync(path.dirname(snap), { recursive: true });
  writeFileSync(snap, JSON.stringify(gen.spec, null, 2) + '\n', 'utf8');
  if (!old) return { first: true, changes: [], snapshot: snap };
  return { first: false, changes: diffOpenApi(old, gen.spec), snapshot: snap };
}

const SKIP = new Set(['node_modules', 'dist', 'build', '.next', '.git', 'coverage']);
function walk(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let ents = [];
  try {
    ents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (/\.(tsx?|jsx?|vue)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 프론트 레포에서 변경 영향 사용처 찾기. display=화면 컴포넌트에서 쓰이는지(추정) */
export function findUsages(peer, fs, changes, limitPerChange = 8) {
  if (!peer || !existsSync(peer)) return [];
  const src = path.join(peer, (fs.frontend || {}).srcDir || 'src');
  const files = walk(existsSync(src) ? src : peer);
  const cache = new Map();
  const read = (f) => {
    if (!cache.has(f)) {
      try {
        cache.set(f, readFileSync(f, 'utf8').split(/\r?\n/));
      } catch {
        cache.set(f, []);
      }
    }
    return cache.get(f);
  };
  const result = [];
  for (const ch of changes) {
    const hits = [];
    for (const term of searchTerms(ch)) {
      const re = term.startsWith('/') ? new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      for (const f of files) {
        read(f).forEach((line, i) => {
          if (hits.length < limitPerChange && re.test(line)) {
            const rel = path.relative(peer, f).replace(/\\/g, '/');
            const display = /\.(tsx|jsx|vue)$/.test(f) && !/(^|\/)(api|apis|types|generated|services?|hooks)\//.test(rel);
            hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120), display });
          }
        });
      }
      if (hits.length) break;
    }
    result.push({ change: ch, usages: hits });
  }
  return result;
}

export function appendChangeLog(root, fs, changes, note = '') {
  const f = path.resolve(root, fs.backendModule || '.', 'docs/api/API_CHANGES.md');
  mkdirSync(path.dirname(f), { recursive: true });
  if (!existsSync(f)) writeFileSync(f, '# API 변경 기록\n\n자동 기록: fullstack 플러그인이 OpenAPI 스냅샷 비교 결과를 남겨요. 프론트 대응 결과는 각 항목 아래에 적어주세요.\n', 'utf8');
  const d = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines = [`\n## ${d}${note ? ` — ${note}` : ''}`, ...changes.map((c) => `- [${c.severity === 'breaking' ? '깨짐' : '호환'}] ${c.target} — ${c.detail}`)];
  appendFileSync(f, lines.join('\n') + '\n', 'utf8');
  return f;
}

export function isNewer(a, b) {
  try {
    return statSync(a).mtimeMs > statSync(b).mtimeMs;
  } catch {
    return existsSync(a) && !existsSync(b);
  }
}

export { copyFileSync };
