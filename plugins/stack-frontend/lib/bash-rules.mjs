// bash-rules.mjs — Bash 명령 분류기
//
// v1(~/.harness) 운영 로그에서 확인한 오탐을 반영했습니다.
//   - `docker exec ...` 가 \bexec\b 에 걸림        → exec 는 "세그먼트 맨 앞"일 때만 동적 실행으로 봄
//   - `docker ps --format ...` 가 \bformat\b 에 걸림 → Windows `format X:` 형태만 매칭
//   - 2>&1, 2>/dev/null 같은 리다이렉트              → 파일 쓰기 리다이렉트만 변경으로 분류
//
// classify(command) 반환값
//   { verdict: 'deny'|'ask'|'ok', reason, rule, mutating:boolean, categories:Set<string> }
//   categories: build | test | remote | gitWrite | install | fsWrite | db | secretRead | network

const SEG_SPLIT = /\s*(?:&&|\|\||;|\||\r?\n)\s*/;

function segments(cmd) {
  return String(cmd || '')
    .split(SEG_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 항상 거부 — 되돌릴 수 없거나 하네스 우회
const DENY = [
  { id: 'rm-root', re: /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*\s+|--recursive\s+)+(-[a-zA-Z]+\s+)*("?)(\/|~|\$HOME|\*|\.\.?\/?|[A-Za-z]:[\\/]?)\3(\s|$)/, reason: '루트·홈·현재 폴더 전체를 지우는 rm -r 명령이에요.' },
  { id: 'git-push-force', re: /\bgit\s+push\b(?=.*(\s-f\b|\s--force\b(?!-with-lease)|\s\+\S))/, reason: 'git push --force 는 원격 히스토리를 덮어써요. 꼭 필요하면 --force-with-lease 를 쓰고 사용자에게 직접 실행을 요청하세요.' },
  { id: 'git-no-verify', re: /\bgit\s+(commit|push)\b.*\s--no-verify\b/, reason: '--no-verify 는 git 훅 검사를 건너뛰어요.' },
  { id: 'curl-pipe-shell', re: /\b(curl|wget|iwr|Invoke-WebRequest)\b.*\|\s*(ba|z)?sh\b|\biex\s*\(/i, reason: '원격 스크립트를 내려받아 바로 실행하는 명령이에요.' },
  { id: 'disk-destroy', re: /\b(mkfs(\.\w+)?|diskpart)\b|\bdd\s+.*\bof=\/dev\/|^\s*format\s+[A-Za-z]:/i, reason: '디스크를 포맷하거나 덮어쓰는 명령이에요.' },
  { id: 'power', re: /^\s*(sudo\s+)?(shutdown|reboot|halt|poweroff)\b|\bStop-Computer\b|\bRestart-Computer\b/i, reason: '시스템 전원 명령이에요.' },
  { id: 'sql-drop-db', re: /\bDROP\s+(DATABASE|SCHEMA)\b/i, reason: 'DROP DATABASE/SCHEMA 는 되돌릴 수 없어요.' },
  { id: 'harness-tamper', re: /(\.harness[\\/](mode|state)|harness\.local\.json)/, reason: '하네스 상태 파일은 사용자만 바꿀 수 있어요. 모드 변경은 사용자가 /core:mode 로 합니다.', onlyIfMutating: true },
];

// 확인 필요 — 의도된 경우가 있지만 실수면 손실이 큼
const ASK = [
  { id: 'git-reset-hard', re: /\bgit\s+reset\s+--hard\b/, reason: 'git reset --hard 는 커밋 안 된 변경을 지워요.' },
  { id: 'git-clean', re: /\bgit\s+clean\s+-[a-zA-Z]*f/, reason: 'git clean -f 는 추적 안 된 파일을 지워요.' },
  { id: 'git-discard', re: /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, reason: '작업 트리의 변경을 전부 버리는 명령이에요.' },
  { id: 'git-branch-D', re: /\bgit\s+branch\s+-D\b/, reason: '머지 안 된 브랜치를 강제 삭제해요.' },
  { id: 'git-force-lease', re: /\bgit\s+push\b.*--force-with-lease/, reason: 'force-with-lease 푸시예요.' },
  { id: 'sql-destructive', re: /\b(DROP\s+TABLE|TRUNCATE(\s+TABLE)?\s+\w+|ALTER\s+TABLE\s+\w+\s+DROP\b)/i, reason: '테이블을 지우거나 비우는 SQL 이에요.' },
  { id: 'sql-delete-no-where', re: /\bDELETE\s+FROM\s+[\w."`]+\s*(;|"|'|$)(?![\s\S]*\bWHERE\b)/i, reason: 'WHERE 없는 DELETE 예요.' },
  { id: 'chmod-777', re: /\bchmod\s+(-R\s+)?777\b/, reason: '권한을 777 로 여는 명령이에요.' },
  { id: 'publish', re: /\b(npm|pnpm|yarn)\s+publish\b|\bgradlew?\S*\s+.*\bpublish\b|\bmvnw?\S*\s+.*\bdeploy\b/, reason: '패키지를 외부 저장소에 배포하는 명령이에요.' },
  { id: 'sudo', re: /^\s*sudo\b/, reason: '관리자 권한 명령이에요.' },
];

const SECRET_READ = /\b(cat|type|less|more|head|tail|bat|Get-Content|gc|nl|xxd|strings|grep|rg|sed|awk)\b[^|]*?((^|[\s"'\\/=])\.env(\.(?!example\b|sample\b|template\b)\w+)?(\s|"|'|$)|\.(pem|key|p12|pfx|jks)\b|\bid_(rsa|ed25519|ecdsa)\b|application-prod\.(ya?ml|properties)|\bbackend\.env\b|\.mcp\.json)/i;
const SECRET_PRINT = /^\s*(printenv|env)\s*$|^\s*(echo|printf)\s+.*\$\{?\w*(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE)\w*\}?/i;

// 분류용 패턴
const CAT = {
  build: /(^|[\s/\\])(\.\/)?(gradlew(\.bat)?|gradle|mvnw(\.cmd)?|mvn)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(build|dev|start|test|lint|typecheck)\b|\bnpx\s+(tsc|vite|next|eslint|jest|vitest)\b|\bdocker(\s+compose|-compose)?\s+(build|up|run|compose)\b|\bjava\s+-jar\b/,
  test: /\b(gradlew(\.bat)?|gradle|mvnw(\.cmd)?|mvn)\b.*\b(test|check|verify|build)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(jest|vitest|pytest)\b|\bk6\s+run\b/,
  remote: /\b(ssh|scp|sftp|rsync)\b|\baws\s+(ssm|ec2|ecs|rds|s3|ecr|lambda|cloudformation|iam)\b|\bkubectl\b|\bhelm\b|\bgcloud\b|\baz\s+\w|\bdocker\s+(-H|--host|context)\b|\bterraform\s+(apply|destroy|import)\b/,
  gitWrite: /\bgit\s+(commit|push|merge|rebase|reset|revert|cherry-pick|tag|stash\s+(drop|clear|pop)|branch\s+-[dDmM]|checkout|switch|pull|am|apply)\b/,
  install: /\b(npm|pnpm|yarn|bun)\s+(install|i|add|remove|rm|uninstall|update|up)\b|\bpip3?\s+(install|uninstall)\b|\b(apt(-get)?|brew|choco|winget|scoop)\s+(install|remove|uninstall|upgrade)\b/,
  fsWrite: /(^|\s)(rm|rmdir|del|erase|rd|mv|move|cp|copy|xcopy|robocopy|mkdir|md|touch|ln|chmod|chown|unlink|truncate|New-Item|Remove-Item|Move-Item|Copy-Item|Set-Content|Add-Content|Out-File)\b|\bsed\s+(-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i|\btee\b|(^|[^0-9&>])>>?\s*(?!&|\/dev\/null|nul\b|\$null)[^\s]/i,
  db: /\b(psql|mysql|mariadb|sqlcmd|mongosh|redis-cli)\b|\bflyway\s+(migrate|clean|repair)\b|\b(liquibase)\s+update\b/,
  network: /\b(curl|wget|Invoke-WebRequest|iwr|http)\b/,
};

const GIT_READ_ONLY = /\bgit\s+(status|log|diff|show|blame|branch(\s+(-a|-r|--list|-v+|--show-current))?\s*$|rev-parse|ls-files|remote\s+-v|fetch|grep|shortlog|describe|config\s+--get)/;

export function classify(command) {
  const cmd = String(command || '');
  const segs = segments(cmd);
  const categories = new Set();
  for (const seg of segs) {
    for (const [name, re] of Object.entries(CAT)) {
      if (re.test(seg)) {
        if (name === 'gitWrite' && GIT_READ_ONLY.test(seg) && !/\bgit\s+(checkout|switch|pull)\b/.test(seg)) continue;
        categories.add(name);
      }
    }
    // 동적 실행: 세그먼트 맨 앞에서만 (docker exec / kubectl exec 오탐 방지)
    if (/^(eval|exec|source|\.)\s+\S/.test(seg) || /^(ba|z)?sh\s+-c\b/.test(seg) || /^(powershell|pwsh)(\.exe)?\s+.*-(c|command|enc|encodedcommand)\b/i.test(seg)) {
      categories.add('dynamic');
    }
  }
  const mutating = ['gitWrite', 'install', 'fsWrite', 'db', 'dynamic'].some((c) => categories.has(c));

  for (const r of DENY) {
    if (r.onlyIfMutating && !mutating) continue;
    if (r.re.test(cmd) || segs.some((s) => r.re.test(s))) return { verdict: 'deny', rule: r.id, reason: r.reason, mutating, categories };
  }
  if (SECRET_READ.test(cmd) || segs.some((s) => SECRET_PRINT.test(s))) {
    categories.add('secretRead');
    return { verdict: 'deny', rule: 'secret-read', reason: '시크릿 파일(.env, *.pem, application-prod.yml, .mcp.json 등)이나 시크릿 환경변수를 출력하는 명령이에요. 필요한 키 이름만 알려달라고 사용자에게 요청하세요.', mutating, categories };
  }
  for (const r of ASK) {
    if (r.re.test(cmd) || segs.some((s) => r.re.test(s))) return { verdict: 'ask', rule: r.id, reason: r.reason, mutating, categories };
  }
  return { verdict: 'ok', rule: null, reason: '', mutating, categories };
}

/** git push 대상이 보호 브랜치인지 */
export function pushTargetsProtected(command, protectedBranches, currentBranch) {
  for (const seg of segments(command)) {
    const m = seg.match(/\bgit\s+push\b(.*)$/);
    if (!m) continue;
    const args = m[1].split(/\s+/).filter((a) => a && !a.startsWith('-'));
    const refs = args.slice(1); // 첫 인자는 remote
    if (refs.length === 0) {
      if (currentBranch && protectedBranches.includes(currentBranch)) return currentBranch;
      continue;
    }
    for (const ref of refs) {
      const dst = ref.includes(':') ? ref.split(':').pop() : ref;
      const name = dst.replace(/^\+/, '').replace(/^refs\/heads\//, '');
      if (name === 'HEAD' && currentBranch && protectedBranches.includes(currentBranch)) return currentBranch;
      if (protectedBranches.includes(name)) return name;
    }
  }
  return null;
}

export function isGitCommit(command) {
  return segments(command).some((s) => /^git\s+(-C\s+\S+\s+)?commit\b/.test(s) || /\bgit\s+commit\b/.test(s));
}

/** 브랜치를 새로 만들어 이동하는 명령인지 (보호 브랜치에서도 허용) */
export function isBranchCreate(command) {
  const segs = segments(command);
  return segs.length > 0 && segs.every((s) => /^git\s+(checkout\s+-b|switch\s+(-c|--create))\s+\S+/.test(s) || /^git\s+(status|branch|fetch|stash(\s+push)?)\b/.test(s));
}
