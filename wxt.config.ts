import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
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
      'https://kimi.moonshot.cn/*',
      'https://tongyi.aliyun.com/*',
      // 新增 AI 网站时，需在此追加对应的 host 权限（executeScript 注入需要）
    ],
    action: {
      default_title: 'AskAll 齐问',
    },
  },
});
