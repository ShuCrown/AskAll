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

  // 判断 contenteditable 编辑器是否已包含目标文本（用于判断输入是否真正写入编辑器模型）
  const editorContainsText = (el: HTMLElement, target: string): boolean =>
    (el.textContent || '').includes(target);

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

  // 聚焦并设置值
  input.focus();
  await wait(200);

  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    // 受控组件：通过原生 setter + input 事件触发框架状态更新
    const proto =
      input.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, text);
    else (input as HTMLInputElement).value = text;

    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: text }),
    );
  } else if (input.isContentEditable) {
    // contenteditable。注意：千问/通义 用的是 Slate.js 富文本编辑器，
    // execCommand('insertText') 只改 DOM 不更新 Slate 内部状态，发送按钮会一直 disabled。
    // 必须派发 beforeinput/input（inputType: insertText）或 paste 事件走编辑器事件管线。
    input.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    // 方法1：beforeinput + input（Slate 及多数编辑器都监听这两个原生事件）
    input.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text,
      }),
    );
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: text,
        inputType: 'insertText',
      }),
    );

    // 方法2：paste 剪贴板事件（部分编辑器只通过 onPaste 读取内容）
    if (!editorContainsText(input, text)) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        input.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
          }),
        );
      } catch {
        /* 某些环境不支持 ClipboardEvent，忽略 */
      }
    }

    // 方法3：execCommand 兜底（普通 contenteditable，非 Slate）
    if (!editorContainsText(input, text)) {
      try {
        document.execCommand('insertText', false, text);
      } catch {
        /* ignore */
      }
    }
  }

  // 等待框架处理输入状态
  await wait(500);

  // 判断按钮是否可用：原生 disabled / aria-disabled / CSS 禁用类
  const isBtnDisabled = (btn: HTMLElement): boolean =>
    (btn as HTMLButtonElement).disabled === true ||
    btn.hasAttribute('disabled') ||
    btn.getAttribute('aria-disabled') === 'true' ||
    btn.classList.contains('disabled') ||
    btn.classList.contains('is-disabled');

  // 点击发送按钮（对 span/div 补充 mousedown/mouseup，部分 SPA 监听而非 click）
  const clickBtn = (btn: HTMLElement) => {
    if (btn.tagName !== 'BUTTON' && btn.tagName !== 'INPUT') {
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
    btn.click();
  };

  // 发送按钮：两阶段点击。
  // 阶段1）优先等待「平台专属」发送按钮（candidates[0]，最具体）渲染并可用后点击。
  // 阶段2）专属按钮超时未就绪，才回退到通用候选。
  // 避免误点通用按钮（如搜索框、工具栏按钮）导致「展开搜索窗口」而非发送。
  let sent = false;
  if (selectors.sendButton) {
    const candidates: string[] = selectors.sendButtonCandidates || [
      selectors.sendButton,
    ];

    // 阶段1：只等专属按钮（第一个候选项）
    const specific = candidates[0];
    if (specific) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const btn = document.querySelector<HTMLElement>(specific);
        if (btn && !isBtnDisabled(btn)) {
          clickBtn(btn);
          sent = true;
          break;
        }
        await wait(200);
      }
    }

    // 阶段2：专属按钮未就绪，等更久后回退到通用候选（跳过第 0 个，避免重复）
    if (!sent && candidates.length > 1) {
      for (let attempt = 0; attempt < 25; attempt++) {
        let clicked = false;
        for (let c = 1; c < candidates.length; c++) {
          const sel = candidates[c];
          if (!sel) continue;
          const btn = document.querySelector<HTMLElement>(sel);
          if (btn && !isBtnDisabled(btn)) {
            clickBtn(btn);
            clicked = true;
            sent = true;
            break;
          }
        }
        if (clicked) break;
        await wait(200);
      }
    }
  }

  // 点击失败则模拟回车
  if (!sent) {
    input.focus();
    await wait(100);
    const keyboardEventInit: KeyboardEventInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    input.dispatchEvent(new KeyboardEvent('keydown', keyboardEventInit));
    input.dispatchEvent(new KeyboardEvent('keypress', keyboardEventInit));
    input.dispatchEvent(new KeyboardEvent('keyup', keyboardEventInit));
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
