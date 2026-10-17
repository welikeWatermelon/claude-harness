// rules-frontend.mjs — React 가 아닌 프론트 규칙 (Vue·Nuxt / Android / iOS)
//   웹 공통(W3·W4·W6·W7·W8)은 rules-web.mjs 를 그대로 씀
//   V1 v-html                        warn   V2 v-for 에 :key 없음      warn   V3 props 직접 변경 warn
//   A1 Kotlin !!                     warn   A2 GlobalScope            warn   A3 runBlocking      warn
//   A4 민감정보 Log                   warn   A5 URL 하드코딩            warn
//   I1 force unwrap / try! / as!     warn   I2 print 로 민감정보       warn   I3 DispatchQueue.main.sync warn
//   X3 하드코딩된 비밀값(앱 공통)      block  (= B3 검사)
//   보호 파일 수정 확인: local.properties, google-services.json, keystore, GoogleService-Info.plist, *.xcconfig, Info.plist
import { findAll } from './code-rules.mjs';
import { mask } from './java-parse.mjs';
import { WEB_RULES } from './rules-web.mjs';
import { secretCheck, IS_TEST } from './rules-backend.mjs';

const notTest = (ctx) => !IS_TEST(ctx.rel) && !/(^|\/)(androidTest|test|.*Tests?)\//.test(ctx.rel);

/** .vue 의 <template> 부분만 (줄 번호 유지) */
function templatePart(src) {
  const a = src.indexOf('<template');
  const b = src.lastIndexOf('</template>');
  if (a < 0 || b < 0) return '';
  return src.slice(0, a).replace(/[^\n]/g, ' ') + src.slice(a, b);
}

export const VUE_RULES = [
  {
    id: 'V1',
    title: 'v-html',
    severity: 'warn',
    files: /\.vue$/,
    check: (src) => findAll(templatePart(src), /\bv-html\s*=/).map(({ line }) => ({ line, msg: 'v-html 은 XSS 위험 → 텍스트 보간({{ }})을 쓰거나, 꼭 HTML 이면 DOMPurify 로 정화한 값만.' })),
  },
  {
    id: 'V2',
    title: 'v-for 에 :key 없음',
    severity: 'warn',
    files: /\.vue$/,
    check: (src) =>
      findAll(templatePart(src), /<[\w-]+[^>]*\bv-for\s*=[^>]*>/)
        .filter(({ m }) => !/(:key|v-bind:key)\s*=/.test(m[0]))
        .map(({ line }) => ({ line, msg: 'v-for 에는 고유한 :key 를 주세요 (index 말고 id).' })),
  },
  {
    id: 'V3',
    title: 'props 직접 변경',
    severity: 'warn',
    files: /\.(vue|ts|js)$/,
    check: (src) => findAll(src, /\bprops\.\w+(\.\w+)*\s*(=(?!=)|\+\+|--|\+=|-=)/).map(({ line }) => ({ line, msg: 'props 는 읽기 전용 → emit 으로 부모에 알리거나 로컬 ref 로 복사해서 바꾸세요 (defineModel 도 가능).' })),
  },
  ...WEB_RULES,
];

