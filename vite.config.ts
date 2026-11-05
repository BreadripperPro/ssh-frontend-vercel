import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.join(appRoot, 'frontend');

/**
 * 注入运行时配置文件 `public/config.js`。
 *
 * 该脚本必须早于主模块脚本执行（普通 script 同步执行，type="module" 延迟执行），
 * 因此前端在启动时即可读到 `window.__CLOUDSSH_CONFIG__.apiBaseUrl`。
 *
 * 运行时配置的好处：同一份构建产物可以指向不同后端，切换后端无需重新构建。
 */
function runtimeConfigPlugin(): Plugin {
  return {
    name: 'cloudssh-runtime-config',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'script',
            attrs: { src: '/config.js' },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

export default defineConfig({
  // 前端源码由 `pnpm run sync` 从 CloudSSH Worker 工程同步而来
  root: frontendRoot,
  // 公共静态资源（config.js / favicon.svg）位于工程根目录的 public/
  publicDir: path.join(appRoot, 'public'),
  plugins: [runtimeConfigPlugin()],
  esbuild: {
    // @xterm/xterm 6 ships pre-minified ESM. Re-running esbuild's syntax
    // minifier can drop a declaration in InputHandler.requestMode, causing
    // DECRQM queries from Vim and other TUIs to throw and stop terminal input.
    // Keep the other minification passes enabled while avoiding that transform.
    // https://github.com/xtermjs/xterm.js/issues/5800
    minifySyntax: false,
  },
  build: {
    outDir: path.join(appRoot, 'dist'),
    emptyOutDir: true,
    modulePreload: {
      polyfill: false,
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
