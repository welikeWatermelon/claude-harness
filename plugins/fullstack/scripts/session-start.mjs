#!/usr/bin/env node
// fullstack / SessionStart (frontend) — 백엔드 계약 스냅샷이 프론트 생성 타입보다 새로우면 동기화 안내
import path from 'node:path';
import { existsSync } from 'node:fs';
import { runHook, addContext, pass } from '../lib/hook-io.mjs';
import { projectRoot, loadConfig } from '../lib/config.mjs';
import { fsCfg, peerRoot, isNewer } from './contract.mjs';

await runHook(
  async (input) => {
    const root = projectRoot(input);
    const fs = fsCfg(loadConfig(root));
    if (fs.role !== 'frontend') return pass();
    const peer = peerRoot(root, fs);
    const spec = fs.frontend?.specFrom ? path.resolve(root, fs.frontend.specFrom) : peer ? path.join(peer, 'docs/api/openapi.json') : null;
    if (!spec || !existsSync(spec)) return pass();
    const types = path.resolve(root, fs.frontend?.typesOut || 'src/api/generated/schema.ts');
    if (isNewer(spec, types)) {
      return addContext('SessionStart', `[fullstack] 백엔드 API 계약(${spec})이 프론트 생성 타입보다 새로워요. 작업 전에 /fullstack:api-sync 로 타입을 갱신하자고 제안하세요.`);
    }
    return pass();
  },
  { failClosed: false, name: 'fullstack/session-start' },
);