export const ANDROID_RULES = [
  {
    id: 'A1',
    title: 'Kotlin !!',
    severity: 'warn',
    files: /\.kt$/,
    when: notTest,
    check: (src) => findAll(mask(src), /[\w)\]]!!/).map(({ line }) => ({ line, msg: '!! 는 null 이면 앱이 죽어요 → ?. / ?: / let 으로 처리하세요.' })),
  },
  {
    id: 'A2',
    title: 'GlobalScope',
    severity: 'warn',
    files: /\.kt$/,
    when: notTest,
    check: (src) => findAll(src, /\bGlobalScope\.(launch|async)/).map(({ line }) => ({ line, msg: 'GlobalScope 는 화면이 사라져도 계속 돌아 누수·크래시 원인 → viewModelScope / lifecycleScope 를 쓰세요.' })),
  },
  {
    id: 'A3',
    title: 'runBlocking',
    severity: 'warn',
    files: /\.kt$/,
    when: notTest,
    check: (src) => findAll(src, /\brunBlocking\s*[({]/).map(({ line }) => ({ line, msg: 'runBlocking 은 메인 스레드를 막아 ANR 이 나요 → suspend 함수 + 코루틴 스코프로.' })),
  },
  {
    id: 'A4',
    title: '민감정보 Log',
    severity: 'warn',
    files: /\.(kt|java)$/,
    check: (src) =>
      findAll(src, /\b(Log\.[vdiwe]|Timber\.[vdiwe]|println)\s*\(([^\n]*)/)
        .filter(({ m }) => /\b(password|token|accessToken|refreshToken|secret|authorization|cardNumber|pin|jwt)\b/i.test(m[2]))
        .map(({ line }) => ({ line, msg: '토큰·비밀번호를 Logcat 에 남기지 마세요 (다른 앱·기기 로그 수집에 노출) → 마스킹하거나 지우세요.' })),
  },
  {
    id: 'A5',
    title: 'URL 하드코딩',
    severity: 'warn',
    files: /\.(kt|java)$/,
    when: notTest,
    check: (src) =>
      findAll(src, /"(https?:\/\/(localhost|10\.0\.2\.2|127\.0\.0\.1|192\.168\.[\d.]+)(:\d+)?[^"]*|https?:\/\/[\w.-]+\/api\/[^"]*)"/).map(({ line }) => ({ line, msg: 'API 주소는 BuildConfig(buildConfigField)·flavor 별 설정으로 빼세요.' })),
  },
];

export const IOS_RULES = [
  {
    id: 'I1',
    title: 'force unwrap / try! / as!',
    severity: 'warn',
    files: /\.swift$/,
    when: notTest,
    check: (raw) => {
      const src = mask(raw); // 문자열·주석 안의 ! 는 무시
      const out = [];
      for (const { line } of findAll(src, /\btry!\s/)) out.push({ line, msg: 'try! 는 실패하면 앱이 죽어요 → do-catch 나 try? 로.' });
      for (const { line } of findAll(src, /\bas!\s/)) out.push({ line, msg: 'as! 는 실패하면 앱이 죽어요 → as? + guard let 으로.' });
      for (const { line } of findAll(src, /[\w)\]]!(?=[.)\],\s])(?!=)/))
        out.push({ line, msg: '강제 언래핑(!)은 nil 이면 앱이 죽어요 → guard let / if let / ?? 로.' });
      const seen = new Set();
      return out.filter((v) => (seen.has(v.line + v.msg) ? false : seen.add(v.line + v.msg)));
    },
  },
  {
    id: 'I2',
    title: '민감정보 print',
    severity: 'warn',
    files: /\.swift$/,
    check: (src) =>
      findAll(src, /\b(print|debugPrint|NSLog|os_log|logger\.\w+)\s*\(([^\n]*)/)
        .filter(({ m }) => /\b(password|token|accessToken|refreshToken|secret|authorization|pin|jwt)\b/i.test(m[2]))
        .map(({ line }) => ({ line, msg: '토큰·비밀번호를 콘솔에 남기지 마세요 → 지우거나 privacy: .private 로그를 쓰세요.' })),
  },
  {
    id: 'I3',
    title: 'DispatchQueue.main.sync',
    severity: 'warn',
    files: /\.swift$/,
    check: (src) => findAll(src, /DispatchQueue\.main\.sync\b/).map(({ line }) => ({ line, msg: '메인 스레드에서 호출되면 데드락 → DispatchQueue.main.async 나 @MainActor 로.' })),
  },
];

export const APP_SECRET_RULE = { id: 'X3', title: '하드코딩된 비밀값', severity: 'block', files: /\.(kt|java|swift|vue|ts|js|plist|xml|gradle|kts)$/, check: secretCheck };

export const FRONTEND_RULES = [...VUE_RULES, ...ANDROID_RULES, ...IOS_RULES, APP_SECRET_RULE];

/** 수정 전 사용자 확인이 필요한 앱 설정 파일 */
export const APP_PROTECTED = /(^|\/)(local\.properties|google-services\.json|GoogleService-Info\.plist|[^/]+\.(jks|keystore|p12|mobileprovision)|[^/]+\.xcconfig|keystore\.properties|signing\.properties)$/;
