import { DEFAULT_AI_CONFIGS } from '@/utils/aiConfig';
import type { AiConfig } from '@/utils/aiConfig';
import { autoFillAndSend } from '@/utils/autoSend';
import { addHistory } from '@/utils/history';

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

  // 监听内容脚本消息（划词浮动按钮）
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ASK_AI' && msg.text) {
      handleAsk(msg.text);
    }
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
      name: ai.name,
      url: buildUrl(ai, question),
    }));
    await addHistory(question, enabledList.map((ai) => ai.name), aiUrls);

    if (openMode === 'windows') {
      enabledList.forEach((ai, index) => {
        browser.windows
          .create({
            url: buildUrl(ai, question),
            type: 'popup',
            width: 520,
            height: 760,
            left: 80 + index * 40,
            top: 80 + index * 40,
          })
          .then((win) => {
            const tabId = win.tabs?.[0]?.id;
            if (ai.autoSend && ai.selectors && tabId != null) {
              injectAutoSend(tabId, question, ai.selectors);
            }
          });
      });
    } else {
      enabledList.forEach((ai) => {
        browser.tabs
          .create({ url: buildUrl(ai, question), active: false })
          .then((tab) => {
            if (ai.autoSend && ai.selectors && tab.id != null) {
              injectAutoSend(tab.id, question, ai.selectors);
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
          args: [text, selectors],
        });
        return;
      } catch (e) {
        console.warn(`[multi-ai-ask] 注入失败（第 ${attempt + 1} 次）:`, e);
        if (attempt < 4) await sleep(1000);
      }
    }
  }
});
