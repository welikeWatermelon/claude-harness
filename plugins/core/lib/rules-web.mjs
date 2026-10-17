// rules-web.mjs — 웹 프론트 공통 규칙 (React·Vue·Svelte 등 JS/TS 프론트) + React 전용 규칙
//   W 접두사 = 프레임워크 공통 (stack-react, stack-frontend 둘 다 사용)
//   R 접두사 = React/Next 전용
import path from 'node:path';
import { findAll, packageJson } from './code-rules.mjs';

const SRC = /\.(tsx?|jsx?|mjs|cjs|vue|svelte)$/;
const NOT_CONFIG = (ctx) => !/(^|\/)(vite|next|nuxt|webpack|rollup|vitest|jest|playwright|eslint|tailwind|postcss)\.config\.|(^|\/)\.?env/.test(ctx.rel);
const NOT_TEST = (ctx) => !/(\.(test|spec|stories)\.[jt]sx?$|__tests__\/|\/e2e\/|\/mocks?\/)/.test(ctx.rel);
const PUBLIC_ENV = /\b(VITE_|NEXT_PUBLIC_|REACT_APP_|NUXT_PUBLIC_|PUBLIC_|EXPO_PUBLIC_)\w*/;
const SECRETISH = /(SECRET|PRIVATE|PASSWORD|PASSWD|DB_|DATABASE|CLIENT_SECRET|SERVICE_ROLE|ADMIN_KEY)/;

/** 이유 없는 억제 주석 */
function suppressions(src) {
  const out = [];
  for (const { line, m } of findAll(src, /(\/\/|\/\*|<!--)\s*(eslint-disable(?:-next-line|-line)?|@ts-ignore|@ts-nocheck|@ts-expect-error)([^\n*]*)/)) {
    const tail = (m[3] || '').trim();
    const hasReason = m[2].startsWith('eslint') ? /--\s*\S{3,}/.test(tail) : /[:\-–]\s*\S{3,}|\S{6,}/.test(tail.replace(/^[\w/@-]+(,\s*[\w/@-]+)*/, '').trim());
    if (m[2] === '@ts-nocheck' || m[2] === '@ts-ignore' || !hasReason) {
      out.push({ line, msg: `${m[2]} 로 오류를 숨기지 마세요${m[2] === '@ts-ignore' || m[2] === '@ts-nocheck' ? '' : ' (이유 없음)'} → 타입·로직을 고치세요. 꼭 필요하면 @ts-expect-error: <이유> / eslint-disable-next-line <규칙> -- <이유> 형태로.` });
    }
  }
  return out;
}

