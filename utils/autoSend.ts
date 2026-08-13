import type { AiSelectors } from '@/utils/aiConfig';

/**
 * 注入到 AI 页面的自动填充并发送函数。
 *
 * 注意：该函数会被 `browser.scripting.executeScript` 注入到目标页面，
 * 运行在页面上下文中，因此必须写成「纯函数」——不能引用任何外部变量、
 * 模块、闭包，所有依赖都必须通过 args 传入。
 */
export async function autoFillAndSend(text: string, selectors: AiSelectors) {
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
}
