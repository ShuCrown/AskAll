import {
  DEFAULT_AI_CONFIGS,
  mergeConfigs,
  runAutomation,
  resolveRecipe,
  loadMemory,
  applyMemory,
  recordStepResult,
  addHistory,
  getHistory,
  updateHistoryUrl,
  mergeAnswer,
  genId,
  type AiConfig,
  type AskTask,
  type AiResult,
  type StepReport,
  type AutomationMemory,
  type AttachmentPayload,
} from '@askall/shared';
import { initExtensionPlatform } from '../src/platform';

const AI_CONFIGS_KEY = 'local:aiConfigs';
const MENU_ID = 'ask-multi-ai';

// 附件上限（与 UI 侧 utils/attachment.ts 保持一致；background 是信任边界，需再校验）
const PER_FILE_MAX = 5 * 1024 * 1024;
const TOTAL_MAX = 10 * 1024 * 1024;
const MAX_FILES = 5;

/**
 * 清洗 UI 传来的附件载荷：逐项校验结构、单文件/总量/个数上限，
 * 超限的丢弃（不整批拒绝，尽量保留能用的部分）。
 */
function sanitizeAttachments(raw: unknown): AttachmentPayload[] {
  if (!Array.isArray(raw)) return [];
  const out: AttachmentPayload[] = [];
  let total = 0;
  for (const item of raw) {
    if (out.length >= MAX_FILES) break;
    const a = item as Record<string, unknown>;
    if (typeof a?.name !== 'string' || typeof a?.dataUrl !== 'string') continue;
    const size = typeof a?.size === 'number' ? a.size : a.dataUrl.length;
    if (size > PER_FILE_MAX || total + size > TOTAL_MAX) continue;
    total += size;
    out.push({
      name: a.name,
      mime: typeof a?.mime === 'string' ? a.mime : 'application/octet-stream',
      size,
      dataUrl: a.dataUrl,
    });
  }
  return out;
}

/** 附件元数据（去掉文件本体，用于任务与历史存储） */
function attachmentMeta(attachments: AttachmentPayload[]) {
  return attachments.map(({ name, mime, size }) => ({ name, mime, size }));
}

/**
 * 手动同步探针：注入到 AI 标签页（MAIN world）读取当前回答并回传。
 * 自包含：不能引用模块作用域标识符。回答文本经 askall:ai-reply 事件由
 * content 桥转发回 background（与引擎同通道）。文本稳定 1.2s 或 15s 兜底后
 * 回传 AI_REPLY_DONE，让面板从「回复中」收敛到最终状态。
 */
function probeReply(
  selectors: string[],
  meta: { aiName: string; aiId: string; taskId: string },
  stripMarkers: string[] = [],
): void {
  const sels = selectors.length
    ? selectors
    : ['[class*="markdown"]', '[class*="answer"]', '[class*="response"]'];
  /** 按章节标题剥离思考过程/参考资料等非正文段（与引擎 stripSections 一致）。
   *  保守：只剥「空行闭合」或「非开头标题延伸到结尾」的章节，不吞正文。 */
  const stripSections = (text: string): string => {
    if (!stripMarkers.length || !text) return text;
    const lines = text.split('\n');
    const isMarker = (l: string): boolean => {
      const t = l.trim();
      return stripMarkers.some((m) => t.startsWith(m));
    };
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i]!;
      if (isMarker(line)) {
        let j = i + 1;
        while (
          j < lines.length &&
          lines[j]!.trim() !== '' &&
          !isMarker(lines[j]!)
        ) {
          j++;
        }
        if (lines[j]!.trim() === '') {
          i = j + 1;
          continue;
        }
        if (j >= lines.length && i > 0) {
          i = lines.length;
          continue;
        }
        i++;
        continue;
      }
      out.push(line);
      i++;
    }
    return out.join('\n').trim();
  };
  const send = (m: Record<string, unknown>) => {
    try {
      const out = { ...m };
      if (
        typeof out.text === 'string' &&
        (out.type === 'AI_REPLY' || out.type === 'AI_REPLY_DONE')
      ) {
        out.text = stripSections(out.text);
      }
      window.dispatchEvent(
        new CustomEvent('askall:ai-reply', {
          detail: {
            ...out,
            aiName: meta.aiName,
            aiId: meta.aiId,
            taskId: meta.taskId,
          },
        }),
      );
    } catch {
      /* ignore */
    }
  };
  const extract = (): string => {
    // 块级边界补 \n（与引擎 textOf 一致）：textContent 会把逐段渲染的回答拼成一行
    const BLOCK_TAGS =
      'P,DIV,SECTION,ARTICLE,PRE,UL,OL,LI,BLOCKQUOTE,H1,H2,H3,H4,H5,H6,TABLE,TR,FIGURE'.split(
        ',',
      );
    const textOf = (el: Element): string => {
      let out = '';
      const nl = (): void => {
        if (out.length > 0 && !out.endsWith('\n')) out += '\n';
      };
      const walk = (node: Node): void => {
        if (node.nodeType === 3) {
          const t = node.textContent ?? '';
          if (t) out += t;
          return;
        }
        if (node.nodeType !== 1) return;
        const n = node as Element;
        const tag = n.tagName;
        if (tag === 'BR') {
          nl();
          return;
        }
        // 跳过按钮/导航等 UI，避免回答混入按钮文案与侧栏文本（header 不跳）
        if (tag === 'BUTTON' || n.getAttribute('role') === 'button') return;
        if (tag === 'ASIDE' || tag === 'NAV') return;
        if (BLOCK_TAGS.includes(tag)) nl();
        const kids = n.childNodes;
        for (const k of kids) walk(k);
        if (BLOCK_TAGS.includes(tag)) nl();
      };
      walk(el);
      return out.trim();
    };
    for (const sel of sels) {
      try {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length) {
          const t = textOf(nodes[nodes.length - 1]!);
          if (t) return t;
        }
      } catch {
        /* ignore */
      }
    }
    return '';
  };
  const text = extract();
  if (!text) return; // 没有可读回答，不干预
  send({ type: 'AI_REPLY', text, url: location.href });
  let lastText = text;
  let lastChange = Date.now();
  const startedAt = Date.now();
  let done = false;
  const finish = (t: string) => {
    if (done) return;
    done = true;
    send({ type: 'AI_REPLY_DONE', text: t, url: location.href });
  };
  const check = () => {
    const cur = extract();
    if (cur && cur !== lastText) {
      lastText = cur;
      lastChange = Date.now();
      send({ type: 'AI_REPLY', text: cur, url: location.href });
    }
    if (Date.now() - lastChange > 1200) {
      finish(cur || lastText);
      return;
    }
    if (Date.now() - startedAt > 15000) {
      finish(cur || lastText);
      return;
    }
    // 后台标签页 timer 会被节流到 1Hz，但总会执行；探测是一次性操作，延迟可接受
    setTimeout(check, 800);
  };
  setTimeout(check, 800);
}

