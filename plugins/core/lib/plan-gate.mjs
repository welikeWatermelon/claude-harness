// plan-gate.mjs — 계획 승인 게이트
//
// 누구에게 걸리나
//   - 기본: 아무에게도 안 걸림 (본인·동등한 동료는 계획 없이 바로 작업)
//   - .claude/harness.json 의 planGate.requiredFor 에 git user.email / user.name 이 있는 팀원 → 자동 적용
//   - 본인이 원하면 /core:mode strict 로 스스로 켤 수 있음
//   requiredFor 는 팀 공용 harness.json 에서만 읽어요 (개인 harness.local.json 으로 빼지 못하게).
//   단, git 설정은 본인이 바꿀 수 있으므로 보안 경계가 아니라 "팀 합의 장치"예요.
//
// 승인 범위 (scope=files)
//   - ExitPlanMode 계획의 "## 변경 파일" 섹션에 적힌 파일만, 다음 메시지에서도 계속 수정 가능
//   - 계획 폴더 안의 새 파일 / 테스트 파일은 허용 (설정으로 끌 수 있음)
//   - 끝나는 시점: 새 계획 승인 · /core:plan-done · 브랜치 변경 · 세션 종료 · 모드 변경 · ttlHours 경과
//   - 파일 섹션을 못 찾으면 그 턴에만 유효 (scope=turn)
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';

export const TEST_PATH = /(^|\/)(src\/test\/|test\/|tests\/|__tests__\/)|\.(test|spec)\.[cm]?[jt]sx?$|Tests?\.(java|kt)$/;

export function identity(root) {
  const email = git(['config', 'user.email'], root).out.trim();
  const name = git(['config', 'user.name'], root).out.trim();
  return { email, name };
}

/** 팀 공용 harness.json 에서만 requiredFor 를 읽음 */
export function teamRequiredFor(root) {
  try {
    const j = JSON.parse(readFileSync(path.join(root, '.claude', 'harness.json'), 'utf8').replace(/^﻿/, ''));
    const list = j?.planGate?.requiredFor;
    return Array.isArray(list) ? list.map((s) => String(s).trim().toLowerCase()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** @returns {{active:boolean, reason:'strict-mode'|'team-member'|null, who:string}} */
export function gateStatus(root, mode) {
  const id = identity(root);
  const who = id.email || id.name || '(git 사용자 미설정)';
  if (mode === 'strict') return { active: true, reason: 'strict-mode', who };
  const req = teamRequiredFor(root);
  if (req.length && [id.email, id.name].some((v) => v && req.includes(v.toLowerCase()))) return { active: true, reason: 'team-member', who };
  return { active: false, reason: null, who };
}

const FILE_SECTION = /^#{1,4}\s*(변경\s*파일|변경할\s*파일|수정\s*파일|files?(\s+to\s+change)?|what\s+will\s+change|changed\s+files)(?=\s|$|[:：(])[^\n]*$/im;
const PATH_TOKEN = /(?:^|[\s`'"(\[:-])((?:[A-Za-z]:[/\\])?(?:\.{0,2}[/\\])?(?:[\w.@-]+[/\\])*[\w.@-]+(?:\.[A-Za-z0-9]{1,8}|[/\\]))(?=$|[\s`'"),\]:])/g;

/** 계획 본문에서 "## 변경 파일" 섹션의 경로만 추출 */
export function parsePlanScope(plan, root) {
  const text = String(plan || '');
  const m = text.match(FILE_SECTION);
  if (!m) return { files: [], dirs: [] };
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^#{1,4}\s+\S/m);
  const section = next >= 0 ? rest.slice(0, next) : rest;
  const files = new Set();
  const dirs = new Set();
  for (const mm of section.matchAll(PATH_TOKEN)) {
    let p = mm[1].replace(/\\/g, '/');
    if (/^https?:/.test(p) || /^\d+(\.\d+)*$/.test(p)) continue;
    if (path.isAbsolute(p)) p = path.relative(root, p).replace(/\\/g, '/');
    p = p.replace(/^\.\//, '');
    if (!p || p.startsWith('..')) continue;
    if (p.endsWith('/')) dirs.add(p.replace(/\/+$/, ''));
    else if (/\.[A-Za-z0-9]{1,8}$/.test(p)) {
      files.add(p);
      dirs.add(path.posix.dirname(p));
    }
  }
  return { files: [...files], dirs: [...dirs].filter((d) => d && d !== '.') };
}

/** 토큰이 아직 유효한지 */
export function tokenValid(token, { branch, mode, now = Date.now(), ttlHours = 3, promptCount = 0 }) {
  if (!token) return { ok: false, why: '승인된 계획이 없어요' };
  if (token.scope === 'turn' && token.turn !== promptCount) return { ok: false, why: '이전 메시지에서 받은 승인이라 끝났어요 (계획에 변경 파일 목록이 없었음)' };
  if (token.branch && branch && token.branch !== branch) return { ok: false, why: `승인받을 때 브랜치(${token.branch})와 지금 브랜치(${branch})가 달라요` };
  if (token.mode && mode && token.mode !== mode) return { ok: false, why: `승인 이후 모드가 바뀌었어요(${token.mode} → ${mode})` };
  if (now - Date.parse(token.approvedAt) > ttlHours * 3600_000) return { ok: false, why: `승인 후 ${ttlHours}시간이 지났어요` };
  return { ok: true, why: '' };
}

/** 파일이 승인 범위 안인지 */
export function fileInScope(token, rel, absPath, gateCfg = {}) {
  if (!token || token.scope === 'turn') return { ok: true };
  const r = rel.replace(/\\/g, '/');
  if (token.files.includes(r)) return { ok: true };
  if (gateCfg.allowTestFiles !== false && TEST_PATH.test(r)) return { ok: true, why: 'test' };
  const isNew = absPath ? !existsSync(absPath) : false;
  if (isNew && gateCfg.allowNewFilesInPlannedDirs !== false && token.dirs.some((d) => r === d || r.startsWith(d + '/'))) return { ok: true, why: 'new-in-dir' };
  return { ok: false };
}
