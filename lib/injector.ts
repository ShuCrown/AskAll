// Self-contained injector function used with chrome.scripting.executeScript.
//
// IMPORTANT: `autoSendInjector` is serialized via Function.toString() and
// evaluated in the target tab's isolated world. It MUST NOT reference any
// outer-scope variables, imports, or module-level bindings — only its args
// and browser globals (document, location, setTimeout, chrome, navigator).

export interface InjectorArgs {
  question: string;
  inputSelector: string;
  sendSelector: string;
  captureSnippet: boolean;
  captureTimeoutMs: number;
}

export interface InjectorResult {
  status: 'done' | 'error';
  responseUrl?: string;
  responseSnippet?: string;
  error?: string;
}

export async function autoSendInjector(args: InjectorArgs): Promise<InjectorResult> {
  const { question, inputSelector, sendSelector, captureSnippet, captureTimeoutMs } = args;

  const waitFor = (
    selector: string,
    timeout: number,
  ): Promise<HTMLElement | null> =>
    new Promise((resolve) => {
      const existing = document.querySelector<HTMLElement>(selector);
      if (existing) return resolve(existing);
      const start = Date.now();
      const obs = new MutationObserver(() => {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        } else if (Date.now() - start > timeout) {
          obs.disconnect();
          resolve(null);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      // Also poll as a fallback in case MutationObserver misses something.
      const tick = () => {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        } else if (Date.now() - start > timeout) {
          obs.disconnect();
          resolve(null);
        } else {
          setTimeout(tick, 150);
        }
      };
      tick();
    });

  const fillInput = (el: HTMLElement, text: string) => {
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto =
        el.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text);
      else (el as HTMLInputElement).value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable (ProseMirror / Lexical / generic)
      el.focus();
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel?.removeAllRanges();
        sel?.addRange(range);
        // eslint-disable-next-line deprecation/deprecation
        const ok = document.execCommand('insertText', false, text);
        if (!ok || (el.textContent || '').length === 0) {
          el.textContent = text;
          el.dispatchEvent(
            new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }),
          );
        }
      } catch {
        el.textContent = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  };

  const input = await waitFor(inputSelector, 30000);
  if (!input) {
    return { status: 'error', error: 'input element not found', responseUrl: location.href };
  }
  fillInput(input, question);

  // Give the framework a tick to enable its send button.
  await new Promise((r) => setTimeout(r, 450));

  const send = await waitFor(sendSelector, 5000);
  if (!send) {
    return { status: 'error', error: 'send button not found', responseUrl: location.href };
  }
  (send as HTMLElement).click();

  const responseUrl = location.href;

  if (!captureSnippet) {
    await new Promise((r) => setTimeout(r, 1200));
    return { status: 'done', responseUrl };
  }

  // Best-effort answer capture: snapshot existing message containers, then
  // poll for new large text blocks that appear after we clicked send.
  const snapshot = new Set<string>();
  document
    .querySelectorAll(
      '[class*="message"], [data-testid*="message"], [class*="markdown"], main article',
    )
    .forEach((el) => snapshot.add(el.outerHTML));

  const start = Date.now();
  while (Date.now() - start < captureTimeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const candidates = document.querySelectorAll<HTMLElement>(
      '[class*="message"]:last-of-type, [data-testid*="message"]:last-of-type, [class*="markdown"]:last-of-type, main article:last-of-type',
    );
    for (const el of Array.from(candidates)) {
      if (snapshot.has(el.outerHTML)) continue;
      const text = (el.textContent || '').trim();
      if (text.length >= 80) {
        return {
          status: 'done',
          responseUrl: location.href,
          responseSnippet: text.slice(0, 500),
        };
      }
    }
  }
  return { status: 'done', responseUrl: location.href };
}

/** Tiny injector for clipboard mode: copies the question so the user can paste. */
export async function clipboardInjector(args: { question: string }): Promise<{ ok: boolean }> {
  try {
    await navigator.clipboard.writeText(args.question);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
