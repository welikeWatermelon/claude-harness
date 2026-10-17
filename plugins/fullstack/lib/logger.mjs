// logger.mjs — 이벤트 로그 (jsonl). 프롬프트·명령에 섞인 토큰류는 마스킹합니다.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { harnessDir } from './state.mjs';

const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /((?:password|passwd|secret|api[_-]?key|token)\s*[=:]\s*)(["']?)[^\s"'$]{6,}\2/gi,
];

export function redact(text) {
  let s = String(text ?? '');
  for (const re of SECRET_PATTERNS) {
    s = s.replace(re, (m, p1) => (typeof p1 === 'string' && p1.length < m.length && /[=:]/.test(p1) ? `${p1}***` : '***REDACTED***'));
  }
  return s;
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 이벤트 한 줄 기록. 실패해도 예외를 던지지 않습니다. */
export function logEvent(root, cfg, sessionId, type, data = {}, file = null) {
  if (cfg && cfg.log && cfg.log.enabled === false) return;
  try {
    const dir = path.join(harnessDir(root), 'logs');
    mkdirSync(dir, { recursive: true });
    const rec = { ts: new Date().toISOString(), session: sessionId || 'unknown', type, ...data };
    let line = JSON.stringify(rec);
    if (!cfg || !cfg.log || cfg.log.redact !== false) line = redact(line);
    appendFileSync(path.join(dir, file || `${today()}.jsonl`), line + '\n', 'utf8');
  } catch {}
}
