// code-rules.mjs — 코드 규칙 엔진
//
// 원칙
//   1) 신규 위반만: 수정 전 파일에 이미 있던 위반은 문제 삼지 않음 (기존 코드 때문에 작업이 막히지 않게)
//   2) 규칙마다 기본 강도(block/warn)가 있고, .claude/harness.json 의 rules 로 off/warn/block 을 바꿀 수 있음
//        { "rules": { "S6": "off", "R4": "block" } }
//   3) block → PreToolUse 에서 수정 자체를 거부, warn → 수정은 허용하고 PostToolUse 에서 Claude 에게 알림
//
// 규칙 정의
//   { id, title, severity: 'block'|'warn', files: RegExp, when?(ctx)=>bool, check(text, ctx) => [{ line, msg }] }
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Edit/Write/MultiEdit 를 적용했을 때의 결과 텍스트. 계산할 수 없으면 null */
export function applyEdit(oldText, toolName, ti = {}) {
  if (toolName === 'Write') return String(ti.content ?? '');
  const base = oldText ?? '';
  const one = (text, o, n, all) => {
    if (o === undefined || o === null) return text;
    if (!text.includes(o)) return null;
    return all ? text.split(o).join(n) : text.replace(o, () => n);
  };
  if (toolName === 'Edit') return one(base, ti.old_string, ti.new_string ?? '', !!ti.replace_all);
  if (toolName === 'MultiEdit' && Array.isArray(ti.edits)) {
    let t = base;
    for (const e of ti.edits) {
      t = one(t, e.old_string, e.new_string ?? '', !!e.replace_all);
      if (t === null) return null;
    }
    return t;
  }
  return null;
}

export function readText(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** 정규식 전역 매칭 → [{line, match}] */
export function findAll(text, re) {
  const out = [];
  const g = re.global ? re : new RegExp(re.source, re.flags + 'g');
  g.lastIndex = 0;
  let m;
  while ((m = g.exec(text))) {
    out.push({ line: lineOf(text, m.index), m });
    if (m[0].length === 0) g.lastIndex++;
  }
  return out;
}

export function severityOf(rule, cfg) {
  const o = cfg && cfg.rules ? cfg.rules[rule.id] : undefined;
  if (o === 'off' || o === 'warn' || o === 'block') return o;
  return rule.severity;
}

function keyOf(text, v) {
  const lines = text.split(/\r?\n/);
  return (lines[v.line - 1] || '').trim() + '|' + v.msg;
}

/**
 * 규칙 평가 — 새 텍스트에서 나온 위반 중, 수정 전 텍스트에 같은 줄·같은 메시지로 없던 것만 돌려줌
 * @returns {{id,title,severity,line,msg}[]}
 */
export function evaluate(rules, { rel, oldText, newText, ctx }) {
  const out = [];
  const r = rel.replace(/\\/g, '/');
  for (const rule of rules) {
    const sev = severityOf(rule, ctx.cfg);
    if (sev === 'off') continue;
    if (rule.files && !rule.files.test(r)) continue;
    if (rule.when && !rule.when({ ...ctx, rel: r })) continue;
    let after = [];
    try {
      after = rule.check(newText, { ...ctx, rel: r }) || [];
    } catch {
      continue;
    }
    if (!after.length) continue;
    let before = [];
    if (oldText) {
      try {
        before = rule.check(oldText, { ...ctx, rel: r, isOld: true }) || [];
      } catch {}
    }
    const seen = new Map();
    for (const b of before) {
      const k = keyOf(oldText, b);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const a of after) {
      const k = keyOf(newText, a);
      const c = seen.get(k) || 0;
      if (c > 0) {
        seen.set(k, c - 1);
        continue;
      }
      out.push({ id: rule.id, title: rule.title, severity: sev, line: a.line, msg: a.msg });
    }
  }
  return out;
}

export function formatViolations(rel, list) {
  return list.map((v) => `  [${v.id}] ${rel}:${v.line} — ${v.msg}`).join('\n');
}

// ---------------- 프로젝트 정보 (규칙이 참고) ----------------

const cache = new Map();
/** 파일에서 위로 올라가며 찾은 첫 빌드/패키지 파일 텍스트 */
export function nearestFileText(startAbs, names, stopRoot) {
  let dir = path.dirname(startAbs);
  const end = path.resolve(stopRoot || path.parse(dir).root);
  for (;;) {
    for (const n of names) {
      const p = path.join(dir, n);
      if (existsSync(p)) {
        if (!cache.has(p)) cache.set(p, readText(p) || '');
        return { path: p, text: cache.get(p) };
      }
    }
    if (path.resolve(dir) === end) return null;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function buildFile(ctx) {
  return nearestFileText(ctx.abs, ['build.gradle', 'build.gradle.kts', 'pom.xml'], ctx.root);
}

export function packageJson(ctx) {
  const f = nearestFileText(ctx.abs, ['package.json'], ctx.root);
  if (!f) return null;
  try {
    const j = JSON.parse(f.text);
    return { ...j, _deps: { ...(j.dependencies || {}), ...(j.devDependencies || {}) }, _dir: path.dirname(f.path) };
  } catch {
    return null;
  }
}
