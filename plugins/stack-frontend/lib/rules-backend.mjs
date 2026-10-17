// rules-backend.mjs — Spring 이 아닌 백엔드 규칙 (Node / Python / Go / Kotlin·Java)
//   B1  SQL 문자열 이어붙이기·보간                         warn
//   B2  이미 커밋된 마이그레이션 수정 (pre-edit 에서 처리)   block
//   B3  하드코딩된 비밀값 (알려진 키 형식 + 이름=리터럴)      block
//   B4  민감정보 로그                                       warn
//   B5  eval / shell=True / yaml.load / pickle 등 위험 API  warn
//   B6  Python bare except, 가변 기본 인자                  warn
//   B7  Go 에러 무시 (_ = f(), v, _ := f())                 warn
//   B8  Express cors() 무옵션, 에러 상세를 응답으로          warn
//   B9  디버그 설정이 켜진 채로 (DEBUG=True, debug=True 등)  warn
//   B10 (Stop) 소스만 바꾸고 테스트는 안 바꿈                warn
//   B11 Kotlin !! · runBlocking                             warn
import { findAll } from './code-rules.mjs';

const CODE = /\.(ts|js|mjs|cjs|mts|cts|py|go|java|kt|kts|rb|php|cs|swift)$/;
export const IS_TEST = (rel) => /(^|\/)(tests?|__tests__|spec|testdata|fixtures?|mocks?)\/|(_test\.go|\.test\.[jt]s|\.spec\.[jt]s|test_[\w-]+\.py|_test\.py|Test\.(java|kt)|Tests?\.swift)$/.test(rel);
const notTest = (ctx) => !IS_TEST(ctx.rel);

