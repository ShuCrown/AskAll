import type { AiSelectors } from '@/utils/aiConfig';

/**
 * 注入到 AI 页面的自动填充并发送函数。
 *
 * 注意：该函数会被 `browser.scripting.executeScript` 注入到目标页面，
 * 运行在页面上下文中，因此必须写成「纯函数」——不能引用任何外部变量、
 * 模块、闭包，所有依赖都必须通过 args 传入。
 *
 * 注入脚本运行在 content script 的 ISOLATED world，Chrome 原生全局 `chrome`
 * 可用（wxt 的 `browser` polyfill 是模块局部变量，注入脚本访问不到），
 * 这里用局部声明补类型。
 */
declare const chrome: {
  runtime: {
    sendMessage: (message: {
      type: string;
      aiName?: string;
      text?: string;
    }) => void;
  };
};
export async function autoFillAndSend(
  text: string,
  selectors: AiSelectors,
  aiName: string,
) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // 等待输入框出现（最多 60 次 x 500ms ≈ 30s）
  let input: HTMLElement | null = null;
  for (let i = 0; i < 60; i++) {
    const candidates: string[] = selectors.inputCandidates || [
      selectors.input,
    ];
    for (const sel of candidates) {
      const el = document.querySelector<HTMLElement>(sel);
      // 确保元素可见且可编辑
      if (
        el &&
        el.offsetParent !== null &&
        (el.tagName === 'TEXTAREA' ||
          el.tagName === 'INPUT' ||
          el.isContentEditable)
      ) {
        input = el;
        break;
      }
    }
    if (input) break;
    await wait(500);
  }

  if (!input) {
    console.error('❌ [multi-ai-ask] 未找到输入框');
    return;
  }

  // 聚焦并设置值（兼容受控组件：通过原生 setter 触发）
  input.focus();
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    const proto =
      input.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, text);
    else (input as HTMLInputElement).value = text;
  } else if (input.isContentEditable) {
    input.textContent = text;
  }

  // 触发多种事件，模拟真实输入（部分站点需要 compositionend 才激活发送按钮）
  const events = [
    new Event('input', { bubbles: true }),
    new Event('change', { bubbles: true }),
    new KeyboardEvent('keyup', { bubbles: true, key: 'a', code: 'KeyA' }),
    new KeyboardEvent('keydown', { bubbles: true, key: 'a', code: 'KeyA' }),
    new CompositionEvent('compositionend', { bubbles: true, data: text }),
  ];
  events.forEach((ev) => input!.dispatchEvent(ev));

  // 等待发送按钮变为可用（有些网站需要时间处理输入状态）
  await wait(2000);

  // 尝试点击发送按钮
  let sent = false;
  if (selectors.sendButton) {
    const candidates: string[] = selectors.sendButtonCandidates || [
      selectors.sendButton,
    ];
    for (const sel of candidates) {
      const btn = document.querySelector<HTMLElement>(sel);
      // 不检查 offsetParent：部分按钮位于 shadow DOM 边界等场景下
      // offsetParent 为 null，但 click 依然有效
      if (btn && !(btn as HTMLButtonElement).disabled) {
        btn.click();
        sent = true;
        console.log('✅ [multi-ai-ask] 点击发送按钮成功');
        break;
      }
    }
  }

  // 点击失败则模拟回车（更真实、更完整的事件对象）
  if (!sent) {
    input.focus();
    const keyboardEventInit: KeyboardEventInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    input.dispatchEvent(new KeyboardEvent('keydown', keyboardEventInit));
    input.dispatchEvent(new KeyboardEvent('keyup', keyboardEventInit));
    console.log('🔄 [multi-ai-ask] 已尝试模拟回车发送');
  }

  // 发送已触发，启动「回答完成检测」：轮询回复块文本，稳定后通知后台弹提醒。
  // 不 await，让它在页面后台继续运行。
  startReplyWatch(selectors, aiName);

  /**
   * 回答完成检测（纯函数，随注入脚本运行在页面上下文）。
   *
   * 原理：AI 回复是流式输出。每隔 2s 取最后一个「回复块元素」的文本，
   * 连续 N 次长度不再变化（且非空）即视为回答结束，向后台发送 AI_REPLY_DONE。
   * 90s 内未完成则静默放弃，避免常驻轮询。
   */
  async function startReplyWatch(sels: AiSelectors, name: string) {
    const candidates =
      sels.replyCandidates || [
        '[class*="markdown"]',
        '[class*="answer"]',
        '[class*="response"]',
      ];
    const STABLE_THRESHOLD = 4; // 连续稳定次数（× 2s 间隔 ≈ 8s）
    const TIMEOUT = 90_000;
    const startedAt = Date.now();

    let lastText = '';
    let stableCount = 0;

    while (Date.now() - startedAt < TIMEOUT) {
      // 取最后一个匹配到的回复块
      let replyEl: Element | null = null;
      for (const sel of candidates) {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length > 0) {
          const last = nodes[nodes.length - 1];
          if (last) replyEl = last;
          break;
        }
      }
      const text = replyEl ? (replyEl.textContent || '').trim() : '';

      if (text.length > 0) {
        if (text === lastText) {
          stableCount++;
          if (stableCount >= STABLE_THRESHOLD) {
            console.log(`✅ [multi-ai-ask] ${name} 回答完成`);
            try {
              chrome.runtime.sendMessage({
                type: 'AI_REPLY_DONE',
                aiName: name,
                text: text.slice(0, 4000), // 限制长度避免消息过大
              });
            } catch {
              /* 消息发送失败忽略（页面关闭等场景） */
            }
            return;
          }
        } else {
          stableCount = 0;
          lastText = text;
          // 流式输出过程中持续同步最新回复文本到后台
          try {
            chrome.runtime.sendMessage({
              type: 'AI_REPLY',
              aiName: name,
              text: text.slice(0, 4000),
            });
          } catch {
            /* ignore */
          }
        }
      } else {
        // 回复尚未开始（或思考中/发送失败），重置基线
        lastText = '';
        stableCount = 0;
      }
      await wait(2000);
    }
    // 超时未检测到完成，静默退出
  }
}
