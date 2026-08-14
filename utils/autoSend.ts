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

  // 向后台发送消息。MAIN world 下页面没有 chrome 全局，静默跳过回执通知。
  const sendToBackground = (msg: {
    type: string;
    aiName?: string;
    text?: string;
  }) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage(msg);
      }
    } catch {
      /* 页面关闭等场景下忽略 */
    }
  };

  // 等待输入框出现（最多 60 次 x 500ms ≈ 30s）。
  // 用 querySelectorAll 遍历同选择器的所有节点，选「可见且可编辑」的那一个：
  // 避免页面存在多个 textarea 时 querySelector 命中隐藏输入框，导致文字填错元素、发送无反应。
  let input: HTMLElement | null = null;
  const inputCandidates: string[] = selectors.inputCandidates || [
    selectors.input,
  ];
  for (let i = 0; i < 60 && !input; i++) {
    for (const sel of inputCandidates) {
      const nodes = document.querySelectorAll<HTMLElement>(sel);
      for (const el of nodes) {
        if (
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
    }
    if (!input) await wait(500);
  }

  if (!input) {
    console.error('❌ [multi-ai-ask] 未找到输入框');
    return;
  }

  // 聚焦并设置值
  input.focus();
  await wait(200);

  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    // 受控组件：通过原生 setter + InputEvent 触发框架状态更新。
    // 使用 InputEvent（而非普通 Event）携带 data 和 inputType，
    // 确保 DeepSeek/豆包 等 React 组件能正确识别输入并启用发送按钮。
    const proto =
      input.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, text);
    else (input as HTMLInputElement).value = text;

    // beforeinput + input：现代框架（React 17+）优先监听 beforeinput
    input.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: 'insertText',
      }),
    );
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: text,
        inputType: 'insertText',
      }),
    );
    input.dispatchEvent(new Event('change', { bubbles: true }));
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

  // 等待框架处理输入状态（缩短等待，剩余等待交给发送阶段的轮询）
  await wait(200);

  // 判断按钮是否可用。
  // 兼容各平台不同的禁用表达：原生 disabled / aria-disabled / data-disabled /
  // data-loading（豆包） / CSS 禁用类。
  const isBtnDisabled = (btn: HTMLElement): boolean =>
    (btn as HTMLButtonElement).disabled === true ||
    btn.hasAttribute('disabled') ||
    btn.getAttribute('aria-disabled') === 'true' ||
    btn.getAttribute('data-disabled') === 'true' ||
    btn.getAttribute('data-loading') === 'true' ||
    btn.classList.contains('disabled') ||
    btn.classList.contains('is-disabled');

  // 点击发送按钮：对任意标签派发完整的 pointer + mouse + click 事件序列。
  // 不同平台/组件库监听的触发事件各不相同：
  // - React onClick 监听冒泡 click
  // - 部分自定义 Button（如豆包 data-dbx-name="button"）监听 pointerdown/pointerup
  // - 部分 SPA 监听 mousedown/mouseup
  // 统一派发完整序列保证全部命中；带坐标模拟真实点击，避免 detail=0 被忽略。
  // 注意：不再调用 .click()，避免「已派发 click 事件」+「.click()」导致重复发送。
  const clickBtn = (btn: HTMLElement) => {
    const rect = btn.getBoundingClientRect();
    const opts: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      detail: 1,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    };
    btn.dispatchEvent(new PointerEvent('pointerdown', opts));
    btn.dispatchEvent(new MouseEvent('mousedown', opts));
    btn.dispatchEvent(new PointerEvent('pointerup', opts));
    btn.dispatchEvent(new MouseEvent('mouseup', opts));
    btn.dispatchEvent(new MouseEvent('click', opts));
  };

  // 发送按钮：优先等待「平台专属」按钮（candidates[0]）出现并可用，点击后用
  // 「输入框是否被清空」验证是否真正发送成功；失败则快速重试/兜底，
  // 避免「点一次就放弃、5 秒后才走 Enter 兜底」造成的发送延迟和豆包静默失败。
  let sent = false;

  // 发送成功的信号：输入框被清空（成功发送后框架会清空输入，或重建输入框）
  const inputCleared = (): boolean => {
    if (!input || !input.isConnected) return true; // 元素被移除/重渲染 = 已发送
    const v =
      input.tagName === 'TEXTAREA' || input.tagName === 'INPUT'
        ? (input as HTMLInputElement).value
        : (input.textContent || '');
    return v.trim().length === 0;
  };

  // 点击并验证：点击后轮询输入框是否被清空
  const clickAndVerify = async (btn: HTMLElement, waitMs: number) => {
    clickBtn(btn);
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      await wait(150);
      if (inputCleared()) return true;
    }
    return false;
  };

  if (selectors.sendButton) {
    const candidates: string[] = selectors.sendButtonCandidates || [
      selectors.sendButton,
    ];
    const specific = candidates[0];

    // 阶段1：等专属按钮（最具体）可用后点击并验证，最多约 3s
    for (let attempt = 0; attempt < 20 && !sent; attempt++) {
      const btn = specific
        ? document.querySelector<HTMLElement>(specific)
        : null;
      if (btn && !isBtnDisabled(btn)) {
        sent = await clickAndVerify(btn, 2500);
      }
      if (!sent) await wait(150);
    }

    // 阶段2：专属按钮点击后输入未被清空，再尝试一次（首次点击可能被框架忽略）
    if (!sent && specific) {
      const btn = document.querySelector<HTMLElement>(specific);
      if (btn && !isBtnDisabled(btn)) {
        sent = await clickAndVerify(btn, 2000);
      }
    }

    // 阶段3：仍未成功，遍历其余「安全」候选（均为带 id/aria-label/class 的选择器，
    // 不含 div[role="button"] 等宽泛选择器，避免误点搜索/工具栏按钮）
    for (let c = 1; c < candidates.length && !sent; c++) {
      const sel = candidates[c];
      if (!sel) continue;
      const btn = document.querySelector<HTMLElement>(sel);
      if (btn && !isBtnDisabled(btn)) {
        sent = await clickAndVerify(btn, 2000);
      }
    }
  }

  // 兜底：模拟回车（textarea/input 平台，如 DeepSeek/文心 Enter 可直接发送），
  // 并轮询验证以尽量缩短发送延迟
  if (!sent && input) {
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
    const start = Date.now();
    while (Date.now() - start < 2500) {
      await wait(200);
      if (inputCleared()) break;
    }
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
            sendToBackground({
              type: 'AI_REPLY_DONE',
              aiName: name,
              text: text.slice(0, 4000), // 限制长度避免消息过大
            });
            return;
          }
        } else {
          stableCount = 0;
          lastText = text;
          // 流式输出过程中持续同步最新回复文本到后台
          sendToBackground({
            type: 'AI_REPLY',
            aiName: name,
            text: text.slice(0, 4000),
          });
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