const KNOWN_KEYS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS Access Key'],
  [/\bsk_live_[0-9a-zA-Z]{20,}/, 'Stripe live key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}/, 'Slack token'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, '개인키'],
  [/\bsk-(proj-|ant-)?[A-Za-z0-9_-]{32,}/, 'OpenAI/Anthropic API key'],
];
const PLACEHOLDER = /^(changeme|change-me|xxx+|your[-_]|example|sample|dummy|test|fake|placeholder|<|\$\{|\{\{|\*+$|todo|none|null|secret$|password$)/i;
const NAMED = /\b([\w-]*?(password|passwd|secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth[_-]?token|client[_-]?secret|token)([_-]?(key|value))?)\b["']?\s*(?::\s*[\w<>\[\]?]+\s*)?[:=]\s*["'`]([^"'`\s]{8,})["'`]/gi;

/** B3 — 백엔드·프론트(앱) 공통으로 쓰는 하드코딩 비밀값 검사 */
export function secretCheck(src, ctx) {
  const out = [];
  for (const [re, name] of KNOWN_KEYS) for (const { line } of findAll(src, re)) out.push({ line, msg: `${name} 형식의 값이 코드에 있어요 → 환경변수·시크릿 저장소로 옮기고, 이미 커밋됐다면 키를 폐기(rotate)하세요.` });
  if (!IS_TEST(ctx.rel)) {
    for (const { line, m } of findAll(src, NAMED)) {
      const v = m[5];
      if (/(_|-)?(key|name|header|cookie|param|field|storage|prefix)$/i.test(m[1].replace(/(token|secret|password|passwd)$/i, '')) && /^[\w.-]+$/.test(v) && !/\d/.test(v)) continue; // 저장소 키 이름 상수
      if (/^[a-z][a-zA-Z]*$|^[a-z]+([_.-][a-z]+)+$/.test(v)) continue; // access_token, refreshToken, auth-token-cookie 같은 식별자
      if (PLACEHOLDER.test(v) || /^(process\.env|os\.environ|System\.getenv|env\(|import\.meta)/.test(v)) continue;
      if (/^[A-Z_]+$/.test(v) || /^[a-z]+(\.[a-z]+)+$/.test(v) || /^(https?:|\/)/.test(v)) continue; // ENV_NAME, 설정 키 이름, URL·경로
      out.push({ line, msg: `${m[1]} 에 값이 직접 들어가 있어요 → 환경변수(.env 는 커밋 금지)나 시크릿 매니저에서 읽으세요.` });
    }
  }
  return out;
}

const SQL_KW = '(SELECT|INSERT\\s+INTO|UPDATE\\s+\\w+\\s+SET|DELETE\\s+FROM)\\b';

export const BACKEND_RULES = [
  {
    id: 'B1',
    title: 'SQL 문자열 조합',
    severity: 'warn',
    files: CODE,
    when: notTest,
    check: (src) => {
      const res = [
        new RegExp(`["'][^"'\\n]*${SQL_KW}[^"'\\n]*["']\\s*\\+\\s*\\w`, 'i'), // "SELECT ... " + x
        new RegExp('`[^`]*' + SQL_KW + '[^`]*\\$\\{', 'i'), // `SELECT ... ${x}`
        new RegExp(`\\bf["'][^"'\\n]*${SQL_KW}[^"'\\n]*\\{`, 'i'), // f"SELECT ... {x}"
        new RegExp(`["'][^"'\\n]*${SQL_KW}[^"'\\n]*%s[^"'\\n]*["']\\s*%`, 'i'), // "SELECT %s" % x
        new RegExp(`["'][^"'\\n]*${SQL_KW}[^"'\\n]*["']\\s*\\.format\\(`, 'i'),
        new RegExp(`Sprintf\\(\\s*["\`][^"\`]*${SQL_KW}[^"\`]*%[sv]`, 'i'), // Go fmt.Sprintf("SELECT ... %s")
      ];
      const seen = new Set();
      const out = [];
      for (const re of res)
        for (const { line } of findAll(src, re)) {
          if (seen.has(line)) continue;
          seen.add(line);
          out.push({ line, msg: 'SQL 에 값을 문자열로 이어붙이면 SQL 인젝션 위험 → 바인딩 파라미터(?, $1, :name, %s 인자)를 쓰세요.' });
        }
      return out;
    },
  },
  { id: 'B3', title: '하드코딩된 비밀값', severity: 'block', files: /\.(ts|js|mjs|cjs|py|go|java|kt|kts|rb|php|cs|ya?ml|toml|json|properties)$/, when: (ctx) => !/(package-lock|yarn\.lock|pnpm-lock|\.example|\.sample|\.template)/.test(ctx.rel), check: secretCheck },
  {
    id: 'B4',
    title: '민감정보 로그',
    severity: 'warn',
    files: CODE,
    check: (src) =>
      findAll(src, /\b(console\.(log|info|warn|error|debug)|logger\.\w+|log\.\w+|logging\.\w+|print|println|fmt\.Print\w*|slog\.\w+|zap\.\w+)\s*\(([^\n]*)/)
        .filter(({ m }) => /\b(password|passwd|pwd|token|accessToken|refreshToken|secret|authorization|cardNumber|card_number|cvc|ssn|pin|jwt|cookie)\b/i.test(m[3]))
        .map(({ line }) => ({ line, msg: '비밀번호·토큰·카드번호 같은 민감정보를 로그에 남기지 마세요 → 마스킹하거나 식별자만 남기세요.' })),
  },
  {
    id: 'B5',
    title: '위험한 API',
    severity: 'warn',
    files: CODE,
    when: notTest,
    check: (src, ctx) => {
      const out = [];
      const add = (re, msg) => findAll(src, re).forEach(({ line }) => out.push({ line, msg }));
      if (/\.(ts|js|mjs|cjs)$/.test(ctx.rel)) {
        add(/(^|[^.\w])eval\s*\(|new\s+Function\s*\(/, 'eval / new Function 은 코드 주입 위험 → JSON.parse 나 명시적 분기로 바꾸세요.');
        add(/child_process['"]?\)?\.exec\s*\(|\bexec\s*\(\s*`[^`]*\$\{/, '셸 명령에 값을 끼워 넣으면 명령 주입 위험 → execFile/spawn 에 인자 배열로 넘기세요.');
      }
      if (/\.py$/.test(ctx.rel)) {
        add(/shell\s*=\s*True/, 'subprocess(shell=True) 는 명령 주입 위험 → 인자 리스트로 넘기고 shell=False 로.');
        add(/\byaml\.load\s*\((?![^)]*Loader\s*=\s*(yaml\.)?SafeLoader)/, 'yaml.load 는 임의 객체 생성 위험 → yaml.safe_load 를 쓰세요.');
        add(/\bpickle\.loads?\s*\(/, 'pickle 로 외부 입력을 읽으면 원격 코드 실행 위험 → JSON 등 안전한 형식을 쓰세요.');
        add(/(^|[^.\w])(eval|exec)\s*\(/, 'eval/exec 는 코드 주입 위험 → 명시적 분기·ast.literal_eval 로 바꾸세요.');
        add(/verify\s*=\s*False/, 'TLS 검증 끄기(verify=False) 금지 → 인증서 번들을 지정하세요.');
      }
      if (/\.go$/.test(ctx.rel)) add(/InsecureSkipVerify:\s*true/, 'TLS 검증 끄기(InsecureSkipVerify) 금지');
      if (/\.(java|kt)$/.test(ctx.rel)) add(/Runtime\.getRuntime\(\)\.exec\(|ObjectInputStream\s*\(/, '외부 명령 실행·자바 직렬화 역직렬화는 주입 위험 → ProcessBuilder 인자 배열 / JSON 으로.');
      return out;
    },
  },
  {
    id: 'B6',
    title: 'Python bare except / 가변 기본 인자',
    severity: 'warn',
    files: /\.py$/,
    check: (src) => [
      ...findAll(src, /^\s*except\s*:/m).map(({ line }) => ({ line, msg: 'except: 는 KeyboardInterrupt 까지 삼켜요 → except Exception as e: (가능하면 구체적 예외) 로.' })),
      ...findAll(src, /def\s+\w+\s*\([^)]*\w\s*(:\s*[\w\[\], ]+)?=\s*(\[\]|\{\}|set\(\)|dict\(\)|list\(\))/).map(({ line }) => ({ line, msg: '가변 기본 인자([] / {})는 호출 간에 공유돼요 → None 기본값 + 함수 안에서 생성.' })),
    ],
  },
  {
    id: 'B7',
    title: 'Go 에러 무시',
    severity: 'warn',
    files: /\.go$/,
    when: notTest,
    check: (src) => [
      ...findAll(src, /^\s*_\s*=\s*[\w.]+\(/m).map(({ line }) => ({ line, msg: '반환된 에러를 _ 로 버리고 있어요 → 처리하거나, 정말 무시해도 되면 이유 주석을 다세요.' })),
      ...findAll(src, /^\s*[\w]+\s*,\s*_\s*:?=\s*[\w.]+\.(\w+)\(/m)
        .filter(({ m }) => !/^(Get|Load|Lookup)$/.test(m[1]))
        .map(({ line }) => ({ line, msg: '두 번째 반환값(에러)을 _ 로 버리고 있어요 → if err != nil 처리.' })),
    ],
  },
  {
    id: 'B8',
    title: 'Express 보안 설정',
    severity: 'warn',
    files: /\.(ts|js|mjs|cjs)$/,
    when: notTest,
    check: (src) => [
      ...findAll(src, /\bcors\(\s*\)/).map(({ line }) => ({ line, msg: 'cors() 를 옵션 없이 쓰면 모든 출처를 허용해요 → origin 화이트리스트를 지정하세요.' })),
      ...findAll(src, /origin\s*:\s*(['"]\*['"]|true)[^\n]*credentials\s*:\s*true|credentials\s*:\s*true[^\n]*origin\s*:\s*(['"]\*['"]|true)/).map(({ line }) => ({ line, msg: '모든 출처 + credentials 허용은 위험 → origin 을 명시하세요.' })),
      ...findAll(src, /\.(json|send)\(\s*(\{[^}]*)?\b(err|error|e)\.(stack|message)\b/).map(({ line }) => ({ line, msg: '에러 스택·내부 메시지를 응답으로 내보내지 마세요 → 로그에만 남기고 응답은 코드·일반 메시지로.' })),
    ],
  },
  {
    id: 'B9',
    title: '디버그 설정 켜짐',
    severity: 'warn',
    files: /\.(py|ts|js|mjs|go|env|ya?ml|toml)$/,
    when: notTest,
    check: (src, ctx) => {
      const out = [];
      const add = (re, msg) => findAll(src, re).forEach(({ line }) => out.push({ line, msg }));
      if (/settings[^/]*\.py$|(^|\/)(prod|production)[^/]*\.py$/.test(ctx.rel)) add(/^\s*DEBUG\s*=\s*True/m, 'Django DEBUG=True 는 운영에서 스택·설정을 노출해요 → 환경변수로 제어.');
      add(/\.run\([^)]*debug\s*=\s*True/, 'Flask app.run(debug=True) 는 원격 코드 실행이 가능한 디버거를 열어요 → 환경변수로 제어.');
      add(/NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"]?0/, 'NODE_TLS_REJECT_UNAUTHORIZED=0 은 모든 TLS 검증을 꺼요.');
      add(/gin\.SetMode\(\s*gin\.DebugMode\s*\)/, 'gin DebugMode 고정 → 환경변수(GIN_MODE)로 제어.');
      return out;
    },
  },
  {
    id: 'B11',
    title: 'Kotlin !! · runBlocking',
    severity: 'warn',
    files: /\.kts?$/,
    when: notTest,
    check: (src) => [
      ...findAll(src, /[\w)\]]!!/).map(({ line }) => ({ line, msg: '!! 는 null 이면 NPE → ?. / ?: / requireNotNull(x) { "이유" } 로.' })),
      ...findAll(src, /\brunBlocking\s*[({]/).map(({ line }) => ({ line, msg: 'runBlocking 은 스레드를 막아요 (요청 스레드·메인 스레드) → suspend 함수/코루틴 스코프로.' })),
    ],
  },
];

/** B2 — 커밋된 마이그레이션 파일 경로 */
export const MIGRATION_PATH = /(^|\/)(prisma\/migrations\/[^/]+\/migration\.sql|(alembic|migrations)\/versions\/[^/]+\.py|migrations\/0\d{3}_[^/]+\.py|migrations?\/\d{8,}[-_][^/]+\.(ts|js|mjs|cjs|sql)|migrations?\/\d+_[^/]+\.(up|down)\.sql|db\/migrate\/\d+_[^/]+\.rb)$/;

/** B10 — 바뀐 파일 중 소스/테스트 */
export function sourceVsTests(changed) {
  const src = changed.filter((f) => /\.(ts|js|mjs|py|go|java|kt)$/.test(f) && !IS_TEST(f) && !/(^|\/)(migrations?|scripts?|config)\/|\.config\.|\.d\.ts$/.test(f));
  const tests = changed.filter((f) => IS_TEST(f));
  return { src, tests };
}
