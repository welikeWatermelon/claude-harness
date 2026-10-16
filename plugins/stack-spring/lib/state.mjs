// state.mjs — 프로젝트 로컬 런타임 상태 (<project>/.harness/, git 제외)
//   .harness/mode                 현재 모드 (사용자만 바꿀 수 있음: UserPromptSubmit 훅이 기록)
//   .harness/state/<session>.json 세션 상태 (변경 파일, 승인 토큰, Stop 루프 카운터)
//   .harness/logs/YYYY-MM-DD.jsonl 이벤트 로그
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';

export const MODES = {
  standard: '기본. 보호 브랜치·위험 명령·시크릿만 막고, 모호한 요청엔 Plan 먼저 하도록 안내',
  strict: '계획 승인(ExitPlanMode 수락) 전에는 파일 수정·변경성 Bash 전부 차단 (v1 하네스 동작)',
  night: '무인 실행. 파일 편집만 허용, 빌드·테스트·서버 접속·git 쓰기 차단 (KEEPING v3 정적 세트 방식)',
  readonly: '분석 전용. 파일 수정과 변경성 명령 전부 차단 (devmonitor 방식)',
  ops: '운영 작업. 원격 명령도 허용하되 모두 확인(ask)받고 기록',
};

export function harnessDir(root) {
  return path.join(root, '.harness');
}

function ensureDir(d) {
  mkdirSync(d, { recursive: true });
  return d;
}

export function getMode(root, cfg) {
  try {
    const m = readFileSync(path.join(harnessDir(root), 'mode'), 'utf8').trim();
    if (MODES[m]) return m;
  } catch {}
  return MODES[cfg?.defaultMode] ? cfg.defaultMode : 'standard';
}

export function setMode(root, mode) {
  if (!MODES[mode]) throw new Error(`알 수 없는 모드: ${mode}`);
  ensureDir(harnessDir(root));
  writeFileSync(path.join(harnessDir(root), 'mode'), mode + '\n', 'utf8');
}

function sessionFile(root, sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^\w.-]/g, '_');
  return path.join(ensureDir(path.join(harnessDir(root), 'state')), `${safe}.json`);
}

export function loadSession(root, sessionId) {
  try {
    return JSON.parse(readFileSync(sessionFile(root, sessionId), 'utf8'));
  } catch {
    return { changedFiles: [], turnFiles: [], token: null, stopBlocks: 0, dirty: {} };
  }
}

export function saveSession(root, sessionId, s) {
  writeFileSync(sessionFile(root, sessionId), JSON.stringify(s, null, 2), 'utf8');
}

export function updateSession(root, sessionId, fn) {
  const s = loadSession(root, sessionId);
  const next = fn(s) || s;
  saveSession(root, sessionId, next);
  return next;
}

/** 오래된 상태/로그 파일 정리 */
export function cleanup(root, retentionDays = 30) {
  const limit = Date.now() - retentionDays * 86400_000;
  for (const sub of ['state', 'logs']) {
    const d = path.join(harnessDir(root), sub);
    let names = [];
    try {
      names = readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      const f = path.join(d, n);
      try {
        if (statSync(f).mtimeMs < limit) rmSync(f, { force: true });
      } catch {}
    }
  }
}
