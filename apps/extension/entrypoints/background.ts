import {
  DEFAULT_AI_CONFIGS,
  mergeConfigs,
  autoFillAndSend,
  addHistory,
  updateHistoryUrl,
  genId,
  type AiConfig,
  type AskTask,
  type AiResult,
} from '@askall/shared';
import { initExtensionPlatform } from '../src/platform';

const AI_CONFIGS_KEY = 'local:aiConfigs';
const OPEN_MODE_KEY = 'local:openMode';
const MENU_ID = 'ask-multi-ai';

export default defineBackground(() => {
  // 注入扩展平台实现：history.ts 等共享工具通过 getPlatform().storage 访问
  initExtensionPlatform();
  // 初始化默认配置 + 右键菜单（仅在安装/更新时）
  browser.runtime.onInstalled.addListener(async () => {
    const existing = await storage.getItem(AI_CONFIGS_KEY);
    if (!existing) {
      await storage.setItem(AI_CONFIGS_KEY, DEFAULT_AI_CONFIGS);
    }
    browser.contextMenus.create({
      id: MENU_ID,
      title: 'AskAll 齐问：打开提问面板',
      contexts: ['selection'],
    });
  });

  // 右键菜单点击：向当前页面的内容脚本发送消息，打开浮动面板
  browser.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId !== MENU_ID || !info.selectionText) return;
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tabId = tabs[0]?.id;
    if (tabId == null) return;
    try {
      await browser.tabs.sendMessage(tabId, {
        type: 'SHOW_PANEL',
        text: info.selectionText,
      });
    } catch (e) {
      // 内容脚本未注入（浏览器内部页/受限页面）时，回退为直接发送
      console.warn('[multi-ai-ask] 无法打开面板，回退为直接提问:', e);
      handleAsk(info.selectionText);
    }
  });

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

  // 监听内容脚本消息（划词浮动面板 + 回答完成 + 打开设置）
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ASK_AI' && msg.text) {
      handleAsk(msg.text, msg.aiIds);
      return;
    }
    if (msg?.type === 'ASK_AI_FOLLOWUP' && msg.text) {
      handleFollowUp(msg.text, msg.aiIds);
      return;
    }
    // 发送中/流式/完成：由 autoSend 经 content script 桥接转发而来
    if (msg?.type === 'AI_SENDING' && msg.aiId) {
      updateResult(msg.taskId, msg.aiId, { status: 'sending' });
      return;
    }
    if (msg?.type === 'AI_REPLY' && msg.aiName && msg.aiId) {
      updateResult(msg.taskId, msg.aiId, {
        status: 'streaming',
        answer: msg.text ?? '',
      });
      return;
    }
    if (msg?.type === 'AI_REPLY_DONE' && msg.aiName && msg.aiId) {
      updateResult(msg.taskId, msg.aiId, {
        status: 'done',
        answer: msg.text ?? '',
      });
      notifyReplyDone(msg.aiName);
      return;
    }
    if (msg?.type === 'GET_TASK') {
      const task = currentTaskId ? tasks.get(currentTaskId) : undefined;
      return { task: task ?? null };
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
      return { replies };
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
    const openMode =
      ((await storage.getItem(OPEN_MODE_KEY)) as 'tabs' | 'windows' | null) ??
      'tabs';
    return { aiConfigs, openMode };
  }

  /** 一次性提问：新建一个任务（新会话），并行打开/复用各 AI 标签页并发送 */
  async function handleAsk(text: string, aiIds?: string[]) {
    const { aiConfigs, openMode } = await loadContext();
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

    // 新建任务 + 新会话
    const taskId = genId();
    const conversationId = genId();
    currentConversationId = conversationId;
    const task: AskTask = {
      id: taskId,
      question,
      createdAt: Date.now(),
      conversationId,
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
    );

    let winIndex = 0;
    for (const ai of enabledList) {
      // 需要自动发送的平台：优先复用已打开的「原有」聊天窗口
      if (ai.autoSend && ai.selectors) {
        const existing = await findExistingChatTab(ai);
        if (existing) {
          trackTab(existing.tabId, historyItem.id, ai.id, ai.name, buildUrl(ai, question));
          injectAutoSend(
            existing.tabId,
            question,
            ai.selectors,
            ai.name,
            taskId,
            ai.id,
          );
          continue;
        }
      }

      // 否则新建标签页/窗口
      const url = buildUrl(ai, question);
      const open = (tabId: number) => {
        trackTab(tabId, historyItem.id, ai.id, ai.name, url);
        if (ai.autoSend && ai.selectors) {
          injectAutoSend(tabId, question, ai.selectors, ai.name, taskId, ai.id);
        }
      };
      if (openMode === 'windows') {
        browser.windows
          .create({
            url,
            type: 'popup',
            width: 520,
            height: 760,
            left: 80 + winIndex * 40,
            top: 80 + winIndex * 40,
          })
          .then((win) => {
            const tabId = win?.tabs?.[0]?.id;
            if (tabId != null) open(tabId);
          });
      } else {
        browser.tabs
          .create({ url, active: false })
          .then((tab) => {
            if (tab.id != null) open(tab.id);
          });
      }
      winIndex++;
    }
  }

  /**
   * 追问：延续当前会话（复用 conversationId 与已打开的聊天窗口），
   * 生成新任务（新 taskId）以区分不同轮次的结果，避免互相覆盖。
   */
  async function handleFollowUp(text: string, aiIds?: string[]) {
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

    // 延续上一个会话；若没有（如后台重启后），则作为新会话发起
    const conversationId = currentConversationId ?? genId();
    currentConversationId = conversationId;

    const taskId = genId();
    const task: AskTask = {
      id: taskId,
      question,
      createdAt: Date.now(),
      conversationId,
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
      conversationId,
    );

    // 优先复用已打开的「原有」聊天窗口
    const reused = new Set<string>();
    for (const ai of targets) {
      if (!ai.autoSend || !ai.selectors || reused.has(ai.id)) continue;
      const existing = await findExistingChatTab(ai);
      if (existing) {
        reused.add(ai.id);
        trackTab(existing.tabId, historyItem.id, ai.id, ai.name, buildUrl(ai, question));
        injectAutoSend(existing.tabId, question, ai.selectors, ai.name, taskId, ai.id);
      }
    }

    // 没有可复用窗口的平台，回退到新建流程
    const missed = targets.filter((ai) => !reused.has(ai.id));
    if (missed.length > 0) {
      await handleAsk(question, missed.map((ai) => ai.id));
    }
  }

  function buildUrl(ai: AiConfig, text: string): string {
    if (ai.url.includes('{query}')) {
      return ai.url.replace(/\{query\}/g, encodeURIComponent(text));
    }
    return ai.url;
  }

  /**
   * 查找某个 AI 已打开的聊天标签页（跨后台会话也能命中）。
   */
  async function findExistingChatTab(
    ai: AiConfig,
  ): Promise<{ tabId: number } | undefined> {
    try {
      const origin = getOrigin(ai.url);
      if (!origin) return undefined;
      const tabs = await browser.tabs.query({ url: `${origin}/*` });
      const ready = tabs.find((t) => t.id != null && t.status === 'complete');
      if (ready && ready.id != null) return { tabId: ready.id };
      if (tabs[0]?.id != null) return { tabId: tabs[0].id };
      return undefined;
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

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * 注入自动发送脚本。不再阻塞等待 tab.status === complete——
   * 页面只要加载到可注入的程度就立即注入，autoFillAndSend 内部会通过
   * MutationObserver 等待输入框出现。注入失败（页面尚未就绪）时快速重试。
   * 各标签页互不等待，实现真正并发发送。
   */
  async function injectAutoSend(
    tabId: number,
    text: string,
    selectors: AiConfig['selectors'],
    aiName: string,
    taskId: string,
    aiId: string,
  ) {
    if (!selectors) return;
    const deadline = Date.now() + 20000;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        await browser.scripting.executeScript({
          target: { tabId },
          // 在 MAIN world 运行：部分 AI 站点（豆包/DeepSeek）的 React 事件
          // 只在 MAIN world 下响应合成事件，ISOLATED world 派发的 input/click 不生效
          world: 'MAIN',
          func: autoFillAndSend,
          args: [text, selectors, aiName, taskId, aiId],
        });
        return;
      } catch (e) {
        // 页面尚未就绪（executeScript 会抛错），快速重试
        if (Date.now() > deadline) {
          console.warn(`[multi-ai-ask] 注入超时（${aiName}）:`, e);
          updateResult(taskId, aiId, {
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