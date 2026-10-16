#!/usr/bin/env node
// shared/lib → plugins/*/lib 복사.
// 플러그인은 설치될 때 각자 독립된 폴더로 복사되기 때문에 서로의 파일을 import 할 수 없어요.
// 그래서 공통 코드는 shared/lib 한 곳에서만 고치고, 이 스크립트로 각 플러그인에 배포합니다.
//   node scripts/sync-lib.mjs          복사
//   node scripts/sync-lib.mjs --check  다르면 exit 1 (CI 용)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(repo, 'shared', 'lib');
const check = process.argv.includes('--check');
const files = readdirSync(src).filter((f) => f.endsWith('.mjs'));
let drift = 0;
for (const plugin of readdirSync(path.join(repo, 'plugins'))) {
  if (!existsSync(path.join(repo, 'plugins', plugin, 'scripts'))) continue; // 스크립트 없는 플러그인은 lib 불필요
  const dst = path.join(repo, 'plugins', plugin, 'lib');
  for (const f of files) {
    const body = readFileSync(path.join(src, f), 'utf8');
    const target = path.join(dst, f);
    const cur = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (cur === body) continue;
    drift++;
    if (check) console.error(`✗ ${plugin}/lib/${f} 가 shared/lib 와 달라요`);
    else {
      mkdirSync(dst, { recursive: true });
      writeFileSync(target, body);
      console.log(`→ ${plugin}/lib/${f}`);
    }
  }
}
if (check && drift) process.exit(1);
console.log(check ? '✓ lib 동기화 상태 정상' : `완료 (${drift}개 갱신)`);
