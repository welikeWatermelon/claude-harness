// java-parse.mjs — 규칙 검사용 가벼운 Java/Kotlin 소스 분석 (정확한 파서가 아니라 휴리스틱)
//   mask(): 문자열·주석 내용을 공백으로 바꿔 줄 번호는 유지 → 정규식 오탐 감소
//   methods(): 메서드 이름·어노테이션·접근제어자·본문 범위
import { lineOf } from './code-rules.mjs';

export function mask(src) {
  const s = String(src || '');
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    const d = s[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && s[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (c === '/' && d === '*') {
      while (i < n && !(s[i] === '*' && s[i + 1] === '/')) {
        out += s[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '  ';
        i += 2;
      }
    } else if (c === '"' && s.slice(i, i + 3) === '"""') {
      out += '"""';
      i += 3;
      while (i < n && s.slice(i, i + 3) !== '"""') {
        out += s[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        out += '"""';
        i += 3;
      }
    } else if (c === '"' || c === "'") {
      const q = c;
      out += q;
      i++;
      while (i < n && s[i] !== q && s[i] !== '\n') {
        if (s[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        out += ' ';
        i++;
      }
      if (i < n && s[i] === q) {
        out += q;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new', 'else', 'try', 'do', 'throw']);
const SIG = /(^|\n)([ \t]*)((?:(?:public|protected|private|static|final|synchronized|abstract|default|native|override|open|suspend|internal)\s+)*)(?:fun\s+|(?:<[^>\n]+>\s*)?[\w$.]+(?:<[^;{}()\n]*>)?(?:\[\])*\s+)(\w+)\s*\(/g;

function matchBrace(m, open) {
  let depth = 0;
  for (let i = open; i < m.length; i++) {
    if (m[i] === '{') depth++;
    else if (m[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return m.length - 1;
}

/** @returns {{name, mods, annotations:string[], line, sigIndex, bodyStart, bodyEnd, body}[]} */
export function methods(src) {
  const m = mask(src);
  const out = [];
  SIG.lastIndex = 0;
  let x;
  while ((x = SIG.exec(m))) {
    const name = x[4];
    if (NOT_METHOD.has(name)) continue;
    const sigIndex = x.index + x[1].length;
    // 시그니처 끝 '{' 또는 ';'(추상/인터페이스) 찾기
    let j = SIG.lastIndex;
    let depth = 1;
    while (j < m.length && depth > 0) {
      if (m[j] === '(') depth++;
      else if (m[j] === ')') depth--;
      j++;
    }
    let k = j;
    while (k < m.length && m[k] !== '{' && m[k] !== ';' && m[k] !== '=' && m[k] !== '}') k++;
    if (m[k] !== '{') continue;
    const bodyEnd = matchBrace(m, k);
    // 위쪽 어노테이션 수집
    const before = m.slice(0, sigIndex).split('\n');
    const annotations = [];
    for (let li = before.length - 2; li >= 0; li--) {
      const t = before[li].trim();
      if (!t) continue;
      if (t.startsWith('@')) annotations.unshift(t);
      else break;
    }
    // 같은 줄 앞쪽 어노테이션
    const lineStart = m.lastIndexOf('\n', sigIndex) + 1;
    const inline = m.slice(lineStart, sigIndex).match(/@\w+(\([^)]*\))?/g);
    if (inline) annotations.push(...inline);
    out.push({
      name,
      mods: x[3] || '',
      annotations,
      line: lineOf(src, sigIndex),
      sigIndex,
      bodyStart: k,
      bodyEnd,
      body: m.slice(k, bodyEnd + 1),
    });
    SIG.lastIndex = k + 1;
  }
  return out;
}

/** 클래스 선언 위 어노테이션들 (첫 class/interface/record 기준) */
export function classAnnotations(src) {
  const m = mask(src);
  const idx = m.search(/\b(class|interface|record|enum|object)\s+\w+/);
  if (idx < 0) return [];
  const lines = m.slice(0, idx).split('\n');
  const out = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (t.startsWith('@') || /^(public|final|abstract|open|data|internal)\b/.test(t)) {
      if (t.startsWith('@')) out.unshift(t);
      continue;
    }
    if (i === lines.length - 1) continue;
    break;
  }
  const head = m.slice(Math.max(0, m.lastIndexOf('\n', idx)), idx);
  const inl = head.match(/@\w+(\([^)]*\))?/g);
  if (inl) out.push(...inl);
  return out;
}

export function className(src) {
  const x = mask(src).match(/\b(?:class|interface|record|enum|object)\s+(\w+)/);
  return x ? x[1] : null;
}

export const hasAnno = (list, name) => list.some((a) => new RegExp(`^@${name}\\b`).test(a));
