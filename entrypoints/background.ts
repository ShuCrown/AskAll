import { DEFAULT_AI_CONFIGS, mergeConfigs } from '@/utils/aiConfig';
import type { AiConfig } from '@/utils/aiConfig';
import { autoFillAndSend } from '@/utils/autoSend';
import { addHistory, updateHistoryUrl } from '@/utils/history';

const AI_CONFIGS_KEY = 'local:aiConfigs';
const OPEN_MODE_KEY = 'local:openMode';
const MENU_ID = 'ask-multi-ai';

export default defineBackground(() => {
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
    if (msg?.type === 'AI_REPLY' && msg.aiName) {
      // 更新该 AI 的最新回复（供结果面板轮询展示）
      aiReplies.set(msg.aiName, msg.text ?? '');
      return;
    }
    if (msg?.type === 'GET_REPLIES') {
      return { replies: Object.fromEntries(aiReplies) };
    }
    if (msg?.type === 'AI_REPLY_DONE' && msg.aiName) {
      if (msg.text) aiReplies.set(msg.aiName, msg.text);
      notifyReplyDone(msg.aiName);
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
  });

  async function openSettingsPage() {
    try {
      await browser.runtime.openOptionsPage();
    } catch (e) {
      console.warn('[multi-ai-ask] 打开设置页失败:', e);
    }
  }

  const NOTIFY_KEY = 'local:notifyOnDone';

  // 各 AI 最新回复缓存（aiName -> 回复文本），供浮动结果面板轮询展示
  const aiReplies = new Map<string, string>();

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
   * 自动发送成功后页面会跳转到真实会话地址（SPA pushState 或整页跳转），
   * 监听到同域 URL 变化且稳定后，把该地址回写到历史记录。
   */
  interface TabTrack {
    historyId: string;
    aiId: string;
    aiName: string;
    initialUrl: string;
    lastUrl?: string;
    /** 是否已捕获会话 URL（只记录发送后的第一次同域跳转，避免用户后续手动导航覆盖历史） */
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

  async function handleAsk(text: string, aiIds?: string[]) {
    // 合并最新默认配置，确保内置平台使用最新的选择器（存储可能是旧数据）
    const aiConfigs = mergeConfigs(
      (await storage.getItem(AI_CONFIGS_KEY)) as AiConfig[] | null,
    );
    const openMode =
      ((await storage.getItem(OPEN_MODE_KEY)) as 'tabs' | 'windows' | null) ??
      'tabs';

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
    );

    let winIndex = 0;
    for (const ai of enabledList) {
      // 需要自动发送的平台：优先复用已打开的「原有」聊天窗口，直接输入内容并自动发送，避免重复新建
      if (ai.autoSend && ai.selectors) {
        const existing = await findExistingChatTab(ai);
        if (existing) {
          injectAutoSend(existing.tabId, question, ai.selectors, ai.name);
          continue;
        }
      }

      // 否则新建标签页/窗口
      const url = buildUrl(ai, question);
      const open = (tabId: number) => {
        trackTab(tabId, historyItem.id, ai.id, ai.name, url);
        if (ai.autoSend && ai.selectors) {
          injectAutoSend(tabId, question, ai.selectors, ai.name);
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

  function buildUrl(ai: AiConfig, text: string): string {
    if (ai.url.includes('{query}')) {
      return ai.url.replace(/\{query\}/g, encodeURIComponent(text));
    }
    return ai.url;
  }

  /**
   * 查找某个 AI 已打开的聊天标签页（跨后台会话也能命中）。
   * 匹配依据是该 AI 配置 URL 的源（origin），返回已加载完成的标签页。
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
      // 去除可能存在的 {query} 占位符后再解析源
      return new URL(url.replace(/\{query\}/g, '')).origin;
    } catch {
      return null;
    }
  }

  /**
   * 查看原文：优先切换到该 AI 已打开的聊天标签页（按 origin 匹配），
   * 找不到才新建标签页。避免每次「查看原文」都新开一个窗口。
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
   * 追问：把新问题直接注入到已打开的 AI 聊天标签页/窗口，避免重复新建。
   * 若对应 AI 没有已打开的窗口，则回退到默认的新建流程。
   */
  async function handleFollowUp(text: string, aiIds?: string[]) {
    const aiConfigs = mergeConfigs(
      (await storage.getItem(AI_CONFIGS_KEY)) as AiConfig[] | null,
    );
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

    // 优先复用已打开的「原有」聊天窗口（通过 tabs.query 跨后台会话也能命中），
    // 直接输入问题并自动发送，避免重新新建标签页/窗口。
    const reused = new Set<string>();
    for (const ai of targets) {
      if (!ai.autoSend || !ai.selectors || reused.has(ai.id)) continue;
      const existing = await findExistingChatTab(ai);
      if (existing) {
        reused.add(ai.id);
        injectAutoSend(existing.tabId, question, ai.selectors, ai.name);
      }
    }

    // 没有可复用窗口的平台，回退到新建流程
    const missed = targets.filter((ai) => !reused.has(ai.id));
    if (missed.length > 0) {
      await handleAsk(question, missed.map((ai) => ai.id));
    }
  }


  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * 等待标签页完成加载。
   * tabs.create 回调触发时页面往往还在 loading，此时 executeScript 注入会失败，
   * 必须先等 tab.status === 'complete' 再注入。
   */
  async function waitForTabComplete(tabId: number, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const tab = await browser.tabs.get(tabId);
        if (tab.status === 'complete') return;
      } catch {
        return; // 标签页已被关闭，放弃等待
      }
      await sleep(300);
    }
  }

  async function injectAutoSend(
    tabId: number,
    text: string,
    selectors: AiConfig['selectors'],
    aiName: string,
  ) {
    if (!selectors) return;
    // 等页面加载完成，避免注入时机过早导致失败（豆包等重页面尤其明显）
    await waitForTabComplete(tabId);
    // executeScript 注入重试：页面加载状态存在竞争，首次可能失败
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await browser.scripting.executeScript({
          target: { tabId },
          // 在 MAIN world 运行：部分 AI 站点（豆包/DeepSeek）的 React 事件
          // 只在 MAIN world 下响应合成事件，ISOLATED world 派发的 input/click 不生效
          world: 'MAIN',
          func: autoFillAndSend,
          args: [text, selectors, aiName],
        });
        return;
      } catch (e) {
        console.warn(`[multi-ai-ask] 注入失败（第 ${attempt + 1} 次）:`, e);
        if (attempt < 4) await sleep(1000);
      }
    }
  }
});
