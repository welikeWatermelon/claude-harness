// rules-spring.mjs — stack-spring 코드 규칙 (S1~S17). S18~S22 는 Stop 훅·스킬·리뷰 에이전트에서 다룸.
// 출처 표시: [KEEPING 실패] = keeping/backend/docs/failures.md 에 실제 기록된 사고, [MelonMe] = 프로젝트 컨벤션, [웹] = 공개 가이드
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findAll, buildFile, buildFilesUp } from './code-rules.mjs';
import { mask, methods, classAnnotations, className, hasAnno } from './java-parse.mjs';

const MAIN_JAVA = /src\/main\/(java|kotlin)\/.*\.(java|kt)$/;
const PROXY_ANNOS = ['Transactional', 'Async', 'Cacheable', 'CachePut', 'CacheEvict', 'Retryable'];

// ---- 프로젝트 인덱스 (엔티티 이름, 리포지토리 위치) ----
let index = null;
function projectIndex(root) {
  if (index && index.root === root) return index;
  const entities = new Set();
  const repos = new Map(); // RepositoryName -> rel path
  let count = 0;
  const walk = (dir, depth) => {
    if (depth > 14 || count > 4000) return;
    let ents = [];
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (['build', 'target', 'node_modules', '.git', '.gradle', 'out', 'test'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(java|kt)$/.test(e.name)) {
        count++;
        let t = '';
        try {
          t = readFileSync(p, 'utf8');
        } catch {
          continue;
        }
        const name = e.name.replace(/\.(java|kt)$/, '');
        if (/@Entity\b/.test(t)) entities.add(name);
        if (/Repository$/.test(name) && /\b(interface|class)\s+\w+Repository\b/.test(t)) repos.set(name, path.relative(root, p).replace(/\\/g, '/'));
      }
    }
  };
  walk(root, 0);
  index = { root, entities, repos };
  return index;
}

