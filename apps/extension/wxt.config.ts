import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // 生产打包优化：压缩脚本体积
  vite: () => ({
    build: {
      // 关闭 modulepreload：扩展页在 ISOLATED world 中无法使用 preload，
      // 会触发 "cross-world extension resource mismatch" 警告（无害但干扰排查）
      modulePreload: false,
      // 生产环境不生成 sourcemap，减小产物体积
      sourcemap: false,
      // 使用 terser 做深度压缩，并在压缩阶段删除 console / debugger 语句
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
        format: {
          comments: false,
        },
      },
    },
  }),
  manifest: {
    name: 'AskAll 齐问',
    description: '划词同时向多个 AI 提问，自动发送并记录历史',
    permissions: [
      'contextMenus',
      'storage',
      'tabs',
      'scripting',
      'clipboardWrite',
      'notifications',
      // 解除 storage.local 配额（默认 ~10MB）：历史瘦身后可容纳大量会话
      'unlimitedStorage',
    ],
    host_permissions: [
      'https://chat.deepseek.com/*',
      'https://www.doubao.com/*',
      'https://wenxin.baidu.com/*',
      'https://chat.baidu.com/*',
      'https://yiyan.baidu.com/*',
      'https://www.qianwen.com/*',
      'https://tongyi.aliyun.com/*',
      'https://yuanbao.tencent.com/*',
      // 新增 AI 网站时，需在此追加对应的 host 权限（executeScript 注入需要）
    ],
    action: {
      default_title: 'AskAll 齐问',
    },
    // 允许网页/内容脚本加载 public 下的品牌资源（否则 content script 中 img 会被拦截）
    web_accessible_resources: [
      {
        resources: ['ai/*', 'icon/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
