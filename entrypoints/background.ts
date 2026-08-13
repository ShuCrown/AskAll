import { DEFAULT_AI_CONFIGS } from '@/utils/aiConfig';
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
      title: '向多个 AI 提问：%s',
      contexts: ['selection'],
    });
  });

  // 右键菜单点击
  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === MENU_ID && info.selectionText) {
      handleAsk(info.selectionText);
    }
  });

  // 监听内容脚本消息（划词浮动按钮 + 回答完成）
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ASK_AI' && msg.text) {
      handleAsk(msg.text);
      return;
    }
    if (msg?.type === 'AI_REPLY_DONE' && msg.aiName) {
      notifyReplyDone(msg.aiName);
    }
  });

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

  async function handleAsk(text: string) {
    const aiConfigs =
      ((await storage.getItem(AI_CONFIGS_KEY)) as AiConfig[] | null) ??
      DEFAULT_AI_CONFIGS;
    const openMode =
      ((await storage.getItem(OPEN_MODE_KEY)) as 'tabs' | 'windows' | null) ??
      'tabs';

    const enabledList = aiConfigs.filter((ai) => ai.enabled && ai.url);
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

    if (openMode === 'windows') {
      enabledList.forEach((ai, index) => {
        const url = buildUrl(ai, question);
        browser.windows
          .create({
            url,
            type: 'popup',
            width: 520,
            height: 760,
            left: 80 + index * 40,
            top: 80 + index * 40,
          })
          .then((win) => {
            const tabId = win?.tabs?.[0]?.id;
            if (tabId != null) {
              trackTab(tabId, historyItem.id, ai.id, ai.name, url);
              if (ai.autoSend && ai.selectors) {
                injectAutoSend(tabId, question, ai.selectors, ai.name);
              }
            }
          });
      });
    } else {
      enabledList.forEach((ai) => {
        const url = buildUrl(ai, question);
        browser.tabs
          .create({ url, active: false })
          .then((tab) => {
            if (tab.id != null) {
              trackTab(tab.id, historyItem.id, ai.id, ai.name, url);
              if (ai.autoSend && ai.selectors) {
                injectAutoSend(tab.id, question, ai.selectors, ai.name);
              }
            }
          });
      });
    }
  }

  function buildUrl(ai: AiConfig, text: string): string {
    if (ai.url.includes('{query}')) {
      return ai.url.replace(/\{query\}/g, encodeURIComponent(text));
    }
    return ai.url;
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
