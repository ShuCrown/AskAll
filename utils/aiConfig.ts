export interface AiSelectors {
  /** 主输入框选择器 */
  input: string;
  /** 输入框候选选择器（按顺序尝试） */
  inputCandidates?: string[];
  /** 发送按钮选择器 */
  sendButton?: string;
  /** 发送按钮候选选择器（按顺序尝试） */
  sendButtonCandidates?: string[];
}

export interface AiConfig {
  id: string;
  name: string;
  /** 打开 AI 页面的地址（可包含 {query} 占位符） */
  url: string;
  enabled: boolean;
  /** 是否自动填充并发送 */
  autoSend: boolean;
  /** 自动发送所需的 DOM 选择器 */
  selectors?: AiSelectors;
}

/**
 * 默认 AI 配置。注意：不同 AI 网站的 DOM 结构经常变化，
 * 实际使用时可在设置面板中调整选择器。
 */
export const DEFAULT_AI_CONFIGS: AiConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    enabled: true,
    autoSend: true,
    selectors: {
      input: 'textarea',
      inputCandidates: ['textarea', 'div[contenteditable="true"]'],
      sendButton: 'button[type="submit"]',
      sendButtonCandidates: [
        'button[type="submit"]',
        'button:has(svg)',
        'div[role="button"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
      ],
    },
  },
  {
    id: 'doubao',
    name: '豆包',
    url: 'https://www.doubao.com/chat/',
    enabled: true,
    autoSend: true,
    selectors: {
      input: 'textarea',
      inputCandidates: [
        'textarea',
        'div[contenteditable="true"]',
        'div[class*="input"]',
        'div[class*="editor"]',
        'div[role="textbox"]',
      ],
      sendButton: '#flow-end-msg-send',
      sendButtonCandidates: [
        '#flow-end-msg-send',
        'button[id*="send"]',
        'button[class*="send"]',
        'button[type="submit"]',
        'div[role="button"]',
        'button:has(svg)',
      ],
    },
  },
  {
    id: 'kimi',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn/',
    enabled: true,
    autoSend: true,
    selectors: {
      input: 'textarea',
      inputCandidates: [
        'textarea',
        'div[contenteditable="true"]',
        'div[class*="input"]',
        'div[class*="editor"]',
        'div[role="textbox"]',
      ],
      sendButton: 'button[type="submit"]',
      sendButtonCandidates: [
        'button[type="submit"]',
        'button[class*="send"]',
        'button[class*="submit"]',
        'div[role="button"]',
        'button:has(svg)',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
      ],
    },
  },
  {
    id: 'qwen',
    name: '通义千问',
    url: 'https://tongyi.aliyun.com/qianwen/',
    enabled: true,
    autoSend: true,
    selectors: {
      input: 'textarea',
      inputCandidates: [
        'textarea',
        'div[contenteditable="true"]',
        'div[class*="input"]',
        'div[class*="editor"]',
        'div[role="textbox"]',
      ],
      sendButton: 'button[type="submit"]',
      sendButtonCandidates: [
        'button[type="submit"]',
        'button[class*="send"]',
        'button[class*="submit"]',
        'div[role="button"]',
        'button:has(svg)',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
      ],
    },
  },
];
