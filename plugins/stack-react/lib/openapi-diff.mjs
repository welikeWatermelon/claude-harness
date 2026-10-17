// openapi-diff.mjs — OpenAPI 명세 두 개를 비교해 프론트에 영향을 주는 변경을 찾음 (의존성 없음)
//
// breaking (프론트가 깨질 수 있음)
//   - 엔드포인트 삭제 (path + method)
//   - 응답/요청 스키마의 필드 삭제, 타입 변경, enum 값 삭제
//   - 요청에 필수 필드/필수 파라미터 추가
//   - 엔드포인트의 응답·요청 스키마 자체가 바뀜
// compatible
//   - 엔드포인트 추가, 필드 추가(요청 필수 제외), enum 값 추가

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function refName(s) {
  if (!s) return null;
  if (s.$ref) return s.$ref.split('/').pop();
  if (s.type === 'array' && s.items) return `${refName(s.items) || s.items.type}[]`;
  return s.type || null;
}

function typeOf(p) {
  if (!p) return 'unknown';
  if (p.$ref) return p.$ref.split('/').pop();
  if (p.type === 'array') return `${typeOf(p.items)}[]`;
  return p.format ? `${p.type}(${p.format})` : p.type || (p.allOf ? 'allOf' : p.oneOf ? 'oneOf' : 'object');
}

function bodySchema(op) {
  const c = op?.requestBody?.content;
  if (!c) return null;
  const first = c['application/json'] || Object.values(c)[0];
  return refName(first?.schema);
}

function okSchema(op) {
  const r = op?.responses || {};
  const ok = r['200'] || r['201'] || r.default;
  const c = ok?.content;
  if (!c) return null;
  const first = c['application/json'] || c['*/*'] || Object.values(c)[0];
  return refName(first?.schema);
}

function endpoints(spec) {
  const out = new Map();
  for (const [p, item] of Object.entries(spec?.paths || {})) {
    for (const m of METHODS) {
      if (!item[m]) continue;
      const op = item[m];
      out.set(`${m.toUpperCase()} ${p}`, {
        path: p,
        method: m.toUpperCase(),
        req: bodySchema(op),
        res: okSchema(op),
        requiredParams: (op.parameters || []).filter((x) => x.required).map((x) => `${x.in}:${x.name}`),
      });
    }
  }
  return out;
}

/** 요청 본문으로만 쓰이는 스키마 이름 집합 (필수 필드 추가가 breaking 인지 판단용) */
function requestSchemas(eps) {
  const s = new Set();
  for (const e of eps.values()) if (e.req) s.add(e.req.replace(/\[\]$/, ''));
  return s;
}

export function diffOpenApi(oldSpec, newSpec) {
  const changes = [];
  const add = (severity, kind, target, detail) => changes.push({ severity, kind, target, detail });
  const oe = endpoints(oldSpec);
  const ne = endpoints(newSpec);

  for (const [k, o] of oe) {
    const n = ne.get(k);
    if (!n) {
      add('breaking', 'endpoint-removed', k, '엔드포인트가 사라졌어요');
      continue;
    }
    if (o.res && n.res && o.res !== n.res) add('breaking', 'response-schema-changed', k, `응답 스키마 ${o.res} → ${n.res}`);
    if (o.req && n.req && o.req !== n.req) add('breaking', 'request-schema-changed', k, `요청 스키마 ${o.req} → ${n.req}`);
    for (const p of n.requiredParams) if (!o.requiredParams.includes(p)) add('breaking', 'required-param-added', k, `필수 파라미터 추가: ${p}`);
  }
  for (const k of ne.keys()) if (!oe.has(k)) add('compatible', 'endpoint-added', k, '새 엔드포인트');

  const os = oldSpec?.components?.schemas || {};
  const ns = newSpec?.components?.schemas || {};
  const reqSchemas = requestSchemas(ne);
  for (const [name, o] of Object.entries(os)) {
    const n = ns[name];
    if (!n) {
      add('breaking', 'schema-removed', name, '스키마가 사라졌어요');
      continue;
    }
    const op = o.properties || {};
    const np = n.properties || {};
    for (const [f, ov] of Object.entries(op)) {
      if (!(f in np)) add('breaking', 'field-removed', `${name}.${f}`, '필드가 사라졌어요');
      else if (typeOf(ov) !== typeOf(np[f])) add('breaking', 'field-type-changed', `${name}.${f}`, `타입 ${typeOf(ov)} → ${typeOf(np[f])}`);
      else if (Array.isArray(ov.enum) && Array.isArray(np[f].enum)) {
        const gone = ov.enum.filter((x) => !np[f].enum.includes(x));
        if (gone.length) add('breaking', 'enum-value-removed', `${name}.${f}`, `enum 값 삭제: ${gone.join(', ')}`);
      }
    }
    for (const f of Object.keys(np)) if (!(f in op)) add('compatible', 'field-added', `${name}.${f}`, '필드 추가');
    if (reqSchemas.has(name)) {
      const before = new Set(o.required || []);
      for (const r of n.required || []) if (!before.has(r)) add('breaking', 'required-field-added', `${name}.${r}`, '요청에 필수 필드 추가');
    }
    if (Array.isArray(o.enum) && Array.isArray(n.enum)) {
      const gone = o.enum.filter((x) => !n.enum.includes(x));
      if (gone.length) add('breaking', 'enum-value-removed', name, `enum 값 삭제: ${gone.join(', ')}`);
    }
  }
  for (const name of Object.keys(ns)) if (!(name in os)) add('compatible', 'schema-added', name, '새 스키마');
  return changes;
}

/** 변경 대상에서 프론트 코드 검색어 뽑기 */
export function searchTerms(change) {
  const t = change.target;
  if (change.kind.startsWith('endpoint') || change.kind.includes('param') || change.kind.includes('-schema-changed')) {
    const p = t.split(' ').pop();
    const fixed = p.split('/').filter((s) => s && !s.startsWith('{'));
    return fixed.length ? ['/' + fixed.join('/')] : [p];
  }
  if (t.includes('.')) {
    const [schema, field] = t.split('.');
    return [field, schema];
  }
  return [t];
}