export default defineBackground(() => {
  // 注入扩展平台实现：history.ts 等共享工具通过 getPlatform().storage 访问
  initExtensionPlatform();
  // 初始化默认配置（仅在安装/更新时）
  browser.runtime.onInstalled.addListener(async () => {
    const existing = await storage.getItem(AI_CONFIGS_KEY);
    if (!existing) {
      await storage.setItem(AI_CONFIGS_KEY, DEFAULT_AI_CONFIGS);
    }
  });

  // 右键菜单：每次后台启动重建（removeAll + create 幂等，老用户升级后 contexts 即时生效）。
  // contexts 为全部场景：有划词时预填问题，无划词时打开空白新话题面板（与应用一致）。
  browser.contextMenus.removeAll().finally(() => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: 'AskAll 齐问：发起问答',
      contexts: ['all'],
    });
  });

  /**
   * 在当前标签页打开右侧浮动面板（右键菜单与工具栏图标共用的同一操作）：
   * 向 content script 发 SHOW_PANEL（划词文本预填，无划词为空白新话题）；
   * 未注入时动态注入并重试。返回是否成功，由调用方决定兜底行为。
   */
  async function openPanelInActiveTab(text: string): Promise<boolean> {
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tabId = tabs[0]?.id;
    if (tabId == null) return false;

    const showPanel = () =>
      browser.tabs.sendMessage(tabId, { type: 'SHOW_PANEL', text });

    // 动态注入后，内容脚本监听器注册与注入 Promise 之间可能有微小竞态：多重试几轮
    const showPanelRetry = async () => {
      for (let i = 0; i < 4; i++) {
        try {
          await showPanel();
          return true;
        } catch {
          await sleep(150);
        }
      }
      return false;
    };

    try {
      await showPanel();
      return true;
    } catch (e) {
      console.warn('[multi-ai-ask] 内容脚本未就绪，尝试动态注入:', e);
      try {
        await browser.scripting.executeScript({
          target: { tabId },
          files: ['/content-scripts/content.js'],
        });
        if (await showPanelRetry()) return true;
        console.warn('[multi-ai-ask] 注入后仍无法打开面板');
      } catch (err) {
        console.warn('[multi-ai-ask] 无法注入内容脚本:', err);
      }
      return false;
    }
  }

  // 右键菜单点击：在当前标签页上方弹出浮动面板，由用户在面板中确认发送——
  // 绝不自动直发。失败终态（受限页面等）：只发系统通知提示。
  browser.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId !== MENU_ID) return;
    if (await openPanelInActiveTab(info.selectionText ?? '')) return;
    // 失败终态：通知用户，而不是把问答直接发出去
    notifyPanelUnavailable();
  });

  // 点击工具栏图标：与右键菜单完全同一个操作——在当前页面打开右侧浮动面板
  // （不再弹独立 popup）。受限页面（chrome:// 等）无法注入时，兜底打开独立
  // 工作台窗口（/workspace.html，原 popup 页）。
  browser.action.onClicked.addListener(async () => {
    if (await openPanelInActiveTab('')) return;
    try {
      await browser.windows.create({
        url: getExtURL('/workspace.html'),
        type: 'popup',
        width: 800,
        height: 600,
      });
    } catch (e) {
      console.warn('[multi-ai-ask] 打开工作台窗口失败:', e);
      notifyPanelUnavailable();
    }
  });

  /** 扩展资源完整 URL（绕开 WXT 模板字面量类型限制） */
  function getExtURL(path: string): string {
    return (browser.runtime.getURL as (p: string) => string)(path);
  }

  /** 面板无法弹出时的系统通知（替代旧的「直接发送」回退） */
  async function notifyPanelUnavailable() {
    try {
      await browser.notifications.create({
        type: 'basic',
        iconUrl: getExtURL('icon/128.png'),
        title: 'AskAll 齐问',
        message:
          '当前页面无法打开问答面板（受限页面或脚本未就绪），请在普通网页中重试。',
      });
    } catch (e) {
      console.warn('[multi-ai-ask] 通知失败:', e);
    }
  }

  // 任务级结果缓存：taskId -> AskTask。以「任务 × AI」为维度，避免多轮互相覆盖。
  const tasks = new Map<string, AskTask>();
  let currentTaskId: string | undefined;
  // 会话标识：多轮追问共享同一 conversationId（用于历史分组 + 复用已打开 Tab）
  let currentConversationId: string | undefined;

  /** 更新当前任务中某个 AI 的结果 */
  function updateResult(
    taskId: string | undefined,
    aiId: string | undefined,
    patch: Partial<AiResult>,
  ) {
    if (!taskId) return;
    const task = tasks.get(taskId);
    if (!task || !aiId) return;
    const cur = task.results[aiId];
    if (!cur) return;
    task.results[aiId] = { ...cur, ...patch };
  }

  /**
   * 回复进度广播：问答面板运行在发起页的 content script 中，而
   * runtime.sendMessage 只会送达扩展页面（popup/options），不会送达
   * content script。因此后台收到 AI 标签页转发的进度后，必须逐 tab
   * 用 tabs.sendMessage 再转发一次，面板的 onReply 才能收到并实时更新。
   * （未注入内容脚本或无监听的 tab 会 reject，忽略即可。）
   */
  function broadcastReply(msg: Record<string, unknown>) {
    void browser.tabs
      .query({})
      .then((tabs) => {
        for (const t of tabs) {
          if (t.id == null) continue;
          browser.tabs.sendMessage(t.id, msg).catch(() => {});
        }
      })
      .catch(() => {});
  }

  // 监听内容脚本消息（划词浮动面板 + 回答完成 + 打开设置）
  // 注意：WXT 的 browser 在 Chrome 下是原生 chrome API，监听器「返回值」不会作为
  // 响应送达（Firefox 的 Promise 返回也不接受普通对象），必须走 sendResponse 同步回传。
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ASK_AI' && msg.text) {
      handleAsk(msg.text, msg.aiIds, sanitizeAttachments(msg.attachments));
      return;
    }
    if (msg?.type === 'ASK_AI_FOLLOWUP' && msg.text) {
      handleFollowUp(
        msg.text,
        msg.aiIds,
        sanitizeAttachments(msg.attachments),
        // 前端携带的当前会话 id：优先复用，避免 SW 重启后追问被当成新话题
        typeof msg.conversationId === 'string' ? msg.conversationId : undefined,
      );
      return;
    }
    // 发送中/流式/完成：由 autoSend 经 content script 桥接转发而来。
    // 携带 url（真实会话页 chat/xxx）时同步写入任务结果，供跳转对应会话。
    // 三类消息均原样广播回各 tab 的 content script（问答面板实时更新的唯一来源）。
    if (msg?.type === 'AI_SENDING' && msg.aiId) {
      updateResult(msg.taskId, msg.aiId, { status: 'sending' });
      broadcastReply({
        type: 'AI_SENDING',
        taskId: msg.taskId,
        aiId: msg.aiId,
        aiName: msg.aiName,
      });
      return;
    }
    if (msg?.type === 'AI_REPLY' && msg.aiName && msg.aiId) {
      updateResult(msg.taskId, msg.aiId, {
        status: 'streaming',
        answer: msg.text ?? '',
        ...(typeof msg.url === 'string' && msg.url ? { url: msg.url } : {}),
      });
      broadcastReply({
        type: 'AI_REPLY',
        taskId: msg.taskId,
        aiId: msg.aiId,
        aiName: msg.aiName,
        text: msg.text ?? '',
        ...(typeof msg.url === 'string' && msg.url ? { url: msg.url } : {}),
      });
      return;
    }
    if (msg?.type === 'AI_REPLY_DONE' && msg.aiName && msg.aiId) {
      updateResult(msg.taskId, msg.aiId, {
        status: 'done',
        answer: msg.text ?? '',
        ...(typeof msg.url === 'string' && msg.url ? { url: msg.url } : {}),
      });
      broadcastReply({
        type: 'AI_REPLY_DONE',
        taskId: msg.taskId,
        aiId: msg.aiId,
        aiName: msg.aiName,
        text: msg.text ?? '',
        ...(typeof msg.url === 'string' && msg.url ? { url: msg.url } : {}),
      });
      // 回答快照落盘：写入对应历史条目，供工作台回放（兜底文案会被标记为 error）
      const task = msg.taskId ? tasks.get(msg.taskId) : undefined;
      if (task?.historyId) {
        void mergeAnswer(task.historyId, msg.aiId, msg.aiName, msg.text ?? '');
      }
      notifyReplyDone(msg.aiName);
      return;
    }
    // 自愈记忆：页面引擎回传每步「用了哪个策略、是否成功」。
    // 据此把真正生效的策略提到链首，站点改版后不必每次都从失效的选择器开始试错。
    if (msg?.type === 'ASKALL_STEP_RESULT' && msg.recipeId) {
      const report: StepReport = {
        recipeId: msg.recipeId,
        stepId: msg.stepId,
        kind: msg.kind,
        ok: msg.ok === true,
        reason: typeof msg.reason === 'string' ? msg.reason : undefined,
        snapshot: msg.snapshot as StepReport['snapshot'],
      };
      void recordStepResult(report);
      if (!report.ok) {
        console.warn(
          `[multi-ai-ask] ${report.recipeId} · ${report.stepId} 策略 ${report.kind} 未生效:`,
          report.reason ?? '',
        );
      }
      return;
    }
    if (msg?.type === 'GET_TASK') {
      const task = currentTaskId ? tasks.get(currentTaskId) : undefined;
      sendResponse({ task: task ?? null });
      return;
    }
    // 兼容旧版轮询：返回当前任务各 AI 的回复（按 aiName）
    if (msg?.type === 'GET_REPLIES') {
      const task = currentTaskId ? tasks.get(currentTaskId) : undefined;
      const replies: Record<string, string> = {};
      if (task) {
        for (const r of Object.values(task.results)) {
          replies[r.aiName] = r.answer;
        }
      }
      sendResponse({ replies });
      return;
    }
    if (msg?.type === 'OPEN_SETTINGS') {
      openSettingsPage();
      return;
    }
    // 查看原文：优先切换到该 AI 已打开的聊天标签页，找不到才新开
    if (msg?.type === 'OPEN_AI_TAB' && msg.url) {
      openAiTab(msg.url);
      return;
    }
    // 手动同步：向该 AI 已打开的标签页注入探针，回传最新回答状态
    if (msg?.type === 'SYNC_AI' && msg.aiId) {
      void syncAiTab(
        String(msg.aiId),
        String(msg.aiName ?? ''),
        String(msg.taskId ?? ''),
      );
      return;
    }
    // 重试发送：复用该 AI 标签页重新注入引擎（同一任务，卡片原地更新）。
    // question 由前端传入（后台内存 tasks 在 SW 重启后会丢失，不能依赖）
    if (
      msg?.type === 'RETRY_AI' &&
      msg.aiId &&
      msg.taskId &&
      typeof msg.question === 'string'
    ) {
      void retryAiTab(
        String(msg.aiId),
        String(msg.aiName ?? ''),
        String(msg.taskId),
        msg.question,
      );
      return;
    }
  });

  async function openSettingsPage() {
    try {
      await browser.runtime.openOptionsPage();
    } catch (e) {
      console.warn('[multi-ai-ask] 打开设置页失败:', e);
    }
  }

  const NOTIFY_KEY = 'local:notifyOnDone';

  /** 回答完成提醒：检查全局开关后弹系统通知 */
  async function notifyReplyDone(aiName: string) {
    try {
      const enabled = await storage.getItem(NOTIFY_KEY);
      if (enabled === false) return; // 全局开关关闭
      await browser.notifications.create({
        type: 'basic',
        iconUrl: (browser.runtime.getURL as (path: string) => string)(
          'icon/128.png',
        ),
        title: 'AskAll 齐问',
        message: `${aiName} 已完成回答`,
      });
    } catch (e) {
      console.warn('[multi-ai-ask] 通知失败:', e);
    }
  }

  /**
   * 会话 URL 跟踪：记录「AI 标签页 → 历史条目」的映射，
   * 自动发送成功后页面会跳转到真实会话地址，监听到同域 URL 变化且稳定后回写。
   */
  interface TabTrack {
    historyId: string;
    aiId: string;
    aiName: string;
    initialUrl: string;
    lastUrl?: string;
    captured?: boolean;
    timer?: ReturnType<typeof setTimeout>;
  }
  const tabTrack = new Map<number, TabTrack>();

  function trackTab(
    tabId: number,
    historyId: string,
    aiId: string,
    aiName: string,
    initialUrl: string,
  ) {
    tabTrack.set(tabId, {
      historyId,
      aiId,
      aiName,
      initialUrl,
    });
  }

  function sameOrigin(a: string, b: string): boolean {
    try {
      return new URL(a).origin === new URL(b).origin;
    } catch {
      return false;
    }
  }

  async function getTabUrl(tabId: number): Promise<string | undefined> {
    try {
      return (await browser.tabs.get(tabId)).url;
    } catch {
      return undefined; // 标签页已关闭
    }
  }

  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const track = tabTrack.get(tabId);
    if (!track || track.captured || !changeInfo.url) return;
    const url = changeInfo.url;
    // 仅跟踪同域跳转（进入会话页），排除初始首页本身
    if (url === track.initialUrl || !sameOrigin(url, track.initialUrl)) return;

    track.lastUrl = url;
    if (track.timer) clearTimeout(track.timer);
    // 防抖：等 URL 稳定 3 秒再写，避免记录中间跳转地址
    track.timer = setTimeout(async () => {
      const current = await getTabUrl(tabId);
      if (track.lastUrl && current === track.lastUrl) {
        track.captured = true;
        await updateHistoryUrl(track.historyId, track.aiId, track.aiName, track.lastUrl);
      }
    }, 3000);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    const track = tabTrack.get(tabId);
    if (track?.timer) clearTimeout(track.timer);
    tabTrack.delete(tabId);
  });

  async function loadContext() {
    const aiConfigs = mergeConfigs(
      (await storage.getItem(AI_CONFIGS_KEY)) as AiConfig[] | null,
    );
    // 打开方式设置已移除：扩展端固定用浏览器标签页展示各 AI 聊天
    return { aiConfigs };
  }

  /** 一次性提问：新建一个任务（新会话），并行打开各 AI 标签页并发送 */
  async function handleAsk(
    text: string,
    aiIds?: string[],
    attachments: AttachmentPayload[] = [],
  ) {
    const { aiConfigs } = await loadContext();
    const enabledList = aiConfigs.filter((ai) => {
      if (!ai.enabled || !ai.url) return false;
      if (Array.isArray(aiIds) && aiIds.length > 0) {
        return aiIds.includes(ai.id);
      }
      return true;
    });
    if (enabledList.length === 0) return;

    const question = text.trim();
    if (!question) return;

    // 自愈记忆一次性读取，供各 AI 的 Recipe 重排策略顺序
    const memory = await loadMemory();

    // 新建任务 + 新会话
    const taskId = genId();
    const conversationId = genId();
    currentConversationId = conversationId;
    const task: AskTask = {
      id: taskId,
      question,
      createdAt: Date.now(),
      conversationId,
      ...(attachments.length ? { attachments: attachmentMeta(attachments) } : {}),
      results: {},
    };
    enabledList.forEach((ai) => {
      task.results[ai.id] = {
        aiId: ai.id,
        aiName: ai.name,
        status: 'opening',
        answer: '',
      };
    });
    tasks.set(taskId, task);
    currentTaskId = taskId;

    // 记录历史（含实际打开的 URL）
    const aiUrls = enabledList.map((ai) => ({
      id: ai.id,
      name: ai.name,
      url: buildUrl(ai, question),
    }));
    const historyItem = await addHistory(
      question,
      enabledList.map((ai) => ai.name),
      aiUrls,
      conversationId,
      attachments.length ? attachmentMeta(attachments) : undefined,
    );
    // 回填历史条目 id：AI_REPLY_DONE 时据此把回答快照写入正确的历史记录
    task.historyId = historyItem.id;

    for (const ai of enabledList) {
      // 需要自动发送的平台：优先复用已打开的「原有」聊天窗口。
      // 不再要求 ai.selectors —— 没有专属配置的站点走通用 Recipe 照样能跑。
      if (ai.autoSend) {
        const existing = await findExistingChatTab(ai);
        if (existing) {
          trackTab(existing.tabId, historyItem.id, ai.id, ai.name, buildUrl(ai, question));
          injectAutomation(existing.tabId, question, ai, taskId, memory, attachments);
          continue;
        }
      }

      // 否则新建标签页（扩展端固定用浏览器标签页展示，后台打开不抢占焦点）
      const url = buildUrl(ai, question);
      const open = (tabId: number) => {
        trackTab(tabId, historyItem.id, ai.id, ai.name, url);
        if (ai.autoSend) {
          injectAutomation(tabId, question, ai, taskId, memory, attachments);
        } else if (attachments.length) {
          // 通过 URL 打开的站点无法自动附加文件：沿用兜底提示通道，
          // 在面板/历史中给出 error 卡片，引导用户去标签页手动上传。
          const notice = `【AskAll · ${ai.name}】该站点通过链接打开问题，无法自动附加文件；请打开其标签页手动上传附件并发送。`;
          updateResult(taskId, ai.id, { status: 'error', answer: notice });
          broadcastReply({
            type: 'AI_REPLY_DONE',
            taskId,
            aiId: ai.id,
            aiName: ai.name,
            text: notice,
          });
        }
      };
      browser.tabs
        .create({ url, active: false })
        .then((tab) => {
          if (tab.id != null) open(tab.id);
        });
    }
  }

  /**
   * 追问：延续当前会话（复用 conversationId 与已打开的聊天窗口），
   * 生成新任务（新 taskId）以区分不同轮次的结果，避免互相覆盖。
   * 优先使用前端传来的会话 id（不依赖内存 currentConversationId，
   * 避免 service worker 休眠重启后追问被当成新话题）。
   */
  async function handleFollowUp(
    text: string,
    aiIds?: string[],
    attachments: AttachmentPayload[] = [],
    conversationId?: string,
  ) {
    const { aiConfigs } = await loadContext();
    const question = text.trim();
    if (!question) return;

    const targets = aiConfigs.filter((ai) => {
      if (!ai.enabled || !ai.url) return false;
      if (Array.isArray(aiIds) && aiIds.length > 0) {
        return aiIds.includes(ai.id);
      }
      return true;
    });
    if (targets.length === 0) return;

    // 自愈记忆一次性读取，供各 AI 的 Recipe 重排策略顺序
    const memory = await loadMemory();

    // 延续会话：前端传入的会话 id 优先；否则回退内存记录；再无则新会话
    const convId = conversationId ?? currentConversationId ?? genId();
    currentConversationId = convId;

    const taskId = genId();
    const task: AskTask = {
      id: taskId,
      question,
      createdAt: Date.now(),
      conversationId: convId,
      ...(attachments.length ? { attachments: attachmentMeta(attachments) } : {}),
      results: {},
    };
    targets.forEach((ai) => {
      task.results[ai.id] = {
        aiId: ai.id,
        aiName: ai.name,
        status: 'opening',
        answer: '',
      };
    });
    tasks.set(taskId, task);
    currentTaskId = taskId;

    // 追问同样写入历史，并共享同一 conversationId（用于历史分组）
    const aiUrls = targets.map((ai) => ({
      id: ai.id,
      name: ai.name,
      url: buildUrl(ai, question),
    }));
    const historyItem = await addHistory(
      question,
      targets.map((ai) => ai.name),
      aiUrls,
      convId,
      attachments.length ? attachmentMeta(attachments) : undefined,
    );
    // 回填历史条目 id：AI_REPLY_DONE 时据此把回答快照写入正确的历史记录
    task.historyId = historyItem.id;

    // 优先复用已打开的「原有」聊天窗口；续旧会话分两类：
    //  - 有真实会话 URL（deepseek/千问等每会话独立 URL）：导航到旧会话续聊；
    //  - 无会话 URL（豆包/文心/元宝等 SPA 平台）：复用当前标签页且【不重载】，
    //    保留内存里的会话上下文直接追加，避免重开新话题。
    const reused = new Set<string>();
    for (const ai of targets) {
      if (!ai.autoSend || reused.has(ai.id)) continue;
      const convUrl = await findConversationUrl(convId, ai.id, ai.name);
      if (convUrl) {
        const existing = await findExistingChatTab(ai, convUrl);
        if (existing) {
          reused.add(ai.id);
          trackTab(existing.tabId, historyItem.id, ai.id, ai.name, convUrl);
          injectAutomation(existing.tabId, question, ai, taskId, memory, attachments);
        }
      } else {
        const live = await findLiveChatTab(ai);
        if (live) {
          reused.add(ai.id);
          trackTab(live.tabId, historyItem.id, ai.id, ai.name, buildUrl(ai, question));
          injectAutomation(live.tabId, question, ai, taskId, memory, attachments);
        }
      }
    }

    // 没有可复用窗口的平台：在同一任务内直接新开标签页。不能回退 handleAsk——
    // 它会新建只含这部分 AI 的任务并覆盖 currentTaskId、追加第二条历史记录，
    // 把同一轮拆成两半（追问轮部分 AI 卡片丢失的根因）。
    const missed = targets.filter((ai) => !reused.has(ai.id));
    for (const ai of missed) {
      const convUrl =
        (await findConversationUrl(convId, ai.id, ai.name)) ??
        buildUrl(ai, question);
      void browser.tabs
        .create({ url: convUrl, active: false })
        .then((tab) => {
          if (tab.id == null) return;
          trackTab(tab.id, historyItem.id, ai.id, ai.name, convUrl);
          if (ai.autoSend) {
            injectAutomation(tab.id, question, ai, taskId, memory, attachments);
          } else if (attachments.length) {
            // 通过 URL 打开的站点无法自动附加文件：沿用兜底提示通道
            const notice = `【AskAll · ${ai.name}】该站点通过链接打开问题，无法自动附加文件；请打开其标签页手动上传附件并发送。`;
            updateResult(taskId, ai.id, { status: 'error', answer: notice });
            broadcastReply({
              type: 'AI_REPLY_DONE',
              taskId,
              aiId: ai.id,
              aiName: ai.name,
              text: notice,
            });
          }
        });
    }
  }

  function buildUrl(ai: AiConfig, text: string): string {
    if (ai.url.includes('{query}')) {
      return ai.url.replace(/\{query\}/g, encodeURIComponent(text));
    }
    return ai.url;
  }

  /** 是否真实会话路径（/chat/、/s/、/c/、/conversation/）。
   *  只有这类 URL 打开后会加载「该对话」；base 与 {query} 形态是新建会话，不能用。 */
  function isConversationPath(url: string): boolean {
    try {
      const path = new URL(url).pathname;
      return /\/chat\/|\/s\/|\/c\/|\/conversation\//.test(path);
    } catch {
      return false;
    }
  }

  /** 从历史里取某 AI 最近一轮的真实会话 URL（按 conversationId 定位会话）。
   *  仅返回会话路径形态；base/{query} 与缺失一律返回 undefined，由调用方回退。 */
  async function findConversationUrl(
    conversationId: string,
    aiId: string,
    aiName: string,
  ): Promise<string | undefined> {
    if (!conversationId) return undefined;
    try {
      const history = await getHistory();
      // 历史最新在前：按会话 id 过滤，取最近一条里该 AI 的链接/快照 URL
      for (const h of history) {
        if ((h.conversationId || h.id) !== conversationId) continue;
        const link = (h.aiUrls ?? []).find(
          (l) => (aiId && l.id === aiId) || (!aiId && l.name === aiName),
        );
        const snap = (h.answers ?? []).find(
          (s) => (aiId && s.aiId === aiId) || (!aiId && s.name === aiName),
        );
        const url = link?.url ?? snap?.url;
        if (url && isConversationPath(url)) return url;
      }
    } catch {
      /* 历史读取失败按无记录处理 */
    }
    return undefined;
  }

  /**
   * 查找某个 AI 已打开的聊天标签页（跨后台会话也能命中）。
   *
   * 复用前强制刷新一次：旧标签页可能是在可见性伪装（visible-fake）生效前
   * 打开的——content script 只对新导航注入，旧页面里站点仍处于懒渲染状态
   * （组件不挂载/发送按钮不渲染）；也可能残留上一次发送未清掉的草稿。
   * 重载后伪装脚本注入、页面回到干净的可自动化状态。
   * `targetUrl` 提供时（追问续旧会话）改为导航到该会话 URL，而非重载回 base。
   */
  async function findExistingChatTab(
    ai: AiConfig,
    targetUrl?: string,
  ): Promise<{ tabId: number } | undefined> {
    try {
      const origin = getOrigin(ai.url);
      if (!origin) return undefined;
      const tabs = await browser.tabs.query({ url: `${origin}/*` });
      const ready = tabs.find((t) => t.id != null && t.status === 'complete');
      const target = ready ?? tabs[0];
      if (target?.id == null) return undefined;
      const tabId = target.id;
      try {
        if (targetUrl && isConversationPath(targetUrl)) {
          await browser.tabs.update(tabId, { url: targetUrl });
        } else {
          await browser.tabs.reload(tabId);
        }
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          const t = await browser.tabs.get(tabId);
          if (t.status === 'complete') break;
          await sleep(250);
        }
      } catch {
        /* 标签页已关闭等，忽略 */
      }
      return { tabId };
    } catch {
      return undefined;
    }
  }

  /** 复用已打开的标签页但【不重载】：SPA 平台（豆包/文心/元宝等无独立会话 URL）追问时
   *  直接注入到当前页面，保留其内存里的会话上下文，实现同会话追加而非重开新话题。 */
  async function findLiveChatTab(
    ai: AiConfig,
  ): Promise<{ tabId: number } | undefined> {
    try {
      const origin = getOrigin(ai.url);
      if (!origin) return undefined;
      const tabs = await browser.tabs.query({ url: `${origin}/*` });
      const target =
        tabs.find((t) => t.id != null && t.status === 'complete') ?? tabs[0];
      if (target?.id == null) return undefined;
      return { tabId: target.id };
    } catch {
      return undefined;
    }
  }

  function getOrigin(url: string): string | null {
    try {
      return new URL(url.replace(/\{query\}/g, '')).origin;
    } catch {
      return null;
    }
  }

  /**
   * 查看原文：优先切换到该 AI 已打开的聊天标签页（按 origin 匹配），
   * 找不到才新建标签页。
   */
  async function openAiTab(url: string) {
    try {
      const origin = getOrigin(url);
      if (origin) {
        const tabs = await browser.tabs.query({ url: `${origin}/*` });
        const ready = tabs.find((t) => t.id != null && t.status === 'complete');
        const target = ready || tabs[0];
        if (target?.id != null) {
          await browser.tabs.update(target.id, { active: true });
          await browser.windows.update(target.windowId, { focused: true });
          return;
        }
      }
      // 没有已打开的标签页，新建一个
      await browser.tabs.create({ url, active: true });
    } catch (e) {
      console.warn('[multi-ai-ask] 打开 AI 标签页失败:', e);
    }
  }

  /**
   * 手动同步：向该 AI 已打开的标签页注入一次性探针（不重载、只读），
   * 重新读取当前回答并回传 AI_REPLY / AI_REPLY_DONE，兜底引擎自动同步失效、
   * 面板卡「回复中」的场景。
   */
  async function syncAiTab(aiId: string, aiName: string, taskId: string) {
    try {
      const { aiConfigs } = await loadContext();
      const ai = aiConfigs.find((c) => c.id === aiId);
      if (!ai?.url) return;
      const origin = getOrigin(ai.url);
      if (!origin) return;
      // 只查询已打开的标签页，不重载（保持用户在页面的会话状态）
      const tabs = await browser.tabs.query({ url: `${origin}/*` });
      const target =
        tabs.find((t) => t.id != null && t.status === 'complete') ?? tabs[0];
      if (target?.id == null) return;

      // 复用该 AI 的 Recipe 回答区选择器，找不到时探针用通用兜底
      const recipe = resolveRecipe(
        ai.id,
        ai.name,
        ai.url,
        ai.selectors?.attachSelectors ?? [],
      );
      const observeStep = recipe.steps.find((s) => s.id === 'observe');
      const selectors = (observeStep?.strategies ?? [])
        .flatMap((s) => (s.params?.replySelectors as string[] | undefined) ?? [])
        .filter(Boolean);

      // 先补桥再注入：旧标签页可能没有 content 桥转发探针回传事件
      void ensureReplyBridge(target.id);
      await browser.scripting.executeScript({
        target: { tabId: target.id },
        world: 'MAIN',
        func: probeReply,
        args: [
          selectors,
          { aiName, aiId, taskId },
          recipe.stripSections ?? [],
        ],
      });
    } catch (e) {
      console.warn(`[multi-ai-ask] 手动同步 ${aiName} 失败:`, e);
    }
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * 重试某 AI 的自动发送：复用该 AI 已打开的标签页（不重载），用同一 taskId
   * 重新注入引擎跑一遍填充/发送。卡片原地更新、不产生新任务/新历史。
   * - 优先复用 tabTrack 里本任务已用的标签页（带会话状态），否则按 origin 找已打开的；
   * - 找不到才新开标签页；
   * - question 由前端传入，SW 重启后后台 tasks 为空也能重试；
   * - 附件不重附（dataUrl 仅在后台内存/SW 生命周期内存在）。
   */
  async function retryAiTab(
    aiId: string,
    aiName: string,
    taskId: string,
    question: string,
  ) {
    try {
      const { aiConfigs } = await loadContext();
      const ai = aiConfigs.find((c) => c.id === aiId);
      if (!ai?.url || !ai.autoSend) return;

      // 重置为该 AI 发送中：广播 AI_SENDING 让面板卡片回到 sending
      updateResult(taskId, aiId, {
        status: 'sending',
        answer: '',
        error: undefined,
      });
      broadcastReply({ type: 'AI_SENDING', taskId, aiId, aiName });

      const task = taskId ? tasks.get(taskId) : undefined;
      const memory = await loadMemory();

      // 优先复用 tabTrack 里本任务已用的标签页（保留会话状态）
      let tabId: number | undefined;
      for (const [tid, t] of tabTrack) {
        if (t.aiId === aiId) {
          tabId = tid;
          break;
        }
      }
      // 否则按 origin 找已打开的标签页（不重载，保持用户在页面的会话状态）
      if (tabId == null) {
        const origin = getOrigin(ai.url);
        if (origin) {
          const tabs = await browser.tabs.query({ url: `${origin}/*` });
          const target =
            tabs.find((t) => t.id != null && t.status === 'complete') ?? tabs[0];
          tabId = target?.id;
        }
      }

      if (tabId == null) {
        // 没有可复用的标签页：新开一个并注入
        const url = buildUrl(ai, question);
        const tab = await browser.tabs.create({ url, active: false });
        if (tab.id != null) {
          trackTab(tab.id, task?.historyId ?? '', ai.id, ai.name, url);
          injectAutomation(tab.id, question, ai, taskId, memory, []);
        }
        return;
      }
      injectAutomation(tabId, question, ai, taskId, memory, []);
    } catch (e) {
      console.warn(`[multi-ai-ask] 重试 ${aiName} 失败:`, e);
    }
  }


  /**
   * 补注入 MAIN↔ISOLATED 回复桥。
   *
   * 复用的 AI 标签页可能是「扩展安装/刷新前就已打开」的旧页面——浏览器不会
   * 向旧页面注入 content script，autoSend 在 MAIN world 派发的 askall:ai-reply
   * 事件就没人转发到后台，面板会一直停在「正在打开页面…」。
   * 这里对该 tab 手动注入一份 ISOLATED 桥：脚本幂等（检测 content.tsx 设置的
   * 全局标记，已存在则跳过），注入失败（受限页面）忽略。
   */
  async function ensureReplyBridge(tabId: number) {
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: () => {
          const w = globalThis as Record<string, unknown>;
          if (w.__askallReplyBridge) return;
          w.__askallReplyBridge = true;
          window.addEventListener(
            'askall:ai-reply',
            ((e: CustomEvent<Record<string, unknown>>) => {
              const msg = e.detail;
              if (!msg || typeof msg.type !== 'string') return;
              try {
                // 序列化注入的函数必须自包含：不能引用模块作用域的 browser，
                // ISOLATED world 里用页面全局的 chrome.runtime 回传后台
                const runtime = (
                  globalThis as unknown as {
                    chrome?: {
                      runtime?: { sendMessage?: (m: unknown) => unknown };
                    };
                  }
                ).chrome?.runtime;
                if (!runtime?.sendMessage) return;
                const p = runtime.sendMessage(msg);
                if (p && typeof (p as Promise<void>).catch === 'function') {
                  (p as Promise<void>).catch(() => {});
                }
              } catch {
                /* 无扩展上下文，忽略 */
              }
            }) as EventListener,
          );
        },
      });
    } catch {
      /* 受限页面等，忽略 */
    }
  }

  /**
   * 注入自动化引擎。不再阻塞等待 tab.status === complete——
   * 页面只要加载到可注入的程度就立即注入，引擎内部会等待输入框出现。
   * 注入失败（页面尚未就绪）时快速重试。各标签页互不等待，实现真正并发发送。
   *
   * 注入前用自愈记忆重排 Recipe：历史上真正生效的策略会被提到链首，
   * 站点改版后不必每次都从失效的选择器开始逐级试错。
   */
  async function injectAutomation(
    tabId: number,
    text: string,
    ai: AiConfig,
    taskId: string,
    memory?: AutomationMemory,
    attachments: AttachmentPayload[] = [],
  ) {
    // 先补桥再注入：保证引擎一旦派发进度就能被转发回后台
    void ensureReplyBridge(tabId);

    const base = resolveRecipe(ai.id, ai.name, ai.url, ai.selectors?.attachSelectors ?? []);
    const recipe = applyMemory(base, memory ?? (await loadMemory()));
    const meta = { aiName: ai.name, aiId: ai.id, taskId };

    const deadline = Date.now() + 20000;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        await browser.scripting.executeScript({
          target: { tabId },
          // 在 MAIN world 运行：部分 AI 站点（豆包/DeepSeek）的 React 事件
          // 只在 MAIN world 下响应合成事件，ISOLATED world 派发的 input/click 不生效
          world: 'MAIN',
          func: runAutomation,
          // 附件仅在 autoSend 站点注入；无附件传 [] 保持参数形状一致
          args: [text, recipe, meta, attachments],
        });
        return;
      } catch (e) {
        // 页面尚未就绪（executeScript 会抛错），快速重试
        if (Date.now() > deadline) {
          console.warn(`[multi-ai-ask] 注入超时（${ai.name}）:`, e);
          updateResult(taskId, ai.id, {
            status: 'error',
            error: '注入超时，未能自动发送',
          });
          return;
        }
        await sleep(250);
      }
    }
  }
});