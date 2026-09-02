/**
 * 浏览器扩展平台适配器。
 *
 * 依赖 WXT 自动注入的全局：`browser`（WebExtension polyfill）与 `storage`
 * （@wxt-dev/storage，键名带 `local:` 前缀走 browser.storage.local）。
 * 这些全局由 WXT 在构建时通过 unimport 自动导入，无需手写 import。
 *
 * 各 entrypoint（background / content / popup / options）启动时调用
 * `initExtensionPlatform()` 注入即可。
 */
import {
  setPlatform,
  type PlatformApi,
  type ReplyMessage,
  type AskTask,
} from '@askall/shared';

const REPLY_TYPES = new Set<string>([
  'AI_SENDING',
  'AI_REPLY',
  'AI_REPLY_DONE',
]);

// WXT 的 getURL / storage 接受模板字面量类型（PublicPath / `local:${string}`），
// 这里 cast 成通用 string 入参，便于适配器按 PlatformApi 契约接收任意 key。
const getURL = browser.runtime.getURL as (path: string) => string;
const wxtStorage = storage as unknown as {
  getItem: <T = unknown>(key: string) => Promise<T | null>;
  setItem: <T = unknown>(key: string, value: T) => Promise<void>;
};

export const extensionPlatform: PlatformApi = {
  kind: 'extension',

  app: {
    getVersion: () => browser.runtime.getManifest().version,
  },

  assets: {
    // public 资源走扩展打包内的 runtime.getURL
    assetUrl: (path) => getURL('/' + path.replace(/^\/+/, '')),
  },

  storage: {
    // 直接复用 WXT storage（键名 local:xxx → browser.storage.local）
    getItem: (key) => wxtStorage.getItem(key),
    setItem: (key, value) => wxtStorage.setItem(key, value),
  },

  window: {
    // popup：window.close() 有效；options 标签页：window.close() 被浏览器忽略，改用 tabs API
    close: async () => {
      try {
        window.close();
      } catch {
        /* 忽略 */
      }
      try {
        const current = await browser.tabs.getCurrent();
        if (current?.id != null) {
          await browser.tabs.remove(current.id);
        }
      } catch {
        /* 非扩展页面环境忽略 */
      }
    },
    openSettings: async () => {
      try {
        // content script 上下文不可靠直接调 openOptionsPage，统一经 background 打开
        // （background.ts 已处理 OPEN_SETTINGS → openSettingsPage）
        await browser.runtime.sendMessage({ type: 'OPEN_SETTINGS' });
      } catch (e) {
        console.warn('[askall-ext] 打开设置页失败:', e);
      }
    },
  },

  ask: {
    // 转发到 background 的 onMessage 处理器（附件非空才携带，减少消息体积）
    ask: (text, aiIds, attachments) =>
      browser.runtime
        .sendMessage({
          type: 'ASK_AI',
          text,
          aiIds,
          ...(attachments?.length ? { attachments } : {}),
        })
        .then(() => undefined),
    followUp: (text, aiIds, attachments) =>
      browser.runtime
        .sendMessage({
          type: 'ASK_AI_FOLLOWUP',
          text,
          aiIds,
          ...(attachments?.length ? { attachments } : {}),
        })
        .then(() => undefined),
    getTask: async () => {
      const res = await browser.runtime.sendMessage({ type: 'GET_TASK' });
      return { task: (res?.task ?? null) as AskTask | null };
    },
    openAiTab: (url) =>
      browser.runtime
        .sendMessage({ type: 'OPEN_AI_TAB', url })
        .then(() => undefined),
    // 外链打开：扩展端即新开/切换到浏览器标签页（与 openAiTab 一致）
    openExternal: (url) =>
      browser.runtime
        .sendMessage({ type: 'OPEN_AI_TAB', url })
        .then(() => undefined),
    // 手动同步：请求 background 向该 AI 标签页注入探测，回传最新回答状态
    syncAi: (aiId, aiName, taskId) =>
      browser.runtime
        .sendMessage({ type: 'SYNC_AI', aiId, aiName, taskId })
        .then(() => undefined),
    onReply: (handler) => {
      const listener = (msg: unknown) => {
        if (!msg || typeof msg !== 'object') return;
        const m = msg as Record<string, unknown>;
        if (typeof m.type !== 'string' || !REPLY_TYPES.has(m.type)) return;
        handler(m as unknown as ReplyMessage);
      };
      browser.runtime.onMessage.addListener(listener);
      return () => {
        browser.runtime.onMessage.removeListener(listener);
      };
    },
  },
};

/** 在扩展各入口启动时调用，注入扩展平台实现。 */
export function initExtensionPlatform(): void {
  setPlatform(extensionPlatform);
}
