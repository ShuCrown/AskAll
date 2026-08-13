import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // 生产打包优化：压缩脚本体积
  vite: () => ({
    build: {
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
    ],
    host_permissions: [
      'https://chat.deepseek.com/*',
      'https://www.doubao.com/*',
      'https://yiyan.baidu.com/*',
      'https://tongyi.aliyun.com/*',
      // 新增 AI 网站时，需在此追加对应的 host 权限（executeScript 注入需要）
    ],
    action: {
      default_title: 'AskAll 齐问',
    },
    // 允许网页/内容脚本加载 public/ai 下的品牌 SVG（否则 content script 中 img 会被拦截）
    web_accessible_resources: [
      {
        resources: ['ai/*'],
        matches: ['<all_urls>'],
      },
    ],
    options_ui: {
      page: 'options.html',
      open_in_tab: false,
    },
  },
});