export const WEB_RULES = [
  { id: 'W3', title: '이유 없는 eslint-disable / @ts-ignore', severity: 'block', files: SRC, check: suppressions },
  {
    id: 'W4',
    title: 'TypeScript any',
    severity: 'warn',
    files: /\.(tsx?|vue)$/,
    when: NOT_TEST,
    check: (src) => findAll(src, /(:\s*any\b(?!\w)|\bas\s+any\b|<any>|any\[\])/).map(({ line }) => ({ line, msg: 'any 대신 정확한 타입이나 unknown + 타입 가드를 쓰세요.' })),
  },
  {
    id: 'W6',
    title: 'API 주소 하드코딩',
    severity: 'warn',
    files: SRC,
    when: (ctx) => NOT_CONFIG(ctx) && NOT_TEST(ctx),
    check: (src) =>
      findAll(src, /['"`](https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?[^'"`]*|https?:\/\/[\w.-]+\/api\/[^'"`]*)['"`]/).map(({ line, m }) => ({
        line,
        msg: `API 주소(${m[1].slice(0, 40)})를 코드에 박지 말고 환경변수(import.meta.env.VITE_API_URL 등)로 읽으세요.`,
      })),
  },
  {
    id: 'W7',
    title: '브라우저 공개 환경변수에 비밀값',
    severity: 'block',
    files: /(\.(tsx?|jsx?|mjs|vue|svelte)$|(^|\/)\.env(\.[\w.-]+)?$)/,
    check: (src) =>
      findAll(src, new RegExp(`${PUBLIC_ENV.source}`, 'g'))
        .filter(({ m }) => SECRETISH.test(m[0]))
        .map(({ line, m }) => ({ line, msg: `${m[0]} 는 빌드 결과물에 그대로 들어가 브라우저에서 누구나 볼 수 있어요 → 비밀값은 서버(백엔드·서버 컴포넌트·API 라우트)에서만 쓰세요.` })),
  },
  {
    id: 'W8',
    title: '컴포넌트에서 API 직접 호출',
    severity: 'warn',
    files: /\.(tsx|jsx|vue|svelte)$/,
    when: (ctx) => NOT_TEST(ctx) && /(^|\/)(components?|pages|views|app|screens|routes)\//.test(ctx.rel) && !/(^|\/)(api|apis|services?|hooks|composables|lib|queries|stores?)\//.test(ctx.rel) && !/\/(route|actions?|server)\.[jt]sx?$/.test(ctx.rel),
    check: (src) => findAll(src, /\b(fetch\s*\(|axios\s*\.\s*(get|post|put|patch|delete|request)\s*\(|axios\s*\()/).map(({ line }) => ({ line, msg: '화면 컴포넌트에서 API 를 직접 부르지 말고 api/ (또는 hooks·services) 레이어 함수를 만들어 호출하세요.' })),
  },
];

function isNext(ctx) {
  const p = packageJson(ctx);
  return !!(p && p._deps && p._deps.next);
}

export const REACT_RULES = [
  ...WEB_RULES.map((r) => ({ ...r, id: r.id.replace(/^W/, 'R') })),
  {
    id: 'R9',
    title: "Next.js 'use client' 에서 서버 전용 코드",
    severity: 'block',
    files: /\.(tsx?|jsx?)$/,
    when: isNext,
    check(src) {
      if (!/^\s*['"]use client['"]/m.test(src)) return [];
      const out = [];
      for (const { line, m } of findAll(src, /from\s+['"](server-only|fs|node:fs|path|node:\w+|next\/headers|@prisma\/client)['"]/)) out.push({ line, msg: `'use client' 컴포넌트가 서버 전용 모듈(${m[1]})을 import 해요 → 서버 컴포넌트나 API 라우트로 옮기세요.` });
      for (const { line, m } of findAll(src, /process\.env\.(?!NEXT_PUBLIC_|NODE_ENV\b)(\w+)/)) out.push({ line, msg: `'use client' 에서 process.env.${m[1]} 는 브라우저에서 undefined 이거나 비밀값이 노출돼요 → NEXT_PUBLIC_ 공개값만 쓰거나 서버에서 처리하세요.` });
      return out;
    },
  },
];

/** 끝낼 때: 바뀐 파일에 남은 console.log (R5/W5) */
export function consoleLeftovers(files, readText) {
  const out = [];
  for (const f of files) {
    if (!/\.(tsx?|jsx?|vue|svelte)$/.test(f) || /(\.(test|spec)\.|__tests__\/|scripts?\/|\.config\.)/.test(f)) continue;
    const t = readText(f);
    if (!t) continue;
    for (const { line } of findAll(t, /\bconsole\.(log|debug)\s*\(/)) out.push(`${f}:${line}`);
  }
  return out;
}

/** 수정한 소스와 짝인 테스트 파일 후보 (R11) */
export function relatedTests(rel) {
  const dir = path.posix.dirname(rel);
  const base = path.posix.basename(rel).replace(/\.(tsx?|jsx?|vue)$/, '');
  const exts = ['test.tsx', 'test.ts', 'spec.tsx', 'spec.ts', 'test.jsx', 'test.js', 'spec.js'];
  return exts.flatMap((e) => [`${dir}/${base}.${e}`, `${dir}/__tests__/${base}.${e}`]);
}

export const CONFIG_FILES = /(^|\/)(eslint\.config\.[mc]?[jt]s|\.eslintrc(\.\w+)?|tsconfig(\.[\w-]+)?\.json|\.prettierrc(\.\w+)?|biome\.json)$/;
