import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'AskAll — Multi Chat AI',
    description:
      'Select text on any page and ask all your favorite AI chats at once. Auto-sends, logs history, fully configurable.',
    version: '0.1.0',
    permissions: ['storage', 'tabs', 'scripting', 'activeTab', 'clipboardWrite'],
    host_permissions: ['<all_urls>'],
    commands: {
      'ask-all-from-selection': {
        suggested_key: {
          default: 'Ctrl+Shift+L',
          mac: 'Command+Shift+L',
        },
        description: 'Ask all enabled chats about the current text selection',
      },
      '_execute_action': {
        suggested_key: {
          default: 'Ctrl+Shift+Y',
          mac: 'Command+Shift+Y',
        },
      },
    },
    action: {
      default_title: 'AskAll',
    },
  },
});
