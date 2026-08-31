export interface AiSelectors {
  /** 主输入框选择器 */
  input: string;
  /** 输入框候选选择器（按顺序尝试） */
  inputCandidates?: string[];
  /** 发送按钮选择器 */
  sendButton?: string;
  /** 发送按钮候选选择器（按顺序尝试） */
  sendButtonCandidates?: string[];
  /**
   * AI 回复块候选选择器（按顺序尝试，取最后一个匹配元素）。
   * 用于「回答完成提醒」：轮询该元素文本，连续稳定即视为回答结束。
   * 注意：不要匹配到输入框（textarea/input），否则文本恒为问题内容会误报。
   */
  replyCandidates?: string[];
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
  /** 默认内置配置，不可编辑/删除，仅支持启停 */
  isDefault?: boolean;
}

/**
 * 默认 AI 配置。注意：不同 AI 网站的 DOM 结构经常变化，
 * 实际使用时可在设置面板中调整选择器。
 */

/**
 * 合并默认配置与存储配置。
 * 内置项始终以最新 DEFAULT_AI_CONFIGS 为准（含最新选择器），
 * 仅保留用户的启停状态；自定义项原样保留。
 */
export function mergeConfigs(stored: AiConfig[] | null): AiConfig[] {
  if (!stored) return DEFAULT_AI_CONFIGS;
  const defaultIds = DEFAULT_AI_CONFIGS.map((d) => d.id);
  const userConfigs = stored.filter((c) => !defaultIds.includes(c.id));
  return [
    ...DEFAULT_AI_CONFIGS.map((d) => {
      const existing = stored.find((c) => c.id === d.id);
      return existing ? { ...d, enabled: existing.enabled } : d;
    }),
    ...userConfigs,
  ];
}

export const DEFAULT_AI_CONFIGS: AiConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    enabled: true,
    autoSend: true,
    isDefault: true,
    selectors: {
      input: 'textarea',
      inputCandidates: ['textarea', 'div[contenteditable="true"]'],
      sendButton: 'div[role="button"][aria-label*="发送"]',
      // 仅保留带 aria-label/id 的安全选择器；
      // 移除 div[role="button"]、button:has(svg)、div.ds-chat-footer div[role="button"]
      // 等宽泛选择器——它们会匹配到「联网搜索」等工具栏按钮导致误点击
      sendButtonCandidates: [
        'div[role="button"][aria-label*="发送"]',
        'div[role="button"][aria-label*="Send"]',
        'div[role="button"][aria-label*="send"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
      ],
      replyCandidates: [
        '.ds-markdown',
        '[class*="markdown"]',
        '[class*="answer"]',
        '[class*="response"]',
      ],
    },
  },
  {
    id: 'doubao',
    name: '豆包',
    url: 'https://www.doubao.com/chat/',
    enabled: true,
    autoSend: true,
    isDefault: true,
    selectors: {
      // 2026 改版：输入框由 Semi textarea 换成 TipTap/ProseMirror contenteditable
      input: '.tiptap.ProseMirror',
      inputCandidates: [
        '.tiptap.ProseMirror',
        'div[contenteditable="true"]',
        'div[role="textbox"]',
        'textarea.semi-input-textarea-autosize',
        'textarea[placeholder]',
        'textarea',
      ],
      sendButton: '#flow-end-msg-send',
      // 移除 div[role="button"]、button:has(svg) 等宽泛选择器，避免误点击工具栏；
      // 优先带 aria-label（发送/Send）的专属按钮，旧版 id 保留兜底
      sendButtonCandidates: [
        '#flow-end-msg-send',
        'div[role="button"][aria-label*="发送"]',
        'button[aria-label*="发送"]',
        'div[role="button"][aria-label*="Send"]',
        'button[aria-label*="Send"]',
        'button[class*="send"]',
        'div[class*="send-btn"]',
      ],
      replyCandidates: [
        '[class*="markdown"]',
        '[class*="message-content"]',
        '[class*="msg-content"]',
        '[class*="answer"]',
        '[class*="response"]',
        '[class*="message"] div[class*="text"]',
      ],
    },
  },
  {
    id: 'wenxin',
    name: '文心一言',
    url: 'https://wenxin.baidu.com/',
    enabled: true,
    autoSend: true,
    isDefault: true,
    selectors: {
      input: 'textarea#chat-textarea',
      inputCandidates: [
        'textarea#chat-textarea',
        'textarea.ci-textarea',
        'textarea[placeholder]',
        'textarea',
        'div[contenteditable="true"]',
        'div[role="textbox"]',
      ],
      sendButton: 'button.ci-input-send-btn',
      sendButtonCandidates: [
        'button.ci-input-send-btn',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        '#ci-submit-button-ai',
        'span.ci-submit-button',
        'span[class*="submit-button"]',
        'button[class*="send"]',
      ],
      replyCandidates: [
        '[class*="markdown"]',
        '[class*="answer"]',
        '[class*="response"]',
      ],
    },
  },
  {
    id: 'qwen',
    name: '通义千问',
    url: 'https://www.qianwen.com/',
    enabled: true,
    autoSend: true,
    isDefault: true,
    selectors: {
      input: 'div[contenteditable="true"][role="textbox"]',
      inputCandidates: [
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'div[role="textbox"]',
        'textarea',
        'div[class*="editor"]',
      ],
      sendButton: 'button[aria-label="发送消息"]',
      sendButtonCandidates: [
        'button[aria-label="发送消息"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'button[class*="send"]',
      ],
      replyCandidates: [
        '[class*="markdown"]',
        '[class*="answer"]',
        '[class*="response"]',
      ],
    },
  },
];
