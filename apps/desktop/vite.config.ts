import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri 期望前端开发服务器固定端口 1420；移动端/远程开发时通过
// TAURI_DEV_HOST 注入主机地址，供真机/模拟器访问。
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  // 复用扩展端 public 静态资源（应用图标 png + AI 厂商官方 svg），
  // 供共享组件经 assetUrl('icon/…') / assetUrl('ai/…') 引用
  publicDir: path.resolve(__dirname, '../extension/public'),
  // Tauri 自带终端输出，无需 Vite 清屏
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      // 忽略 Rust 侧变更，避免触发前端 HMR
      ignored: ['**/src-tauri/**'],
    },
  },
  resolve: {
    // 与 tsconfig.paths 保持一致，确保 dev/build 都能解析 @askall/shared 源码
    alias: {
      '@askall/shared': path.resolve(
        __dirname,
        '../../packages/shared/src/index.ts',
      ),
    },
  },
  build: {
    target: 'es2021',
    outDir: 'dist',
    emptyOutDir: true,
    // 桌面端通过本地 webview 加载，分包过细意义不大，按默认行为即可
  },
}));
