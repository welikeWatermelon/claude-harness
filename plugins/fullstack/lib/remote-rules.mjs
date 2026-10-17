// remote-rules.mjs — 원격(서버·클라우드) 명령 판별
// KEEPING 성능 실험에서 AI 가 서버 터미널에 접속해 변인을 바꿔가며 측정한 경험 →
// "AI 서버 접근 권한 범위와 명령 로그" 를 구조로 만든 것.

const REMOTE = /\b(ssh|scp|sftp|rsync)\b|\baws\s+\w+|\bkubectl\b|\bhelm\b|\bgcloud\b|\baz\s+\w+|\bdocker\s+(-H|--host|--context)\b|\bdocker\s+context\s+use\b|\bterraform\s+(apply|destroy|import|state)\b/;

const REMOTE_DESTRUCTIVE = [
  /\brm\s+-[a-zA-Z]*[rf]/,
  /\bdocker\s+(rm|rmi|kill|stop|system\s+prune|volume\s+(rm|prune)|network\s+rm)\b/,
  /\bdocker[\s-]compose\s+(down|rm|kill|stop)\b/,
  /\bsystemctl\s+(stop|restart|disable|mask)\b/,
  /\bkill\s+-9\b|\bpkill\b|\bkillall\b/,
  /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)?/i,
  /\bDELETE\s+FROM\b/i,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\baws\s+ec2\s+(terminate-instances|stop-instances|delete-\w+)\b/,
  /\baws\s+s3\s+(rm|rb)\b|\baws\s+s3\s+sync\b.*--delete/,
  /\baws\s+rds\s+delete-\w+|\baws\s+\w+\s+delete-\w+/,
  /\bkubectl\s+(delete|drain|cordon|scale\s+.*--replicas=0)\b/,
  /\bterraform\s+destroy\b/,
  /\bhelm\s+(uninstall|delete)\b/,
  /\bchmod\s+(-R\s+)?777\b/,
  /\bcrontab\s+-r\b/,
];

export function isRemote(cmd) {
  return REMOTE.test(String(cmd || ''));
}

/** ssh/scp/rsync 대상 호스트 추출 (user@host 또는 host) */
export function remoteHosts(cmd) {
  const hosts = new Set();
  const s = String(cmd || '');
  for (const m of s.matchAll(/\b(?:ssh|sftp)\s+((?:-[a-zA-Z]+\s+(?:\S+\s+)?)*)([\w.-]+@)?([\w.-]+)/g)) {
    if (m[3] && !m[3].startsWith('-')) hosts.add(m[3]);
  }
  for (const m of s.matchAll(/(?:^|\s)(?:[\w.-]+@)?([\w.-]+):[^\s]*/g)) {
    if (/\b(scp|rsync)\b/.test(s) && !/^[A-Za-z]$/.test(m[1])) hosts.add(m[1]);
  }
  return [...hosts];
}

export function destructiveRemote(cmd) {
  const s = String(cmd || '');
  if (!isRemote(s)) return null;
  for (const re of REMOTE_DESTRUCTIVE) if (re.test(s)) return re.source;
  return null;
}

export function looksProd(cmd, keywords = ['prod', 'production', 'live']) {
  const s = String(cmd || '').toLowerCase();
  return keywords.some((k) => new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(s));
}