/** 도메인 이름: .../domain/<x>/... 우선, 없으면 기본 패키지 바로 아래 디렉터리 */
export function domainOf(rel) {
  const r = rel.replace(/\\/g, '/');
  const d = r.match(/\/domain\/([^/]+)\//);
  if (d) return d[1];
  const p = r.match(/src\/main\/(?:java|kotlin)\/(.+)\/[^/]+\.(java|kt)$/);
  if (!p) return null;
  const segs = p[1].split('/');
  return segs.length >= 4 ? segs[3] : segs[segs.length - 1];
}

function isSpringBoot3(ctx) {
  const b = buildFile(ctx);
  if (!b) return false;
  const t = b.text;
  return /org\.springframework\.boot['"]?\s*\)?\s*version\s*['"]3\./.test(t) || /spring-boot-starter-parent<\/artifactId>\s*<version>3\./.test(t) || /springBootVersion\s*=\s*['"]3\./.test(t);
}

function hasLombok(ctx) {
  // 멀티모듈: 루트 subprojects{}·부모 pom·buildSrc·버전 카탈로그에 선언된 경우까지 확인
  return buildFilesUp(ctx).some((f) => /lombok/.test(f.text));
}

export const SPRING_RULES = [
  {
    id: 'S1',
    title: '같은 클래스 내부 호출로 프록시 어노테이션 무효',
    severity: 'warn',
    files: MAIN_JAVA,
    check(src) {
      const ms = methods(src);
      const proxied = ms.filter((m) => PROXY_ANNOS.some((a) => hasAnno(m.annotations, a)));
      if (!proxied.length) return [];
      const out = [];
      const masked = mask(src);
      for (const p of proxied) {
        const re = new RegExp(`(?<![\\w.])(?:this\\.)?${p.name}\\s*\\(`, 'g');
        for (const other of ms) {
          if (other === p) continue;
          const body = masked.slice(other.bodyStart, other.bodyEnd + 1);
          let x;
          re.lastIndex = 0;
          while ((x = re.exec(body))) {
            const line = masked.slice(0, other.bodyStart + x.index).split('\n').length;
            const anno = PROXY_ANNOS.find((a) => hasAnno(p.annotations, a));
            out.push({ line, msg: `${other.name}() 가 같은 클래스의 @${anno} 메서드 ${p.name}() 를 직접 호출해요. 프록시를 거치지 않아 @${anno} 가 적용되지 않아요 → 별도 빈(@Component)이나 리포지토리 쿼리로 분리하세요. (KEEPING OutboxPublisher 32만 건 중복 발행 원인)` });
          }
        }
      }
      return out;
    },
  },
  {
    id: 'S2',
    title: '트랜잭션 안에서 상태 전이 후 throw',
    severity: 'warn',
    files: MAIN_JAVA,
    check(src) {
      const classTx = hasAnno(classAnnotations(src), 'Transactional');
      const out = [];
      for (const m of methods(src)) {
        const tx = hasAnno(m.annotations, 'Transactional') || (classTx && !/private/.test(m.mods));
        if (!tx || /REQUIRES_NEW|noRollbackFor/.test(m.annotations.join(' '))) continue;
        const mark = m.body.search(/\.(mark\w+|changeStatus|transitionTo|updateStatus|setStatus)\s*\(/);
        if (mark < 0) continue;
        if (m.body.slice(mark).search(/\bthrow\s+new\b/) >= 0) {
          out.push({ line: m.line, msg: `${m.name}() 가 트랜잭션 안에서 상태를 바꾼 뒤 예외를 던져요. 예외로 롤백되면 상태 전이까지 사라져요 → 실패 상태 전이는 REQUIRES_NEW 헬퍼에서 커밋하고, 예외는 커밋 후 호출자가 던지세요. (KEEPING 2회 재발)` });
        }
      }
      return out;
    },
  },
  {
    id: 'S3',
    title: '직접 할당 @Id 인데 Persistable 미구현',
    severity: 'warn',
    files: MAIN_JAVA,
    check(src) {
      if (!/@Entity\b/.test(src) || /@GeneratedValue\b/.test(src) || /@EmbeddedId\b/.test(src) || /\bPersistable\s*</.test(src)) return [];
      return findAll(src, /@Id\b/).map(({ line }) => ({
        line,
        msg: '@Id 를 직접 할당하는데 @GeneratedValue 도 Persistable 도 없어요. save() 가 insert 대신 merge 로 동작해 중복 삽입 검사가 안 돼요 → Persistable<ID> 구현 + @Transient isNew. (KEEPING 중복 알림 23만 건 원인)',
      }));
    },
  },
  {
    id: 'S4',
    title: 'JSON/Redis 저장 모델의 계산 메서드에 @JsonIgnore 없음',
    severity: 'warn',
    files: /\.(java|kt)$/,
    when: (ctx) => /\/(redis|cache)\//i.test(ctx.rel),
    check(src) {
      const ann = classAnnotations(src);
      const masked = mask(src);
      const fields = new Set([...masked.matchAll(/\b(?:private|protected|public)?\s*(?:final\s+)?[\w<>,.?\[\] ]+\s+(\w+)\s*[;=]/g)].map((x) => x[1]));
      for (const x of masked.matchAll(/\(\s*([^)]*)\)\s*(?:implements|\{)/g)) for (const p of x[1].split(',')) fields.add(p.trim().split(/\s+/).pop());
      const out = [];
      for (const m of methods(src)) {
        const g = m.name.match(/^(is|get)([A-Z]\w*)$/);
        if (!g || /private|static/.test(m.mods)) continue;
        const prop = g[2][0].toLowerCase() + g[2].slice(1);
        if (fields.has(prop) || m.annotations.some((a) => /JsonIgnore/.test(a))) continue;
        if (hasAnno(ann, 'JsonIgnoreProperties')) continue;
        out.push({ line: m.line, msg: `${m.name}() 는 필드가 아닌 계산 메서드인데 Jackson 이 프로퍼티로 직렬화해요 → @JsonIgnore 를 붙이고 직렬화 왕복 테스트를 추가하세요. (KEEPING QrToken 500 원인)` });
      }
      return out;
    },
  },
  {
    id: 'S5',
    title: 'Spring Boot 3 에서 javax.* import',
    severity: 'block',
    files: /\.(java|kt)$/,
    when: isSpringBoot3,
    check: (src) =>
      findAll(src, /^\s*import\s+javax\.(persistence|validation|servlet|transaction(?!\.xa)|annotation\.(PostConstruct|PreDestroy|Resource)|inject|ws\.rs|xml\.bind)\b[\w.*]*/m).map(({ line, m }) => ({
        line,
        msg: `Spring Boot 3 는 jakarta.* 를 써요: ${m[0].trim()} → ${m[0].trim().replace('javax.', 'jakarta.')}`,
      })),
  },
  {
    id: 'S6',
    title: '필드 주입 @Autowired',
    severity: 'warn',
    files: MAIN_JAVA,
    check(src) {
      const lines = src.split(/\r?\n/);
      const out = [];
      lines.forEach((l, i) => {
        if (!/^\s*@Autowired\b/.test(l)) return;
        const next = (l.replace(/^\s*@Autowired\b(\([^)]*\))?/, '').trim() || lines[i + 1] || '').trim();
        if (/;\s*$/.test(next) && !/\(/.test(next)) out.push({ line: i + 1, msg: '필드 주입(@Autowired) 대신 생성자 주입(private final + @RequiredArgsConstructor)을 쓰세요.' });
      });
      return out;
    },
  },
  {
    id: 'S7',
    title: '컨트롤러가 엔티티를 직접 반환',
    severity: 'warn',
    files: /Controller\.(java|kt)$/,
    check(src, ctx) {
      const { entities } = projectIndex(ctx.root);
      if (!entities.size) return [];
      const out = [];
      for (const m of methods(src)) {
        if (!m.annotations.some((a) => /@(Get|Post|Put|Patch|Delete|Request)Mapping/.test(a))) continue;
        const sig = mask(src).slice(src.lastIndexOf('\n', m.sigIndex) + 1, m.bodyStart);
        const types = (sig.split(m.name + '(')[0].match(/\b[A-Z]\w*\b/g) || []).filter((t) => entities.has(t));
        if (types.length) out.push({ line: m.line, msg: `${m.name}() 가 엔티티 ${types.join(', ')} 를 응답으로 반환해요 → Response DTO 의 static from(entity) 로 변환하세요.` });
      }
      return out;
    },
  },
  {
    id: 'S8',
    title: '@Transactional 위치 오류 (컨트롤러·private)',
    severity: 'warn',
    files: MAIN_JAVA,
    check(src) {
      const out = [];
      const ca = classAnnotations(src);
      if ((hasAnno(ca, 'RestController') || hasAnno(ca, 'Controller')) && /@Transactional\b/.test(src)) {
        for (const { line } of findAll(src, /@Transactional\b/)) out.push({ line, msg: '컨트롤러에 @Transactional 을 두지 마세요. 트랜잭션 경계는 서비스에서 잡아요.' });
      }
      for (const m of methods(src)) {
        if (/private/.test(m.mods) && hasAnno(m.annotations, 'Transactional')) out.push({ line: m.line, msg: `private 메서드 ${m.name}() 의 @Transactional 은 프록시가 적용되지 않아 무시돼요.` });
      }
      return out;
    },
  },
  {
    id: 'S9',
    title: 'FetchType.EAGER',
    severity: 'warn',
    files: MAIN_JAVA,
    check: (src) => findAll(mask(src), /FetchType\.EAGER/).map(({ line }) => ({ line, msg: 'EAGER 대신 LAZY 를 쓰고, 필요한 곳에서 fetch join 이나 @EntityGraph 로 가져오세요 (N+1 방지).' })),
  },
  {
    id: 'S10',
    title: '다른 도메인 Repository 직접 주입',
    severity: 'warn',
    files: /(Service|Facade)\.(java|kt)$/,
    check(src, ctx) {
      const mine = domainOf(ctx.rel);
      if (!mine) return [];
      const { repos } = projectIndex(ctx.root);
      const allow = (ctx.cfg.spring && ctx.cfg.spring.crossDomainRepositoryAllow) || [];
      const cls = className(src) || '';
      const out = [];
      for (const { line, m } of findAll(mask(src), /\b(?:private\s+final|val|private\s+val)\s+(\w+Repository)\b|\b(\w+Repository)\s+\w+\s*[;,)]/)) {
        const repo = m[1] || m[2];
        const at = repos.get(repo);
        if (!at) continue;
        const theirs = domainOf(at);
        if (theirs && theirs !== mine && !allow.includes(`${cls}->${repo}`)) {
          out.push({ line, msg: `${mine} 도메인의 ${cls} 가 ${theirs} 도메인의 ${repo} 를 직접 주입해요 → 상대 도메인 Service 를 거치세요. 의도된 예외면 .claude/harness.json spring.crossDomainRepositoryAllow 에 "${cls}->${repo}" 추가.` });
        }
      }
      return out;
    },
  },
  {
    id: 'S11',
    title: '이벤트 리스너가 이벤트 재발행',
    severity: 'warn',
    files: MAIN_JAVA,
    check(src) {
      const out = [];
      for (const m of methods(src)) {
        if (!m.annotations.some((a) => /@(Transactional)?EventListener\b/.test(a))) continue;
        if (/\bpublishEvent\s*\(/.test(m.body)) out.push({ line: m.line, msg: `리스너 ${m.name}() 가 다시 이벤트를 발행해요 → 연쇄 호출을 막기 위해 리스너는 재발행하지 않아요 (MelonMe ADR).` });
      }
      return out;
    },
  },
  {
    id: 'S12',
    title: '트랜잭션 안 외부 API 호출',
    severity: 'warn',
    files: MAIN_JAVA,
    check(src) {
      const classTx = hasAnno(classAnnotations(src), 'Transactional');
      const out = [];
      for (const m of methods(src)) {
        const tx = hasAnno(m.annotations, 'Transactional') || classTx;
        if (!tx || /readOnly\s*=\s*true/.test(m.annotations.join(' '))) continue;
        const hit = m.body.match(/\b(restTemplate|restClient|webClient|\w+Client|\w+Gateway|\w+FeignClient)\s*\.\s*\w+\s*\(/);
        if (hit && !/Repository/.test(hit[1])) out.push({ line: m.line, msg: `${m.name}() 가 트랜잭션 안에서 외부 호출(${hit[1]})을 해요. 외부 응답을 기다리는 동안 DB 커넥션·락을 잡고 있어요 → 외부 호출은 트랜잭션 밖(Facade)으로 빼세요.` });
      }
      return out;
    },
  },
  {
    id: 'S13',
    title: '민감정보 로그 출력',
    severity: 'warn',
    files: /\.(java|kt)$/,
    check: (src) =>
      findAll(src, /\b(log|logger|LOG)\s*\.\s*(trace|debug|info|warn|error)\s*\([^;]*\b(password|passwd|pin|secret|accessToken|refreshToken|jwt|cardNumber)\b/i).map(({ line, m }) => ({ line, msg: `로그에 민감정보(${m[3]})가 들어가요 → 값을 빼거나 마스킹하세요.` })),
  },
  {
    id: 'S14',
    title: '메트릭 태그 고유값',
    severity: 'warn',
    files: /\.(java|kt)$/,
    check: (src) =>
      findAll(src, /(Tag\.of|\.tag|Tags\.of)\s*\(\s*"(userId|memberId|customerId|orderId|intentId|email|requestId|sessionId)"/).map(({ line, m }) => ({ line, msg: `메트릭 태그 "${m[2]}" 는 값이 무한히 늘어나 Prometheus 시계열이 폭증해요 → 집계 가능한 값(상태·유형)만 태그로.` })),
  },
  {
    id: 'S15',
    title: '운영 설정 ddl-auto / 운영 init 의 테스트 데이터',
    severity: 'block',
    files: /(application-prod[^/]*\.(ya?ml|properties)|(init|initdb|docker-entrypoint-initdb\.d)\/[^/]*\.sql)$/,
    check(src, ctx) {
      if (/\.sql$/.test(ctx.rel)) {
        return /(^|[-_.])(test|dummy|sample|fixture)s?([-_.]|$)/i.test(path.basename(ctx.rel)) && !/\/test\//.test(ctx.rel) ? [{ line: 1, msg: '운영 DB 초기화 경로에 테스트 데이터 SQL 을 두면 테스트 계정이 운영에 자동 적재돼요 (KEEPING 배포 규칙).' }] : [];
      }
      return findAll(src, /ddl-auto\s*[:=]\s*(create|create-drop|update)\b/).map(({ line, m }) => ({ line, msg: `운영 프로필 ddl-auto=${m[1]} 금지 → validate 로 두고 스키마는 Flyway 마이그레이션으로.` }));
    },
  },
  {
    id: 'S16',
    title: 'open-in-view 미설정',
    severity: 'warn',
    files: /src\/main\/resources\/application(-[\w]+)?\.(ya?ml|properties)$/,
    check(src) {
      if (!/\bjpa\b|spring\.jpa/.test(src)) return [];
      if (/open-in-view\s*[:=]\s*false/.test(src)) return [];
      const at = findAll(src, /open-in-view\s*[:=]\s*true/);
      const msg = 'spring.jpa.open-in-view 가 켜져 있어요(기본값 true). 요청 내내 DB 커넥션을 잡아요 → false 로 두고 필요한 데이터는 서비스 트랜잭션 안에서 로딩하세요.';
      if (at.length) return at.map(({ line }) => ({ line, msg }));
      const first = findAll(src, /^\s*jpa\s*:|spring\.jpa\./m)[0];
      return first ? [{ line: first.line, msg }] : [];
    },
  },
  {
    id: 'S17',
    title: 'Lombok 없는 프로젝트에서 Lombok 사용',
    severity: 'block',
    files: /\.java$/,
    when: (ctx) => !!buildFile(ctx) && !hasLombok(ctx),
    check: (src) => findAll(src, /^\s*import\s+lombok\./m).map(({ line }) => ({ line, msg: '이 모듈 빌드 파일에 Lombok 의존성이 없어요 → Lombok 없이 생성자·getter 를 직접 작성하거나, 먼저 의존성 추가를 제안하세요.' })),
  },
];

/** 테스트용: 인덱스 캐시 초기화 */
export function _resetIndex() {
  index = null;
}
