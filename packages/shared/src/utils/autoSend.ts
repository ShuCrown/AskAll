import type { AiSelectors } from './aiConfig';

/**
 * 注入到 AI 页面的自动填充并发送函数。
 *
 * 注意：该函数会被 `browser.scripting.executeScript` 注入到目标页面，
 * 运行在页面上下文（MAIN world），因此必须写成「纯函数」——不能引用任何外部变量、
 * 模块、闭包，所有依赖都必须通过 args 传入。
 *
 * 运行在 MAIN world 时页面没有 `chrome.runtime`。因此「回传回复到后台」有两种通道：
 * 1. 若存在 `chrome.runtime`（ISOLATED world）→ 直接 sendMessage；
 * 2. 否则派发 `askall:ai-reply` CustomEvent，由同页面 ISOLATED world 的
 *    content script 桥接转发到后台（见 content.tsx）。
 */

declare const chrome: {
  runtime: {
    sendMessage: (message: {
      type: string;
      aiName?: string;
      text?: string;
      taskId?: string;
      aiId?: string;
    }) => void;
  };
};

interface ReplyPayload {
  type: string;
  aiName?: string;
  text?: string;
  taskId?: string;
  aiId?: string;
}

export async function autoFillAndSend(
  text: string,
  selectors: AiSelectors,
  aiName: string,
  taskId: string,
  aiId: string,
) {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // 判断 contenteditable 编辑器是否已包含目标文本（用于判断输入是否真正写入编辑器模型）
  const editorContainsText = (el: HTMLElement, target: string): boolean =>
    (el.textContent || '').includes(target);

  // 向后台发送消息的回执。MAIN world 无 chrome.runtime，改派发 CustomEvent 由
  // content script 桥接；ISOLATED world 直接 sendMessage（两种情况互斥，避免重复）。
  const sendToBackground = (msg: ReplyPayload) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
        chrome.runtime.sendMessage(msg);
      }
    } catch {
      /* ignore */
    }
    try {
      window.dispatchEvent(new CustomEvent('askall:ai-reply', { detail: msg }));
    } catch {
      /* ignore */
    }
  };

  // ---------- 输入框识别：语义评分 + 选择器兜底 ----------
  const isVisible = (el: Element): boolean => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const isEditable = (el: Element): boolean =>
    (el as HTMLElement).isContentEditable === true ||
    el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' &&
      !['button', 'submit', 'hidden', 'checkbox', 'radio', 'file'].includes(
        (el as HTMLInputElement).type,
      ));

  const scoreInput = (el: Element): number => {
    let s = 0;
    if ((el as HTMLElement).isContentEditable) s += 40;
    if (el.getAttribute('role') === 'textbox') s += 30;
    if (el.tagName === 'TEXTAREA') s += 25;
    if (el.tagName === 'INPUT') s += 15;
    if (isVisible(el)) s += 20;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > window.innerHeight * 0.5) s += 15; // 位于页面底部
    const ph = (el.getAttribute('placeholder') || '').trim();
    if (/提问|输入|消息|发送|请输入|问问|message|ask|type/i.test(ph)) s += 15;
    if (document.activeElement === el) s += 20;
    if (rect.width > 200) s += 10;
    return s;
  };

  const findInputBySelectors = (): HTMLElement | null => {
    const candidates = selectors.inputCandidates?.length
      ? selectors.inputCandidates
      : selectors.input
        ? [selectors.input]
        : [];
    for (const sel of candidates) {
      const nodes = document.querySelectorAll<HTMLElement>(sel);
      for (const el of nodes) {
        if (isVisible(el) && isEditable(el)) return el;
      }
    }
    return null;
  };

  const findInputSemantic = (): HTMLElement | null => {
    const els = new Set<Element>([
      ...document.querySelectorAll('textarea'),
      ...document.querySelectorAll('input'),
      ...document.querySelectorAll('[contenteditable="true"]'),
      ...document.querySelectorAll('[contenteditable="plaintext-only"]'),
      ...document.querySelectorAll('[role="textbox"]'),
    ]);
    let best: HTMLElement | null = null;
    let bestScore = -1;
    els.forEach((el) => {
      if (!isEditable(el)) return;
      const s = scoreInput(el);
      if (s > bestScore) {
        best = el as HTMLElement;
        bestScore = s;
      }
    });
    return best;
  };

  // 等待输入框出现：优先选择器，其次语义评分；MutationObserver + rAF + 短轮询并行触发，
  // 不再按固定 500ms 慢轮询，避免「等待页面 complete」之外再叠加长等待。
  const waitForInput = (
    timeoutMs = 20000,
  ): Promise<HTMLElement | null> =>
    new Promise((resolve) => {
      let settled = false;

      const probe = (): HTMLElement | null =>
        findInputBySelectors() || findInputSemantic();

      let input = probe();
      if (input) {
        resolve(input);
        return;
      }

      const cleanup = () => {
        observer?.disconnect();
        clearInterval(timer);
        clearTimeout(bail);
        cancelAnimationFrame(raf);
      };
      const finish = (el: HTMLElement | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(el);
      };
      const tryAgain = () => {
        const el = probe();
        if (el) finish(el);
      };

      let observer: MutationObserver | null = null;
      try {
        observer = new MutationObserver(() => tryAgain());
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'contenteditable', 'role', 'placeholder'],
        });
      } catch {
        observer = null;
      }

      const timer = setInterval(tryAgain, 150);
      const bail = setTimeout(() => finish(null), timeoutMs);
      let raf = 0;
      const loop = () => {
        if (settled) return;
        if (!probe()) raf = requestAnimationFrame(loop);
        else finish(probe());
      };
      raf = requestAnimationFrame(loop);
    });

  const input = await waitForInput();
  if (!input) {
    console.error('❌ [multi-ai-ask] 未找到输入框');
    sendToBackground({
      type: 'AI_REPLY_DONE',
      aiName,
      taskId,
      aiId,
      text: '【AskAll】未能在页面中找到输入框，请在平台手动发送。',
    });
    return;
  }

  sendToBackground({ type: 'AI_SENDING', aiName, taskId, aiId });

  // 聚焦并设置值
  input.focus();
  await wait(150);

  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    // 受控组件：通过原生 setter + InputEvent 触发框架状态更新。
    const proto =
      input.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, text);
    else (input as HTMLInputElement).value = text;

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
    // contenteditable。千问/通义 是 Slate.js 编辑器，必须走事件管线。
    input.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

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

    if (!editorContainsText(input, text)) {
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

    if (!editorContainsText(input, text)) {
      try {
        document.execCommand('insertText', false, text);
      } catch {
        /* ignore */
      }
    }
  }

  await wait(150);

  // 判断按钮是否可用。
  const isBtnDisabled = (btn: HTMLElement): boolean =>
    (btn as HTMLButtonElement).disabled === true ||
    btn.hasAttribute('disabled') ||
    btn.getAttribute('aria-disabled') === 'true' ||
    btn.getAttribute('data-disabled') === 'true' ||
    btn.getAttribute('data-loading') === 'true' ||
    btn.classList.contains('disabled') ||
    btn.classList.contains('is-disabled');

  // 点击发送按钮：对任意标签派发完整 pointer + mouse + click 事件序列。
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

  let sent = false;

  const inputCleared = (): boolean => {
    if (!input || !input.isConnected) return true; // 元素被移除/重渲染 = 已发送
    const v =
      input.tagName === 'TEXTAREA' || input.tagName === 'INPUT'
        ? (input as HTMLInputElement).value
        : (input.textContent || '');
    return v.trim().length === 0;
  };

  const clickAndVerify = async (btn: HTMLElement, waitMs: number) => {
    clickBtn(btn);
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      await wait(150);
      if (inputCleared()) return true;
    }
    return false;
  };

  // ---------- 发送按钮识别：专属选择器优先，语义评分兜底 ----------
  const scoreSendButton = (btn: HTMLElement): number => {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    const text = (btn.textContent || '').trim().toLowerCase();
    const cls = (typeof btn.className === 'string' ? btn.className : '').toLowerCase();
    const id = (btn.id || '').toLowerCase();
    let s = 0;
    if (/发送|send/.test(label)) s += 100;
    if (/发送|send/.test(title)) s += 80;
    if (text.length > 0 && text.length <= 8 && /发送|send/.test(text)) s += 80;
    if (/send/.test(cls) || /send/.test(id)) s += 40;
    if (btn.tagName === 'BUTTON') s += 20;
    if (input) {
      const ir = input.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const dy = Math.abs(
        (br.top + br.bottom) / 2 - (ir.top + ir.bottom) / 2,
      );
      if (dy < 200) s += 30;
    }
    return s;
  };

  const findSendButtonSemantic = (): HTMLElement | null => {
    const candidates = document.querySelectorAll<HTMLElement>(
      'button, [role="button"]',
    );
    let best: HTMLElement | null = null;
    let bestScore = 0;
    for (const el of candidates) {
      if (isBtnDisabled(el)) continue;
      const s = scoreSendButton(el);
      // 阈值 80：避免误选「联网搜索」等工具栏按钮
      if (s >= 80 && s > bestScore) {
        best = el;
        bestScore = s;
      }
    }
    return best;
  };

  if (selectors.sendButton) {
    const candidates: string[] = selectors.sendButtonCandidates || [
      selectors.sendButton,
    ];
    const specific = candidates[0];

    // 阶段1：等专属按钮（最具体）可用后点击并验证
    for (let attempt = 0; attempt < 20 && !sent; attempt++) {
      const btn = specific
        ? document.querySelector<HTMLElement>(specific)
        : null;
      if (btn && !isBtnDisabled(btn)) {
        sent = await clickAndVerify(btn, 2500);
      }
      if (!sent) await wait(120);
    }

    // 阶段2：专属按钮点击后输入未被清空，再尝试一次
    if (!sent && specific) {
      const btn = document.querySelector<HTMLElement>(specific);
      if (btn && !isBtnDisabled(btn)) {
        sent = await clickAndVerify(btn, 2000);
      }
    }

    // 阶段3：遍历其余安全候选（均带 id/aria-label/class，不含宽泛 div[role="button"]）
    for (let c = 1; c < candidates.length && !sent; c++) {
      const sel = candidates[c];
      if (!sel) continue;
      const btn = document.querySelector<HTMLElement>(sel);
      if (btn && !isBtnDisabled(btn)) {
        sent = await clickAndVerify(btn, 2000);
      }
    }
  }

  // 阶段4：语义兜底 —— 平台更新导致选择器失效时的最后手段
  if (!sent) {
    const btn = findSendButtonSemantic();
    if (btn) {
      sent = await clickAndVerify(btn, 2000);
    }
  }

  // 兜底：模拟回车（textarea/input 平台）
  if (!sent && input) {
    input.focus();
    await wait(80);
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

  if (!sent) {
    sendToBackground({
      type: 'AI_REPLY_DONE',
      aiName,
      taskId,
      aiId,
      text: '【AskAll】未能自动发送，请在平台手动发送。',
    });
    return;
  }

  // 发送成功：启动「回答检测」：MutationObserver 实时提取 + 短轮询判定完成。
  // 不 await，让它随注入脚本在页面后台继续运行。
  startReplyWatch(selectors, aiName, taskId, aiId);

  /**
   * 回答检测（纯函数，注入脚本运行在页面上下文）。
   *
   * 用 MutationObserver 监听 body 变化：流式输出时 DOM 频繁变更，据此近乎实时地
   * 提取最新回复并回传 AI_REPLY（streaming）；同时用短轮询兜底，当文本稳定一段时间
   * 即判定回答完成，回传 AI_REPLY_DONE。120s 内未完成则静默退出。
   */
  function startReplyWatch(
    sels: AiSelectors,
    name: string,
    tid: string,
    aid: string,
  ) {
    const candidates =
      sels.replyCandidates || [
        '[class*="markdown"]',
        '[class*="answer"]',
        '[class*="response"]',
      ];

    const extract = (): string => {
      let replyEl: Element | null = null;
      for (const sel of candidates) {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length > 0) {
          replyEl = nodes[nodes.length - 1] ?? null;
          break;
        }
      }
      return replyEl ? (replyEl.textContent || '').trim() : '';
    };

    const TIMEOUT = 120_000;
    const STABLE_MS = 2500; // 文本稳定 2.5s 视为完成
    const startedAt = Date.now();
    let lastText = '';
    let stableSince = Date.now();

    const finish = () => {
      try {
        observer?.disconnect();
      } catch {
        /* ignore */
      }
      clearInterval(timer);
    };

    const check = () => {
      if (Date.now() - startedAt > TIMEOUT) {
        finish();
        return;
      }
      const text = extract();
      if (text.length > 0) {
        if (text !== lastText) {
          lastText = text;
          stableSince = Date.now();
          sendToBackground({
            type: 'AI_REPLY',
            aiName: name,
            taskId: tid,
            aiId: aid,
            text: text.slice(0, 4000),
          });
        } else if (Date.now() - stableSince > STABLE_MS) {
          console.log(`✅ [multi-ai-ask] ${name} 回答完成`);
          sendToBackground({
            type: 'AI_REPLY_DONE',
            aiName: name,
            taskId: tid,
            aiId: aid,
            text: text.slice(0, 4000),
          });
          finish();
        }
      } else {
        // 回复尚未开始（或思考中），重置基线
        lastText = '';
        stableSince = Date.now();
      }
    };

    let observer: MutationObserver | null = null;
    try {
      observer = new MutationObserver(() => check());
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    } catch {
      observer = null;
    }
    const timer = setInterval(check, 700);
  }
}