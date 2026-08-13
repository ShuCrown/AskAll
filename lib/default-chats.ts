import type { ChatConfig } from './types';

/**
 * Built-in chat presets. Selectors change frequently — these are best-effort
 * defaults; users can edit them in the options page.
 */
export const DEFAULT_CHATS: ChatConfig[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    icon: '🤖',
    color: '#10a37f',
    url: 'https://chatgpt.com/',
    mode: 'inject',
    inputSelector:
      '#prompt-textarea, div#prompt-textarea, textarea[id*="prompt"], div[contenteditable="true"][id*="prompt"]',
    sendSelector:
      'button[data-testid="send-button"], button[aria-label="Send prompt"], form button[type="submit"]',
    enabled: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    icon: '✨',
    color: '#d97757',
    url: 'https://claude.ai/new',
    mode: 'inject',
    inputSelector:
      'div[contenteditable="true"][role="textbox"], div.ProseMirror[contenteditable="true"]',
    sendSelector:
      'button[aria-label="Send Message"], button[type="submit"]',
    enabled: true,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    icon: '💎',
    color: '#4285f4',
    url: 'https://gemini.google.com/app',
    mode: 'inject',
    inputSelector: 'rich-textarea, .ql-editor[contenteditable="true"], div[contenteditable="true"]',
    sendSelector: 'button.send-button, button[aria-label="Send message"], button[aria-label*="Send"]',
    enabled: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    icon: '🐳',
    color: '#4d6bfe',
    url: 'https://chat.deepseek.com/',
    mode: 'inject',
    inputSelector: '#chat-input, textarea#chat-input, textarea',
    sendSelector: 'div[role="button"].ds-icon-button, button[aria-label="Send"]',
    enabled: false,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    icon: '🌙',
    color: '#1f1f1f',
    url: 'https://kimi.moonshot.cn/chat',
    mode: 'inject',
    inputSelector: '#chat-input, textarea#chat-input, textarea.editor',
    sendSelector: '.send-button, button[aria-label="发送"], button[type="submit"]',
    enabled: false,
  },
  {
    id: 'grok',
    name: 'Grok',
    icon: '🧠',
    color: '#1d9bf0',
    url: 'https://grok.com/',
    mode: 'inject',
    inputSelector: 'textarea, div[contenteditable="true"]',
    sendSelector: 'button[aria-label="Submit"], button[aria-label="Send"], button[type="submit"]',
    enabled: false,
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    icon: '🔮',
    color: '#20808d',
    url: 'https://www.perplexity.ai/',
    mode: 'url_param',
    paramName: 'q',
    enabled: false,
  },
  {
    id: 'phind',
    name: 'Phind',
    icon: '🔍',
    color: '#7c3aed',
    url: 'https://www.phind.com/search',
    mode: 'url_param',
    paramName: 'q',
    enabled: false,
  },
];
