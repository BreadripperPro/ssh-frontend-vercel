/*
 * CloudSSH 外部前端运行时配置
 * ------------------------------------------------------------------
 * 本文件由 `public/config.js` 在前端启动时加载（早于主应用脚本），
 * 部署到 Vercel 后想换后端地址，改这里再重新部署即可，无需改代码。
 *
 * apiBaseUrl：
 *   - CloudSSH Worker 后端地址（https:// 开头，不带尾斜杠、不带路径）。
 *     例：https://cloudssh.example.com 或 https://cloudssh.workers.dev
 *   - 留空表示「与前端同源」部署（前端由同一个 Worker 直接托管）。
 *
 * 安全提示：
 *   - 这里只能填你自己的 Worker 后端。填错地址等于把登录凭据发给该地址。
 *   - 不要把后端地址放在 URL 参数里：那样任何人都能用构造链接把访客的
 *     凭据引到他控制的服务器。地址只允许来自本文件或构建期环境变量。
 */
window.__CLOUDSSH_CONFIG__ = {
  apiBaseUrl: 'https://sshplus.heey.cc.cd',
};
