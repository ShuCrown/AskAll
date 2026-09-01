import type {
  AttachmentPayload,
  DomSnapshot,
  Recipe,
  RunMeta,
  StepId,
  StrategyParams,
} from './types';

/**
 * 页面侧自动化引擎。
 *
 * 与旧的 autoFillAndSend 一样，本函数会被 `browser.scripting.executeScript`
 * 注入到目标页面并在 MAIN world 运行，因此**必须完全自包含**：不能引用任何模块
 * 作用域的变量、导入的函数或闭包。所有策略实现都以嵌套函数形式写在函数体内。
 *
 * 之所以不把策略拆成独立模块，是因为 executeScript 序列化的是函数源码文本；
 * 函数体内引用的外部标识符不会随之一并被注入，运行时会直接 ReferenceError。
 *
 * 执行顺序由 Recipe.steps 决定，每步内的策略按数组顺序降级，首个成功者生效，
 * 并把「哪一步用了哪个策略」回传 background 供自愈记忆使用。
 */
export async function runAutomation(
  text: string,
  recipe: Recipe,
  meta: RunMeta,
  attachments: AttachmentPayload[] = [],
): Promise<void> {
  // 附件载荷：dataUrl → File 惰性解码；无附件时所有 attach 步骤直接跳过
  const files: AttachmentPayload[] = Array.isArray(attachments) ? attachments : [];
  // ---------- 基础工具 ----------
  // 后台标签页下浏览器会把 setTimeout/setInterval 节流到 1Hz 甚至 1/min、
  // 并完全暂停 requestAnimationFrame，导致两处停滞：
  //   1. 引擎自身的发送检测轮询（waitSent）、提交轮询、观察轮询被拖慢——
  //      点击发送后检测不到消息列表增长（豆包「自动发送失败」的根因）；
  //   2. 站点依赖 rAF 的流式渲染在后台不再更新 DOM——引擎观察不到回答增长
  //      （deepseek/千问「一直正在发送，切标签才出内容」的根因）。
  // 用 MessageChannel 自建时钟：MessageChannel 消息在后台标签页不被节流，
  // 引擎轮询因此保持满速。无法使用 MessageChannel 的环境降级回 setTimeout。
  const fastClock = (() => {
    const queue: Array<() => void> = [];
    let armed = false;
    const drain = () => {
      // 快照式消费：只处理本条消息到达时已入队的任务。任务在处理中把自己
      // 重新入队（sleep/interval/timeout 的自转 step）时，若用 while(queue.length)
      // 内联消费，会在同一次 drain 里同步自旋、永不交还事件循环，把页面主线程
      // 卡死（表现为 AI 页一直无法加载）。改为 splice 快照 + 处理后再 armed，
      // 新入队任务交给下一条消息（新的宏任务）执行，保证让出事件循环。
      const batch = queue.splice(0);
      armed = false;
      for (const fn of batch) {
        if (fn) {
          try {
            fn();
          } catch {
            /* 单个任务异常不影响其余任务 */
          }
        }
      }
    };
    try {
      const chan = new MessageChannel();
      chan.port1.onmessage = drain;
      return {
        post(fn: () => void): void {
          queue.push(fn);
          if (!armed) {
            armed = true;
            chan.port2.postMessage(0);
          }
        },
      };
    } catch {
      return {
        post(fn: () => void): void {
          setTimeout(fn, 0);
        },
      };
    }
  })();

  const sleep = (ms: number): Promise<void> =>
    new Promise((r) => {
      const start = Date.now();
      const step = () => {
        if (Date.now() - start >= ms) r();
        else fastClock.post(step);
      };
      fastClock.post(step);
    });

  /** 抗节流 setTimeout：返回 clear 函数 */
  const timeout = (fn: () => void, ms: number): (() => void) => {
    let cleared = false;
    const start = Date.now();
    const step = () => {
      if (cleared) return;
      if (Date.now() - start >= ms) fn();
      else fastClock.post(step);
    };
    fastClock.post(step);
    return () => {
      cleared = true;
    };
  };

  /** 抗节流 setInterval：返回 stop 函数 */
  const interval = (fn: () => void, ms: number): (() => void) => {
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      const start = Date.now();
      try {
        fn();
      } catch {
        /* ignore */
      }
      const step = () => {
        if (stopped) return;
        if (Date.now() - start >= ms) loop();
        else fastClock.post(step);
      };
      fastClock.post(step);
    };
    fastClock.post(loop);
    return () => {
      stopped = true;
    };
  };

  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  };

  const editable = (el: Element): boolean =>
    (el as HTMLElement).isContentEditable === true ||
    el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' &&
      !['button', 'submit', 'hidden', 'checkbox', 'radio', 'file'].includes(
        (el as HTMLInputElement).type,
      ));

  /** 快速可见性判定：只做几何检查，用于需要遍历大量元素的场景 */
  const boxy = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const textOf = (el: Element): string => (el.textContent || '').trim();

  // ---------- 后台标签页节流对抗 ----------
  // AI 标签页常在后台打开，站点会依据 document.hidden 暂停流式渲染，
  // 表现为面板停在「正在发送」。覆写可见性让页面认为自己一直可见。
  try {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  } catch {
    /* 不可覆写则维持原行为 */
  }

  // 后台标签页下 Chrome 会完全暂停 requestAnimationFrame，依赖 rAF 渲染的
  // 站点（流式/打字机文本）在后台不再更新 DOM，引擎观察不到回答增长。
  // 用抗节流时钟以 ~16ms 周期派发 rAF 回调，让这类渲染在后台继续推进。
  try {
    const rafQueue = new Map<number, FrameRequestCallback>();
    let rafId = 0;
    let stopRaf: (() => void) | null = null;
    const pumpRaf = () => {
      const now = performance.now();
      const entries = Array.from(rafQueue.entries());
      rafQueue.clear();
      for (const [, cb] of entries) {
        try {
          cb(now);
        } catch {
          /* ignore */
        }
      }
    };
    const w = window as unknown as {
      requestAnimationFrame: (cb: FrameRequestCallback) => number;
      cancelAnimationFrame: (id: number) => void;
    };
    w.requestAnimationFrame = (cb) => {
      rafQueue.set(++rafId, cb);
      if (!stopRaf) stopRaf = interval(pumpRaf, 16);
      return rafId;
    };
    w.cancelAnimationFrame = (id) => {
      rafQueue.delete(id);
      if (rafQueue.size === 0 && stopRaf) {
        stopRaf();
        stopRaf = null;
      }
    };
  } catch {
    /* 不可覆写则维持原行为 */
  }

  // ---------- 回传通道 ----------
  // MAIN world 没有 chrome.runtime，统一派发 CustomEvent，
  // 由同页面 ISOLATED world 的 content script 桥接转发到 background。
  const send = (msg: Record<string, unknown>): void => {
    try {
      window.dispatchEvent(
        new CustomEvent('askall:ai-reply', {
          detail: { ...msg, aiName: meta.aiName, aiId: meta.aiId, taskId: meta.taskId },
        }),
      );
    } catch {
      /* ignore */
    }
  };

  const report = (
    stepId: StepId,
    kind: string,
    ok: boolean,
    reason?: string,
    snapshot?: DomSnapshot,
  ): void => {
    send({
      type: 'ASKALL_STEP_RESULT',
      // 记忆键带版本（与 memory.ts 的 memoryKey 一致）：Recipe 升版后
      // 旧统计自动作废，避免曾经的假成功主导新策略链的排序
      recipeId: `${recipe.id}@v${recipe.version}`,
      stepId,
      kind,
      ok,
      reason,
      snapshot,
    });
  };

  // ---------- 运行时上下文 ----------
  const ctx: {
    input: HTMLElement | null;
    disabledBaseline: Map<Element, boolean> | null;
    blockBaseline: Map<Element, number> | null;
    pageTextBaseline: number;
    initialHref: string;
  } = {
    input: null,
    disabledBaseline: null,
    blockBaseline: null,
    // 占位值：locate 成功后会以 contentTextLen()（排除侧栏）重采
    pageTextBaseline: 0,
    initialHref: location.href,
  };

  const question = text;

  const currentValue = (): string => {
    const el = ctx.input;
    if (!el) return '';
    return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'
      ? (el as HTMLInputElement).value
      : el.textContent || '';
  };

  /** 去空白比较：部分站点会规范化输入（合并空格等），逐字比对会误判失败 */
  const norm = (s: string): string => s.replace(/\s+/g, '');

  /** 校验文本是否真正写进了编辑器模型（不只看 DOM） */
  const filled = (): boolean => {
    const probe = norm(question.trim()).slice(0, 40);
    if (!probe) return norm(currentValue()).length > 0;
    return norm(currentValue()).includes(probe);
  };

  // ---------- 元素采集 ----------
  const collectEditable = (): HTMLElement[] => {
    const seen = new Set<Element>();
    const sels = [
      'textarea',
      'input',
      '[contenteditable="true"]',
      '[contenteditable="plaintext-only"]',
      '[role="textbox"]',
    ];
    for (const s of sels) {
      let nodes: NodeListOf<Element>;
      try {
        nodes = document.querySelectorAll(s);
      } catch {
        continue;
      }
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n) seen.add(n);
      }
    }
    const out: HTMLElement[] = [];
    seen.forEach((el) => {
      if (editable(el) && visible(el)) out.push(el as HTMLElement);
    });
    return out;
  };

  /** 是否位于顶部导航/搜索区（这类可编辑元素通常是搜索框，不是聊天输入框） */
  const inHeaderArea = (el: Element): boolean => {
    let p: Element | null = el;
    for (let i = 0; i < 6 && p; i++) {
      const tag = p.tagName.toLowerCase();
      const role = (p.getAttribute('role') || '').toLowerCase();
      if (tag === 'header' || tag === 'nav') return true;
      if (role === 'banner' || role === 'search' || role === 'navigation') return true;
      p = p.parentElement;
    }
    return false;
  };

  /**
   * 是否位于侧栏/导航等「页面外框」区域（左侧会话历史栏是重灾区）。
   * 双重判定：
   *   1. 语义——祖先里有 aside / nav / header 或对应 ARIA role；
   *   2. 几何——整个元素落在视口左 1/3 内。聊天产品的左侧历史栏满足此条件，
   *      而回答区居中且远宽于此。侧栏历史列表懒加载会产生大量「新增文本块」，
   *      若不过滤，会被发送成功判定与回答观察双双误捕（表现为：没发出去，
   *      面板却把左侧栏历史会话标题当成回答显示出来）。
   */
  const inSideArea = (el: Element): boolean => {
    let p: Element | null = el;
    for (let i = 0; i < 8 && p; i++) {
      const tag = p.tagName.toLowerCase();
      if (tag === 'aside' || tag === 'nav' || tag === 'header') return true;
      const role = (p.getAttribute('role') || '').toLowerCase();
      if (role === 'navigation' || role === 'banner' || role === 'complementary') {
        return true;
      }
      p = p.parentElement;
    }
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right <= window.innerWidth * 0.33) return true;
    return false;
  };

  const qsSafe = (sel: string): HTMLElement | null => {
    try {
      return document.querySelector<HTMLElement>(sel);
    } catch {
      return null;
    }
  };

  const qsaSafe = (sel: string): HTMLElement[] => {
    try {
      return Array.from(document.querySelectorAll<HTMLElement>(sel));
    } catch {
      return [];
    }
  };

  const collectButtons = (): HTMLElement[] =>
    Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"]'),
    );

  const btnDisabled = (el: HTMLElement): boolean => {
    if (
      (el as HTMLButtonElement).disabled === true ||
      el.hasAttribute('disabled') ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.getAttribute('data-disabled') === 'true' ||
      el.getAttribute('data-loading') === 'true' ||
      el.classList.contains('disabled') ||
      el.classList.contains('is-disabled')
    ) {
      return true;
    }
    // 不少站点（如豆包新版）的按钮禁用纯靠样式表达，DOM 上没有任何禁用
    // 标志——pointer-events: none 是这类「视觉禁用」最常见的实现。
    try {
      if (getComputedStyle(el).pointerEvents === 'none') return true;
    } catch {
      /* ignore */
    }
    return false;
  };

  /** 采集按钮的禁用态快照，用于 submit:enabled-flip 的翻转比对 */
  const snapshotDisabled = (): Map<Element, boolean> => {
    const m = new Map<Element, boolean>();
    for (const b of collectButtons()) m.set(b, btnDisabled(b));
    return m;
  };

  const depthOf = (el: Element): number => {
    let d = 0;
    let p: Element | null = el;
    while (p && p !== document.body) {
      d++;
      p = p.parentElement;
    }
    return d;
  };

  // ---------- 定位策略 ----------
  /**
   * 视口内最靠下的可编辑元素。
   *
   * 这是抗改版的核心规则：聊天产品的输入框几乎总在页面底部，这是产品形态
   * 决定的，与类名、id、编辑器框架全都无关。豆包从 Semi textarea 换成
   * TipTap/ProseMirror 之后，这条规则依然成立。
   */
  const locateEditableBottom = async (): Promise<boolean> => {
    const els = collectEditable().filter((el) => !inHeaderArea(el));
    if (els.length === 0) return false;
    if (els.length === 1) {
      const only = els[0];
      if (!only) return false;
      ctx.input = only;
      return true;
    }
    let best: HTMLElement | null = null;
    let bestScore = -Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      let s = r.bottom * 0.5; // 越靠下越可能是聊天输入框
      if (r.width >= 200) s += 40;
      if (r.height >= 40) s += 20;
      if (r.bottom > window.innerHeight * 0.5) s += 30;
      if (r.top < window.innerHeight * 0.15) s -= 50;
      const ph = (el.getAttribute('placeholder') || '').toLowerCase();
      if (/提问|输入|发送|消息|问问|ask|message|type|send/.test(ph)) s += 30;
      if (/搜索|search/.test(ph)) s -= 80;
      if (textOf(el).length === 0) s += 25;
      if (document.activeElement === el) s += 20;
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }
    if (!best) return false;
    ctx.input = best;
    return true;
  };

  const locateSelector = async (p: StrategyParams): Promise<boolean> => {
    const sels = p.inputSelectors || [];
    for (const sel of sels) {
      for (const el of qsaSafe(sel)) {
        if (visible(el) && editable(el)) {
          ctx.input = el;
          return true;
        }
      }
    }
    return false;
  };

  const locateFocused = async (): Promise<boolean> => {
    const el = document.activeElement as HTMLElement | null;
    if (el && editable(el) && visible(el)) {
      ctx.input = el;
      return true;
    }
    return false;
  };

  // ---------- 填入策略 ----------
  const fillPaste = async (): Promise<boolean> => {
    const el = ctx.input;
    if (!el) return false;
    el.focus();
    await sleep(80);
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', question);
      el.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        }),
      );
    } catch {
      return false;
    }
    await sleep(250);
    return filled();
  };

  const fillInsertText = async (): Promise<boolean> => {
    const el = ctx.input;
    if (!el) return false;
    el.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      /* ignore */
    }
    el.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: question,
      }),
    );
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: question,
      }),
    );
    await sleep(150);
    if (filled()) return true;
    try {
      document.execCommand('insertText', false, question);
    } catch {
      /* ignore */
    }
    await sleep(150);
    return filled();
  };

  const fillValueSetter = async (): Promise<boolean> => {
    const el = ctx.input;
    if (!el) return false;
    if (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') return false;
    el.focus();
    const proto =
      el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, question);
    else (el as HTMLInputElement).value = question;
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: question,
      }),
    );
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
    return filled();
  };

  /** contenteditable 的最后手段：直接写 DOM 并派发 input，靠编辑器自身 observer 同步 */
  const fillDom = async (): Promise<boolean> => {
    const el = ctx.input;
    if (!el) return false;
    el.focus();
    el.textContent = question;
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      /* ignore */
    }
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: question,
      }),
    );
    await sleep(200);
    return filled();
  };

  /**
   * 按编辑器类型自动选路：
   * - contenteditable（ProseMirror / TipTap / Slate）优先 paste 事件——这是各编辑器
   *   框架无差别支持的输入通道，能绕开受控组件的状态同步问题；
   * - textarea / input 优先原生 value setter——paste 合成事件不会触发浏览器原生插入。
   */
  const fillAuto = async (): Promise<boolean> => {
    const el = ctx.input;
    if (!el) return false;
    if (el.isContentEditable || el.getAttribute('role') === 'textbox') {
      return (
        (await fillPaste()) ||
        (await fillInsertText()) ||
        (await fillDom())
      );
    }
    return (
      (await fillValueSetter()) ||
      (await fillInsertText()) ||
      (await fillPaste())
    );
  };

  // ---------- 附加文件策略 ----------
  // 仅当本次提问携带附件时执行。成功判定是启发式的：派发事件后轮询输入区
  // 邻域的「附件反馈信号」（预览图/文件 chip/文件名文本），出现增量才算成功；
  // 无反馈的站点判失败走中止+手动路径（宁可保守，不能把没附上文件的提问发出去）。

  /** 附件反馈信号选择器：预览图 / 文件 chip / 上传指示（大小写不敏感的类名匹配） */
  const ATTACH_INDICATOR_SEL = [
    'img',
    '[class*="preview" i]',
    '[class*="file" i]',
    '[class*="attach" i]',
    '[class*="upload" i]',
    '[class*="thumb" i]',
    '[class*="chip" i]',
  ].join(',');

  /** dataUrl → File 惰性解码（整批共用，只解一次） */
  let fileObjs: File[] | null = null;
  const getFiles = (): File[] => {
    if (fileObjs) return fileObjs;
    fileObjs = [];
    for (const a of files) {
      try {
        const comma = a.dataUrl.indexOf(',');
        const b64 = comma >= 0 ? a.dataUrl.slice(comma + 1) : a.dataUrl;
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        fileObjs.push(new File([bytes], a.name, { type: a.mime }));
      } catch {
        /* 单个坏载荷跳过，不影响其余 */
      }
    }
    return fileObjs;
  };

  const buildDt = (): DataTransfer | null => {
    try {
      const fs = getFiles();
      if (!fs.length) return null;
      const dt = new DataTransfer();
      for (const f of fs) dt.items.add(f);
      return dt;
    } catch {
      return null;
    }
  };

  /** 输入框邻域容器：从输入框向上爬至多 4 层，取第一个「足够大」的容器，兜底 body */
  const attachZone = (): HTMLElement => {
    let node: HTMLElement | null = ctx.input
      ? ctx.input.parentElement
      : document.body;
    for (let i = 0; i < 4 && node && node !== document.body; i++) {
      const r = node.getBoundingClientRect();
      if (r.height >= 160 && r.width >= 240) break;
      node = node.parentElement;
    }
    return node ?? document.body;
  };

  /** 附件反馈信号签名：可见预览节点数 + 容器文本中出现的文件名个数 */
  const attachIndicatorSig = (): string => {
    const zone = attachZone();
    let count = 0;
    zone.querySelectorAll(ATTACH_INDICATOR_SEL).forEach((n) => {
      if (visible(n)) count++;
    });
    const lower = (zone.textContent || '').toLowerCase();
    let nameHits = 0;
    for (const f of files) {
      if (f.name && lower.includes(f.name.toLowerCase())) nameHits++;
    }
    return `${count}|${nameHits}`;
  };

  /** 派发后轮询反馈信号，相对基线出现变化即成功 */
  const waitForAttachFeedback = (
    before: string,
    waitMs: number,
  ): Promise<boolean> =>
    new Promise((resolve) => {
      const deadline = Date.now() + waitMs;
      const timer = interval(() => {
        if (Date.now() > deadline || attachIndicatorSig() !== before) {
          timer();
          resolve(Date.now() <= deadline && attachIndicatorSig() !== before);
        }
      }, 300);
    });

  const attachPaste = async (p: StrategyParams): Promise<boolean> => {
    const el = ctx.input as HTMLElement | null;
    if (!el) return false;
    const dt = buildDt();
    if (!dt) return false;
    const before = attachIndicatorSig();
    el.focus();
    await sleep(60);
    try {
      el.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        }),
      );
    } catch {
      return false;
    }
    return waitForAttachFeedback(before, p.attachWaitMs ?? 8000);
  };

  const attachFileInput = async (p: StrategyParams): Promise<boolean> => {
    const fs = getFiles();
    if (!fs.length) return false;
    const candidates: HTMLInputElement[] = [];
    const push = (el: Element) => {
      const input = el as HTMLInputElement;
      if (input.type === 'file' && !candidates.includes(input)) {
        candidates.push(input);
      }
    };
    // 配置的上传入口选择器优先；再兜底扫全页（input[type=file] 常隐藏，不过滤可见性）
    for (const sel of p.attachSelectors || []) {
      for (const el of qsaSafe(sel)) push(el);
    }
    document.querySelectorAll('input[type="file"]').forEach(push);
    if (!candidates.length) return false;
    const before = attachIndicatorSig();
    for (const input of candidates) {
      try {
        const dt = new DataTransfer();
        for (const f of fs) dt.items.add(f);
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        // 有反馈即成功；无反馈继续试下一个候选 input
        if (await waitForAttachFeedback(before, Math.min(p.attachWaitMs ?? 8000, 6000))) {
          return true;
        }
      } catch {
        /* 下一个候选 */
      }
    }
    return false;
  };

  const attachDrop = async (p: StrategyParams): Promise<boolean> => {
    const el = (ctx.input as HTMLElement | null) ?? document.body;
    const dt = buildDt();
    if (!dt) return false;
    const before = attachIndicatorSig();
    try {
      const init: DragEventInit = {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
      };
      el.dispatchEvent(new DragEvent('dragenter', init));
      el.dispatchEvent(new DragEvent('dragover', init));
      el.dispatchEvent(new DragEvent('drop', init));
    } catch {
      return false;
    }
    return waitForAttachFeedback(before, p.attachWaitMs ?? 8000);
  };

  // ---------- 提交策略 ----------
  const clickBtn = (btn: HTMLElement): void => {
    const r = btn.getBoundingClientRect();
    const opts: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      detail: 1,
      clientX: r.x + r.width / 2,
      clientY: r.y + r.height / 2,
    };
    btn.dispatchEvent(new PointerEvent('pointerdown', opts));
    btn.dispatchEvent(new MouseEvent('mousedown', opts));
    btn.dispatchEvent(new PointerEvent('pointerup', opts));
    btn.dispatchEvent(new MouseEvent('mouseup', opts));
    btn.dispatchEvent(new MouseEvent('click', opts));
  };

  const inputCleared = (): boolean => {
    const el = ctx.input;
    // 节点被 React 重渲染替换（isConnected=false）≠ 已发送：那只是 DOM 换了新节点。
    // 真发送的信号交给「内容文本增长 / URL 跳转 / 新节点内容为空」判定，
    // 否则侧栏懒加载触发的整页重渲染会造成假成功。
    if (!el || !el.isConnected) return false;
    return currentValue().trim().length === 0;
  };

  /** 内容区（排除侧栏）文本增长：整页度量会把侧栏历史的懒加载误判为已发送 */
  const pageTextGrew = (): boolean =>
    contentTextLen() > ctx.pageTextBaseline + 20;

  /** 发送成功判定：输入框清空 / URL 跳转 / 页面文本增长，三者任一 */
  const sentNow = (): boolean =>
    inputCleared() || location.href !== ctx.initialHref || pageTextGrew();

  /** 等待页面文本连续两次采样不变——路由跳转/整页重渲染结束的信号 */
  const settle = async (maxMs: number): Promise<void> => {
    const start = Date.now();
    let last = -1;
    let stable = 0;
    while (Date.now() - start < maxMs) {
      await sleep(400);
      const len = (document.body.innerText || '').length;
      if (len === last) {
        stable += 1;
        if (stable >= 2) return;
      } else {
        stable = 0;
        last = len;
      }
    }
  };

  const waitSent = async (waitMs: number): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      await sleep(150);
      if (sentNow()) return true;
    }
    return false;
  };

  const dispatchKey = (
    key: string,
    mods: { ctrl?: boolean; meta?: boolean } = {},
  ): void => {
    const el = ctx.input;
    if (!el) return;
    const keyCode = key === 'Enter' ? 13 : 0;
    const init: KeyboardEventInit = {
      key,
      code: key === 'Enter' ? 'Enter' : key,
      bubbles: true,
      cancelable: true,
      ctrlKey: !!mods.ctrl,
      metaKey: !!mods.meta,
    };
    // KeyboardEventInit 不接受 keyCode/which（遗留属性，构造后恒为 0），
    // 部分站点仍按它们判定按键，逐个事件用 defineProperty 补上。
    const fire = (type: string) => {
      const ev = new KeyboardEvent(type, init);
      try {
        Object.defineProperty(ev, 'keyCode', { get: () => keyCode });
        Object.defineProperty(ev, 'which', { get: () => keyCode });
      } catch {
        /* ignore */
      }
      el.dispatchEvent(ev);
    };
    fire('keydown');
    fire('keypress');
    fire('keyup');
  };

  /**
   * 键盘提交，首选策略。不依赖任何按钮标识，只要输入框有焦点且站点
   * 监听 Enter（聊天产品必备）就能生效。部分站点默认 Enter 换行、
   * 组合键发送，因此依次尝试 Enter → Ctrl+Enter → Cmd/Ctrl+Enter。
   */
  const submitEnter = async (p: StrategyParams): Promise<boolean> => {
    const el = ctx.input;
    if (!el) return false;
    el.focus();
    await sleep(100);
    const primary = p.combo || 'Enter';
    const attempts: Array<'Enter' | 'Ctrl+Enter' | 'Meta+Enter'> =
      primary === 'Enter'
        ? ['Enter', 'Ctrl+Enter', 'Meta+Enter']
        : [primary];
    for (const combo of attempts) {
      if (combo === 'Ctrl+Enter') dispatchKey('Enter', { ctrl: true });
      else if (combo === 'Meta+Enter') dispatchKey('Enter', { meta: true });
      else dispatchKey('Enter');
      if (await waitSent(2600)) return true;
    }
    return false;
  };

  const submitSelector = async (p: StrategyParams): Promise<boolean> => {
    const sels = p.sendSelectors || [];
    if (sels.length === 0) return false;
    // 轮询等待而非一次性查询：后台标签页里 React 调度被节流，按钮常比
    // 输入框晚好几秒才渲染（豆包新版尤其明显——发送按钮在输入框有内容后
    // 才出现），一次性查询必然落空。
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      for (const sel of sels) {
        const btn = qsSafe(sel);
        if (btn && !btnDisabled(btn) && boxy(btn)) {
          clickBtn(btn);
          if (await waitSent(2600)) return true;
        }
      }
      await sleep(400);
    }
    return false;
  };

  /**
   * 邻域按钮：不按任何标识找发送按钮，而是按位置——发送按钮几乎总在
   * 输入框容器内、中心点位于输入框右侧、垂直距离不远。从输入框向上收集
   * 最多五层容器，取其中最近的三颗可点击元素依次试点。
   * 禁用态翻转（submit:enabled-flip）失手时的位置学兜底。
   */
  /**
   * 邻域按钮：不按任何标识找发送按钮，而是按位置——发送按钮几乎总在
   * 输入框容器内、中心点位于输入框右侧、垂直距离不远。从输入框向上收集
   * 最多五层容器，取其中最近的三颗可点击元素依次试点。
   * 禁用态翻转（submit:enabled-flip）失手时的位置学兜底。
   */
  const findProximate = (): HTMLElement[] => {
    const el = ctx.input;
    if (!el) return [];
    const ir = el.getBoundingClientRect();
    const seen = new Set<Element>();
    const candidates: Array<{ btn: HTMLElement; dist: number }> = [];
    let scope: Element | null = el.parentElement;
    for (let i = 0; i < 5 && scope; i++) {
      let nodes: NodeListOf<HTMLElement>;
      try {
        nodes = scope.querySelectorAll<HTMLElement>('button, [role="button"]');
      } catch {
        break;
      }
      for (let k = 0; k < nodes.length; k++) {
        const btn = nodes[k];
        if (!btn || seen.has(btn)) continue;
        seen.add(btn);
        if (btnDisabled(btn) || !boxy(btn)) continue;
        const br = btn.getBoundingClientRect();
        const dx = br.left + br.width / 2 - (ir.left + ir.width / 2);
        const dy = br.top + br.height / 2 - (ir.top + ir.height / 2);
        // 发送按钮在输入框右侧（左侧多为语音/附件等工具按钮），
        // 且不会比输入框本身更宽（排除把整个容器当按钮）
        if (dx < -20) continue;
        if (Math.abs(dy) > 160) continue;
        if (br.width > ir.width * 0.9) continue;
        // 文案/id/aria 里带「发送 / send」的最优先
        const label =
          (btn.textContent || '') +
          ' ' +
          (btn.getAttribute('aria-label') || '') +
          ' ' +
          (btn.id || '');
        const like = /发送|send/i.test(label);
        candidates.push({ btn, dist: like ? -1 : dx * dx + dy * dy });
      }
      scope = scope.parentElement;
    }
    candidates.sort((a, b) => a.dist - b.dist);
    return candidates.slice(0, 3).map((c) => c.btn);
  };

  const submitProximate = async (): Promise<boolean> => {
    // 轮询等待按钮渲染：后台标签页里它可能晚于输入框数秒才出现
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const targets = findProximate();
      for (const btn of targets) {
        clickBtn(btn);
        if (await waitSent(2600)) return true;
      }
      await sleep(400);
    }
    return false;
  };

  /**
   * 禁用态翻转：填入文本前发送按钮是 disabled，填入后变 enabled。
   * 这个状态翻转是发送按钮最强的物理指纹，与 id、类名、文案、图标全都无关，
   * 用来替代原先依赖 aria-label 匹配的语义评分。
   */
  const submitEnabledFlip = async (): Promise<boolean> => {
    const base = ctx.disabledBaseline;
    if (!base) return false;
    // 同样轮询等待：状态翻转需要一次 React 重渲染，后台标签页里会迟到
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const flipped: HTMLElement[] = [];
      for (const btn of collectButtons()) {
        if (btnDisabled(btn)) continue;
        if (base.get(btn) === true) flipped.push(btn);
      }
      if (flipped.length > 0) {
        // 多个翻转时取离输入框最近的那个
        const first = flipped[0];
        if (first) {
          let target: HTMLElement = first;
          if (flipped.length > 1 && ctx.input) {
            const ir = ctx.input.getBoundingClientRect();
            let bestDist = Infinity;
            for (const btn of flipped) {
              const br = btn.getBoundingClientRect();
              const dy = (br.top + br.bottom) / 2 - (ir.top + ir.bottom) / 2;
              const dx = (br.left + br.right) / 2 - (ir.left + ir.right) / 2;
              const dist = dx * dx + dy * dy;
              if (dist < bestDist) {
                bestDist = dist;
                target = btn;
              }
            }
          }
          clickBtn(target);
          if (await waitSent(2600)) return true;
        }
      }
      await sleep(400);
    }
    return false;
  };

  // ---------- 确认策略 ----------
  const confirmAny = async (): Promise<boolean> => waitSent(3000);

  // ---------- 外部唤醒钩子 ----------
  // 内嵌 webview（Tauri 桌面端）失焦/后台时，macOS WKWebView 会节流 JS 定时器
  // 与 React 调度，引擎的发送检测轮询与观察 setInterval 会停滞，表现为面板
  // 一直停在「正在发送」，切回聊天页（webview 重新获得焦点）才回传。
  // 两个互补机制：
  //   1. 注册到全局 __askallObservePing —— Rust 侧周期 eval 触发，强制补跑
  //      各观察策略的 check()（保活心跳，无需用户交互）；
  //   2. 页面 focus/pointerdown/pageshow/visibilitychange —— 用户切回聊天页、
  //      点击页面的瞬间立刻补跑一次，做到「一回来就看到内容」。
  const pingTargets = new Set<() => void>();
  const registerPing = (fn: () => void): void => {
    pingTargets.add(fn);
    try {
      (window as unknown as { __askallObservePing?: () => void }).__askallObservePing =
        () => {
          for (const f of pingTargets) f();
        };
    } catch {
      /* ignore */
    }
  };
  const unregisterPing = (fn: () => void): void => {
    pingTargets.delete(fn);
  };
  const addWakeListeners = (fn: () => void): (() => void) => {
    const on = (): void => fn();
    window.addEventListener('focus', on);
    window.addEventListener('pointerdown', on);
    window.addEventListener('pageshow', on);
    window.addEventListener('visibilitychange', on);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('pointerdown', on);
      window.removeEventListener('pageshow', on);
      window.removeEventListener('visibilitychange', on);
    };
  };

  // ---------- 观察策略 ----------
  const collectBlocks = (): Array<{ el: Element; len: number }> => {
    const out: Array<{ el: Element; len: number }> = [];
    let nodes: NodeListOf<Element>;
    try {
      nodes = document.querySelectorAll('div, section, article, pre, li, p');
    } catch {
      return out;
    }
    const cap = Math.min(nodes.length, 3000);
    for (let i = 0; i < cap; i++) {
      const el = nodes[i];
      if (!el || !boxy(el)) continue;
      if (ctx.input && (el === ctx.input || el.contains(ctx.input))) continue;
      // 排除侧栏/导航块：左侧历史栏懒加载会伪装成「回答增长」
      if (inSideArea(el)) continue;
      const len = (el.textContent || '').length;
      if (len > 0) out.push({ el, len });
    }
    return out;
  };

  /**
   * 内容区文本总长（已排除侧栏/导航块）。
   * 发送成功判定（pageTextGrew）与各处基线采集统一用这个度量：侧栏历史
   * 列表在后台标签页里常是懒加载/延迟渲染，若用整页 innerText，侧栏晚到
   * 的内容会让「未发送」被误判成「已发送」。
   */
  const contentTextLen = (): number => {
    let total = 0;
    for (const b of collectBlocks()) total += b.len;
    return total;
  };

  const snapshotBlocks = (): Map<Element, number> => {
    const m = new Map<Element, number>();
    for (const b of collectBlocks()) m.set(b.el, b.len);
    return m;
  };

  /**
   * DOM 增量快照：不猜回答区的类名，而是比对发送前后的全页文本块长度，
   * 取「新增且持续变长」的容器。增长量相近时取层级更浅的外层容器，
   * 因为它包含更完整的回答文本。
   */
  const observeDiff = async (p: StrategyParams): Promise<boolean> => {
    const base = ctx.blockBaseline;
    if (!base) return false;
    const stableMs = p.stableMs ?? 2500;
    const timeout = p.timeoutMs ?? 120_000;
    const startedAt = Date.now();
    // 已捕获过内容后，pick 连续找不到增长块达该时长即交棒给后续策略：
    // 元素跟踪失效/站点替换 DOM 时死等本策略超时会拖住整条观察链
    const stallGiveUpMs = 8000;
    let lastText = '';
    let stableSince = Date.now();
    let sawReply = false;
    let stalledSince: number | null = null;

    const q = question.trim();
    /** 回显排除：发送后最先出现的增长块往往就是刚发出去的问题本身 */
    const isEcho = (t: string, growth: number): boolean =>
      q.length >= 2 &&
      (t === q || (t.startsWith(q) && growth <= q.length + 10));

    const pick = (): Element | null => {
      const blocks = collectBlocks();
      // 分开统计「发送后新出现的块」与「既有块」的最大增长量：回答块在多数
      // 站点是全新 DOM 节点，而装着全部对话的外层容器是旧块，两者混用同一
      // 阈值会让浅层旧容器压过真正的回答块。
      let maxNew = 0;
      let maxOld = 0;
      for (const b of blocks) {
        const prev = base.get(b.el);
        const growth = prev === undefined ? b.len : b.len - prev;
        if (prev === undefined) {
          if (growth > maxNew) maxNew = growth;
        } else if (growth > maxOld) {
          maxOld = growth;
        }
      }
      if (maxNew < 5 && maxOld < 5) return null;

      const pickFrom = (
        onlyNew: boolean,
        maxGrowth: number,
      ): Element | null => {
        let best: Element | null = null;
        let bestDepth = Infinity;
        let bestGrowth = -1;
        for (const b of blocks) {
          const prev = base.get(b.el);
          if (onlyNew !== (prev === undefined)) continue;
          const growth = prev === undefined ? b.len : b.len - prev;
          if (growth < maxGrowth * 0.8) continue;
          if (onlyNew && isEcho(textOf(b.el), growth)) continue;
          const d = depthOf(b.el);
          if (d < bestDepth || (d === bestDepth && growth > bestGrowth)) {
            best = b.el;
            bestDepth = d;
            bestGrowth = growth;
          }
        }
        return best;
      };

      // 第一优先：新增块（回答块的常态），排除问题回显；
      // 回退：旧块增长（回答未单独成节点的站点）
      return pickFrom(true, maxNew) ?? pickFrom(false, maxOld);
    };

    return new Promise<boolean>((resolve) => {
      let detachWake: () => void = () => {};
      const finish = (ok: boolean) => {
        try {
          observer?.disconnect();
        } catch {
          /* ignore */
        }
        timer();
        unregisterPing(check);
        detachWake();
        resolve(ok);
      };

      const check = () => {
        if (Date.now() - startedAt > timeout) {
          // 终态由引擎在观察步骤全部策略失败后统一上报，避免策略接力时重复发
          finish(!!lastText);
          return;
        }
        const el = pick();
        if (!el) {
          // 已捕获过内容后连续找不到增长块（元素跟踪失效/站点替换 DOM）：
          // 死等本策略超时会拖住整条观察链，尽快交棒给 observe:selector/
          // observe:text 继续抓取完整回答。
          if (sawReply && stalledSince === null) stalledSince = Date.now();
          if (stalledSince !== null && Date.now() - stalledSince > stallGiveUpMs) {
            finish(false);
            return;
          }
          lastText = '';
          stableSince = Date.now();
          return;
        }
        stalledSince = null;
        const cur = textOf(el);
        if (cur.length === 0) return;
        if (cur !== lastText) {
          sawReply = true;
          lastText = cur;
          stableSince = Date.now();
          send({
            type: 'AI_REPLY',
            text: cur,
            url: location.href,
          });
        } else if (Date.now() - stableSince > stableMs) {
          send({
            type: 'AI_REPLY_DONE',
            text: cur,
            url: location.href,
          });
          finish(true);
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
      const timer = interval(check, 1000);
      registerPing(check);
      detachWake = addWakeListeners(check);
      check();
    });
  };

  /** 兜底：沿用配置里的回答区选择器 */
  const observeSelector = async (p: StrategyParams): Promise<boolean> => {
    const sels = (p.replySelectors || []).length
      ? (p.replySelectors as string[])
      : ['[class*="markdown"]', '[class*="answer"]', '[class*="response"]'];
    const stableMs = p.stableMs ?? 2500;
    const timeout = p.timeoutMs ?? 120_000;
    const startedAt = Date.now();

    const extract = (): string => {
      for (const sel of sels) {
        // 排除侧栏命中：左侧历史栏的条目也可能带 markdown 类名
        const nodes = qsaSafe(sel).filter((n) => !inSideArea(n));
        const last = nodes[nodes.length - 1];
        if (last) return textOf(last);
      }
      return '';
    };

    // 基线：发送前回答区已有的内容（复用标签页时是上一轮的回答）。
    // 只有相对基线出现「新内容」才上报——否则复用窗口里没发送成功时，
    // 旧会话的最后一条回答会被直接当成本轮结果流出。
    const base = extract();
    let lastText = base;
    let sawNew = false;
    let stableSince = Date.now();

    return new Promise<boolean>((resolve) => {
      let detachWake: () => void = () => {};
      const finish = (ok: boolean) => {
        try {
          observer?.disconnect();
        } catch {
          /* ignore */
        }
        timer();
        unregisterPing(check);
        detachWake();
        resolve(ok);
      };

      const check = () => {
        if (Date.now() - startedAt > timeout) {
          // 没等到新内容：判定失败，交由后续策略 / 引擎统一上报终态
          finish(sawNew);
          return;
        }
        const cur = extract();
        if (cur.length === 0) {
          lastText = '';
          stableSince = Date.now();
          return;
        }
        if (cur !== lastText) {
          lastText = cur;
          stableSince = Date.now();
          if (cur !== base) {
            sawNew = true;
            send({ type: 'AI_REPLY', text: cur, url: location.href });
          }
        } else if (sawNew && Date.now() - stableSince > stableMs) {
          send({
            type: 'AI_REPLY_DONE',
            text: cur,
            url: location.href,
          });
          finish(true);
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
      const timer = interval(check, 1000);
      registerPing(check);
      detachWake = addWakeListeners(check);
      check();
    });
  };

  /** 终极端兜底：观察整页可见文本的增长 */
  const observeText = async (p: StrategyParams): Promise<boolean> => {
    const stableMs = p.stableMs ?? 3000;
    const timeout = p.timeoutMs ?? 120_000;
    const startedAt = Date.now();
    let lastText = '';
    let stableSince = Date.now();
    return new Promise<boolean>((resolve) => {
      let detachWake: () => void = () => {};
      const check = () => {
        if (Date.now() - startedAt > timeout) {
          timer();
          unregisterPing(check);
          detachWake();
          // 终态由引擎在观察步骤全部策略失败后统一上报，避免策略接力时重复发
          resolve(!!lastText);
          return;
        }
        // 增长判定用排除侧栏的内容度量：侧栏懒加载不该触发本兜底；
        // 文本仍取整页可见文本（走到这一步时往往已无更精确的抓取手段）
        const len = contentTextLen();
        const cur = (document.body.innerText || '').trim();
        if (len > ctx.pageTextBaseline + 20 && cur !== lastText) {
          lastText = cur;
          stableSince = Date.now();
          send({ type: 'AI_REPLY', text: cur, url: location.href });
        } else if (lastText && Date.now() - stableSince > stableMs) {
          timer();
          unregisterPing(check);
          detachWake();
          send({
            type: 'AI_REPLY_DONE',
            text: lastText,
            url: location.href,
          });
          resolve(true);
        }
      };
      const timer = interval(check, 1200);
      registerPing(check);
      detachWake = addWakeListeners(check);
      check();
    });
  };

  // ---------- 策略注册表 ----------
  type StrategyFn = (p: StrategyParams) => Promise<boolean>;
  const registry: Record<string, StrategyFn> = {
    'locate:editable-bottom': locateEditableBottom,
    'locate:selector': locateSelector,
    'locate:focused': locateFocused,
    'fill:auto': fillAuto,
    'fill:paste': fillPaste,
    'fill:insert-text': fillInsertText,
    'fill:value-setter': fillValueSetter,
    'attach:paste': attachPaste,
    'attach:file-input': attachFileInput,
    'attach:drop': attachDrop,
    'submit:enter': submitEnter,
    'submit:enabled-flip': submitEnabledFlip,
    'submit:proximate': submitProximate,
    'submit:selector': submitSelector,
    'confirm:any': confirmAny,
    'observe:diff': observeDiff,
    'observe:selector': observeSelector,
    'observe:text': observeText,
  };

  // ---------- 失败快照 ----------
  const snapshotDom = (): DomSnapshot => {
    const rect = (el: Element): [number, number, number, number] => {
      const r = el.getBoundingClientRect();
      return [
        Math.round(r.x),
        Math.round(r.y),
        Math.round(r.width),
        Math.round(r.height),
      ];
    };
    const editables = collectEditable().slice(0, 8).map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      cls: typeof el.className === 'string' ? el.className.slice(0, 80) : undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      role: el.getAttribute('role') || undefined,
      rect: rect(el),
    }));
    const buttons = collectButtons()
      .filter((b) => boxy(b))
      .slice(0, 12)
      .map((b) => ({
        tag: b.tagName.toLowerCase(),
        id: b.id || undefined,
        cls: typeof b.className === 'string' ? b.className.slice(0, 80) : undefined,
        ariaLabel: b.getAttribute('aria-label') || undefined,
        disabled: btnDisabled(b),
        rect: rect(b),
      }));
    return { href: location.href, editables, buttons };
  };

  /** 把失败瞬间的页面结构压缩成一句话，附在面板文案里供用户回报 */
  const snapshotBrief = (s: DomSnapshot): string => {
    const ir = ctx.input ? ctx.input.getBoundingClientRect() : null;
    let near = 0;
    if (ir) {
      near = s.buttons.filter((b) => {
        const w = b.rect[2];
        const h = b.rect[3];
        if (w <= 0 || h <= 0) return false;
        const dx = b.rect[0] + w / 2 - (ir.left + ir.width / 2);
        const dy = b.rect[1] + h / 2 - (ir.top + ir.height / 2);
        return dx > -20 && Math.abs(dy) <= 160;
      }).length;
    }
    return `（页面探测：可编辑元素 ${s.editables.length} 个，可见按钮 ${s.buttons.length} 颗，输入框邻域 ${near} 颗）`;
  };

  // ---------- 超时包装 ----------
  const withTimeout = (
    fn: Promise<boolean>,
    ms: number,
  ): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      let done = false;
      const clear = timeout(() => {
        if (done) return;
        done = true;
        resolve(false);
      }, ms);
      fn.then((v) => {
        if (done) return;
        done = true;
        clear();
        resolve(v);
      }).catch(() => {
        if (done) return;
        done = true;
        clear();
        resolve(false);
      });
    });

  // ---------- 流程编排 ----------
  send({ type: 'AI_SENDING' });

  for (const step of recipe.steps) {
    // 无附件时整步跳过 attach：不上报、不跑链，保证存量流程与自愈记忆零变化
    if (step.id === 'attach' && files.length === 0) continue;
    const stepTimeout = step.timeoutMs ?? 15_000;
    const stepStart = Date.now();
    let ok = false;
    let usedKind = '';

    // 完整跑一遍策略链，首个成功者生效。
    // 上报移到步骤级：locate 的整链轮询会产生大量中间失败，
    // 逐策略上报会污染自愈记忆的成败统计。
    const runChain = async (perTryTimeout: number): Promise<boolean> => {
      for (const sd of step.strategies) {
        const fn = registry[sd.kind];
        if (!fn) continue;
        let params = (sd.params || {}) as StrategyParams;
        // 观察步骤把步骤总预算分摊给各策略：否则单个兜底策略吃满 120s 后，
        // 后续策略再各跑一轮，整体要拖到六分钟才给终态。
        if (step.id === 'observe') {
          const remain = Math.max(
            5000,
            (sd.timeoutMs ?? stepTimeout) - (Date.now() - stepStart),
          );
          params = {
            ...params,
            timeoutMs: Math.min(params.timeoutMs ?? remain, remain),
          };
        }
        try {
          if (
            await withTimeout(fn(params), Math.min(perTryTimeout, sd.timeoutMs ?? perTryTimeout))
          ) {
            usedKind = sd.kind;
            return true;
          }
        } catch (e) {
          /* 进入下一个策略 */
        }
        usedKind = sd.kind;
      }
      return false;
    };

    ok = await runChain(stepTimeout);
    // 定位步骤整链轮询：后台标签页里站点的编辑器组件可能延迟挂载
    // （无可见性伪装的站点、慢网络），反复重扫直到步骤超时。
    while (!ok && step.id === 'locate' && Date.now() - stepStart < stepTimeout) {
      await sleep(500);
      ok = await runChain(Math.min(3000, stepTimeout));
    }
    report(step.id, usedKind, ok, ok ? undefined : '策略未生效');

    // 定位成功后立即采集两个基线：按钮禁用态（供 enabled-flip）与页面文本块（供 diff）
    if (ok && step.id === 'locate') {
      ctx.disabledBaseline = snapshotDisabled();
      ctx.blockBaseline = snapshotBlocks();
      ctx.pageTextBaseline = contentTextLen();
    }

    // 填入成功后必须重采内容文本基线：contenteditable 填入的问题文本会直接
    // 计入内容区文本，若沿用定位时的基线，提交判定会把「刚填入问题」
    // 误判成「已发送」——回车还没派发就认定成功，实际什么都没发出去。
    // textarea 的 value 不计入文本长度，这正是 DeepSeek 正常而豆包/千问
    // 全部假成功的分歧点。
    if (ok && step.id === 'fill') {
      ctx.pageTextBaseline = contentTextLen();
    }

    // 附加成功后同样要重采基线：附件预览缩略图 / 文件 chip 既新增 DOM 块、
    // 又计入内容文本，若沿用 fill 时的基线，提交判定会把「刚附加的预览」
    // 误判成「已发送」。
    if (ok && step.id === 'attach') {
      ctx.blockBaseline = snapshotBlocks();
      ctx.pageTextBaseline = contentTextLen();
    }

    // 提交成功后、观察开始前：多数站点发送后会跳转到会话页，SPA 整页重渲染
    // 会让定位时采集的观察基线全部失效（旧元素已不在 DOM，所有块都成了
    // 「新增块」，历史对话会淹没真正的回答）。等渲染稳定后重采基线，
    // 观察阶段的增量就只剩回答的流式增长。
    if (ok && step.id === 'submit') {
      await settle(4000);
      ctx.blockBaseline = snapshotBlocks();
      ctx.pageTextBaseline = contentTextLen();
    }

    if (!ok) {
      if (step.id === 'observe') {
        send({
          type: 'AI_REPLY_DONE',
          text: `【AskAll · ${recipe.name}】已提交但未能抓取到回答，若平台已回答请点「查看原文」。`,
          url: location.href,
        });
      } else if (step.optional) {
        continue;
      } else {
        // 文案必须带上「卡在哪步 + 试过哪些策略」：面板是排查站点适配
        // 问题唯一的信息出口，笼统的「失败」会让用户无从反馈。
        const stepName =
          step.id === 'locate'
            ? '定位输入框'
            : step.id === 'fill'
              ? '写入问题'
              : step.id === 'attach'
                ? '附加文件'
                : '自动发送';
        const tried = step.strategies.map((s) => s.kind).join('、');
        const snap = snapshotDom();
        const reason = `【AskAll · ${recipe.name}】${stepName}失败（已试：${tried}），请在平台手动发送${snapshotBrief(snap)}`;
        report(step.id, usedKind, false, reason, snap);
        send({
          type: 'AI_REPLY_DONE',
          text: reason,
          url: location.href,
        });
        return;
      }
    }
  }
}
