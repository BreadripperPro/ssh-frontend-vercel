/**
 * 把 CloudSSH Worker 前端的依赖同步到本 Vercel 工程的 package.json。
 *
 * 版本来源：Worker 工程的 `pnpm-lock.yaml`（frontend importer 段落）里的**已锁定版本**，
 * 而不是 package.json 里的 caret 范围。原因：
 *   - 与 Worker 工程使用完全相同的依赖版本，行为逐字节一致；
 *   - 绕开「刚发布的版本」问题（本仓库启用了 minimumReleaseAge 供应链策略，
 *     直接用 caret 范围重新解析会拉到 7 天内发布的新版本并被策略拦截）；
 *   - 构建可复现。
 *
 * 只在「Worker 前端依赖发生变化」时需要手动执行一次：
 *   pnpm run sync:deps && pnpm install
 *
 * 构建流程（`pnpm run build`）不会自动改写 package.json —— 依赖变更必须先安装
 * 再构建，否则 Vercel 的 `pnpm install --frozen-lockfile` 会因锁文件不一致而失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkerFrontendDeps } from './lib/worker-deps.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '..');
const workerRoot = path.join(repoRoot, 'CloudSSH-for cloudflare workers');

if (!fs.existsSync(path.join(workerRoot, 'frontend'))) {
  console.error(`[sync:deps] 找不到 Worker 前端目录：${path.join(workerRoot, 'frontend')}`);
  process.exit(1);
}

const { pkg: workerPkg, locked } = readWorkerFrontendDeps(workerRoot);

const appPkgPath = path.join(appRoot, 'package.json');
const appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf8'));

function syncField(field) {
  const source = workerPkg[field] ?? {};
  const result = {};
  for (const [name, range] of Object.entries(source)) {
    result[name] = locked?.get(name) ?? range;
  }
  appPkg[field] = result;
}

syncField('dependencies');
syncField('devDependencies');

fs.writeFileSync(appPkgPath, `${JSON.stringify(appPkg, null, 2)}\n`, 'utf8');
console.log(
  locked
    ? '[sync:deps] 依赖已按 Worker 工程锁文件对齐，请执行 `pnpm install` 更新本工程锁文件。'
    : '[sync:deps] 未找到 Worker 工程锁文件，已使用 package.json 中的版本范围。'
);
