/**
 * 从 CloudSSH Worker 工程同步前端源码到本 Vercel 工程。
 *
 * 目标：**只维护一份 UI 源码**。CloudSSH Worker 自带前端与本 Vercel 前端
 * 使用完全相同的 `frontend/src`，因此两边的界面、交互、登录流程、终端行为
 * 永远一致（100% 相同用户体验），不会因为复制粘贴而逐渐漂移。
 *
 * 同步内容：
 *   1. Worker 的 `frontend/src/**`      → `frontend/src/**`
 *   2. Worker 的 `frontend/index.html`   → `frontend/index.html`
 *   3. Worker 的 tailwind/postcss/tsconfig → `frontend/`
 *   4. Worker 的 `frontend/public/favicon.svg` → `public/favicon.svg`
 *   5. 前端源码引用到的共享模块（`../../src/**`）→ `src/**`
 *
 * 共享模块按「实际 import 路径」自动解析并复制：新增共享 import 时无需手工维护
 * 清单；若引用了不存在的文件，构建会直接失败而不是静默产出坏包。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkerFrontendDeps } from './lib/worker-deps.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '..');
const workerRoot = path.join(repoRoot, 'CloudSSH-for cloudflare workers');
const workerFrontend = path.join(workerRoot, 'frontend');
const workerSrc = path.join(workerRoot, 'src');

const workerProjectAvailable = fs.existsSync(workerFrontend) && fs.existsSync(workerSrc);

if (!workerProjectAvailable) {
  // Vercel 以本工程为 Root Directory 构建时只上传本目录，拿不到同级的 Worker 工程。
  // 此时直接使用已提交的同步副本（`frontend/` 与 `src/`），保证构建仍然可复现。
  const hasLocalCopy =
    fs.existsSync(path.join(appRoot, 'frontend', 'src')) &&
    fs.existsSync(path.join(appRoot, 'src'));
  if (!hasLocalCopy) {
    console.error(
      `[sync] 找不到 CloudSSH Worker 工程目录：${workerRoot}\n` +
        '[sync] 本工程依赖同级目录 "CloudSSH-for cloudflare workers"。\n' +
        '[sync] 若本工程被单独拆分为独立仓库，请先在原仓库执行一次 `pnpm run sync`，\n' +
        '[sync] 然后把生成的 `frontend/` 与 `src/` 目录连同本工程一起提交。'
    );
    process.exit(1);
  }
  console.warn(
    '[sync] 未找到 CloudSSH Worker 工程目录，改用已提交的同步副本（frontend/ 与 src/）。'
  );
  console.warn(
    '[sync] 如需与 Worker 最新源码保持一致，请在仓库根目录执行 `pnpm run sync` 后提交本工程的 frontend/ 与 src/。'
  );
  process.exit(0);
}

// ---------- 通用文件操作 ----------

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDir(source, target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

// ---------- 1. 前端源码与静态资源 ----------

const targetFrontend = path.join(appRoot, 'frontend');
copyDir(path.join(workerFrontend, 'src'), path.join(targetFrontend, 'src'));
copyFile(path.join(workerFrontend, 'index.html'), path.join(targetFrontend, 'index.html'));
copyFile(
  path.join(workerFrontend, 'tailwind.config.cjs'),
  path.join(targetFrontend, 'tailwind.config.cjs')
);
copyFile(
  path.join(workerFrontend, 'postcss.config.cjs'),
  path.join(targetFrontend, 'postcss.config.cjs')
);
copyFile(path.join(workerFrontend, 'tsconfig.json'), path.join(targetFrontend, 'tsconfig.json'));

const favicon = path.join(workerFrontend, 'public', 'favicon.svg');
if (fs.existsSync(favicon)) {
  copyFile(favicon, path.join(appRoot, 'public', 'favicon.svg'));
}

/**
 * 把 import 说明符解析成实际文件路径。
 * 说明符通常不带扩展名（TS 的 bundler 解析方式），因此依次尝试 .ts / .tsx / /index.ts。
 */
function resolveModule(baseDir, specifier) {
  const resolved = path.resolve(baseDir, specifier);
  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    path.join(resolved, 'index.ts'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// ---------- 2. 解析并复制前端依赖的共享模块 ----------

// 形如 `../../src/xxx` / `../../../src/xxx` 的相对 import（相对于 frontend/src 下的文件）
const SHARED_IMPORT_RE = /(?:from|import)\s*\(?\s*['"](\.\.\/(?:\.\.\/)*src\/[^'"]+)['"]/g;

const sharedFiles = new Set();
for (const relative of listFiles(path.join(workerFrontend, 'src'))) {
  const filePath = path.join(workerFrontend, 'src', relative);
  const content = fs.readFileSync(filePath, 'utf8');
  for (const match of content.matchAll(SHARED_IMPORT_RE)) {
    const specifier = match[1];
    // `frontend/src/<relative>` 相对解析
    const importerDir = path.dirname(path.join(workerFrontend, 'src', relative));
    const resolved = resolveModule(importerDir, specifier);
    if (!resolved) {
      console.error(`[sync] 共享模块不存在：${specifier}（来自 frontend/src/${relative}）`);
      process.exit(1);
    }
    // 保持与 Worker 工程一致的相对位置：worker/src/... → <app>/src/...
    sharedFiles.add(path.relative(workerSrc, resolved).split(path.sep).join('/'));
  }
}

const targetShared = path.join(appRoot, 'src');
fs.rmSync(targetShared, { recursive: true, force: true });
for (const relative of [...sharedFiles].sort()) {
  copyFile(path.join(workerSrc, relative), path.join(targetShared, relative));
}

// ---------- 3. 依赖版本一致性检查 ----------

const { pkg: workerPkg, locked } = readWorkerFrontendDeps(workerRoot);
const appPkgPath = path.join(appRoot, 'package.json');
const appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf8'));

const drift = [];
for (const field of ['dependencies', 'devDependencies']) {
  const expected = workerPkg[field] ?? {};
  const actual = appPkg[field] ?? {};
  for (const [name, range] of Object.entries(expected)) {
    // 基准版本：Worker 锁文件里的锁定版本；没有锁文件时退回 package.json 的范围
    const baseline = locked?.get(name) ?? range;
    if (actual[name] !== baseline) {
      drift.push(`  ${field}.${name}: 本工程=${actual[name] ?? '(缺失)'} / 应为=${baseline}`);
    }
  }
  for (const name of Object.keys(actual)) {
    if (!(name in expected)) {
      drift.push(`  ${field}.${name}: 本工程多出（Worker 工程未声明）`);
    }
  }
}

console.log(`[sync] 前端源码已同步：frontend/src、frontend/index.html、public/favicon.svg`);
console.log(`[sync] 共享模块已同步：${sharedFiles.size} 个 → src/`);
if (drift.length > 0) {
  console.warn('[sync] 依赖版本与 Worker 工程不一致，请执行 `pnpm run sync:deps` 后重新安装依赖：');
  for (const line of drift) console.warn(line);
}
