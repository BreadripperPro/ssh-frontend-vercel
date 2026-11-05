/**
 * 读取 CloudSSH Worker 前端的依赖信息（package.json + pnpm-lock.yaml）。
 * 供 `sync-frontend.mjs` 与 `sync-deps.mjs` 共用。
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * 从 pnpm-lock.yaml 中读取 `frontend:` importer 段落里已锁定的依赖版本。
 * 只解析本项目需要的 `specifier:` / `version:` 两行，避免引入 YAML 依赖。
 */
export function readLockedVersions(lockfilePath) {
  if (!fs.existsSync(lockfilePath)) return null;
  const lines = fs.readFileSync(lockfilePath, 'utf8').split(/\r?\n/);

  let inFrontend = false;
  let inSection = false;
  let currentDep = null;
  const versions = new Map();

  for (const rawLine of lines) {
    if (/^importers:\s*$/.test(rawLine)) {
      inFrontend = false;
      continue;
    }
    if (/^  frontend:\s*$/.test(rawLine)) {
      inFrontend = true;
      continue;
    }
    if (!inFrontend) continue;
    // 退出 frontend importer 段（下一个同级 importer）
    if (/^  [A-Za-z0-9._-]+:\s*$/.test(rawLine) && !/^  frontend:\s*$/.test(rawLine)) break;
    if (/^    (dependencies|devDependencies):\s*$/.test(rawLine)) {
      inSection = true;
      currentDep = null;
      continue;
    }
    if (/^    \S/.test(rawLine)) {
      inSection = false;
      currentDep = null;
      continue;
    }
    if (!inSection) continue;

    const depMatch = rawLine.match(/^      '?([^':]+)'?:\s*$/);
    if (depMatch) {
      currentDep = depMatch[1].trim();
      continue;
    }
    const versionMatch = rawLine.match(/^        version:\s*(\S+)\s*$/);
    if (versionMatch && currentDep) {
      // pnpm 会把 peer 依赖后缀写进 version（如 `6.4.3(@types/node@26.2.0)`），
      // package.json 里只需要纯版本号。
      versions.set(currentDep, versionMatch[1].replace(/^'|'$/g, '').split('(')[0]);
      currentDep = null;
    }
  }
  return versions;
}

/** 读取 Worker 前端的依赖声明与锁定版本 */
export function readWorkerFrontendDeps(workerRoot) {
  const workerFrontend = path.join(workerRoot, 'frontend');
  const pkg = JSON.parse(fs.readFileSync(path.join(workerFrontend, 'package.json'), 'utf8'));
  const locked = readLockedVersions(path.join(workerRoot, 'pnpm-lock.yaml'));
  return { pkg, locked };
}
