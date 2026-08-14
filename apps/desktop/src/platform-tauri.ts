/**
 * Tauri 桌面端平台适配器。
 *
 * 与浏览器扩展（apps/extension/src/platform.ts）实现同一套 `PlatformApi` 契约，
 * 让共享 UI（@askall/shared）在桌面端无需改动即可复用。
 *
 * 桌面端的「ask 编排器」实际由 Rust 侧（src-tauri/src/lib.rs）实现：
 *   - 前端通过 invoke('ask_ai' | 'ask_ai_followup', { text, aiIds, mode }) 触发；
 *   - Rust 根据 mode 决定「内嵌子 webview 窗口」或「系统浏览器打开」；
 *   - 各 AI 的回复进度由 Rust 通过 'ai-reply' 事件流式推回，onReply 在此订阅。
 *
 * 命令契约（与 Phase 6 的 Rust 端一一对应）：
 *   ask_ai(text: String, ai_ids: Vec<String>, mode: String)
 *   ask_ai_followup(text: String, ai_ids: Vec<String>, mode: String)
 *   get_task() -> AskTask | null
 *   open_ai_webview(url: String, label?: String)
 *   事件 'ai-reply'，payload 为 ReplyMessage
 */
import {
  setPlatform,
  type PlatformApi,
  type ReplyMessage,
  type OpenMode,
  type AskTask,
  type AiConfig,
  mergeConfigs,
} from '@askall/shared';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';

/** AI 站点打开方式存储键（与共享 App.tsx 写入侧保持一致）。 */
const OPEN_MODE_KEY = 'local:openMode';
/** AI 配置存储键（与共享 utils/aiConfig 保持一致）。 */
const AI_CONFIGS_KEY = 'local:aiConfigs';

/**
 * PlatformApp.getVersion() 契约为同步返回 string，而 Tauri 的 getVersion()
 * 是异步的。这里在 initTauriPlatform() 启动时预先取回并缓存，运行时同步返回。
 */
let cachedVersion = '0.0.0';

/**
 * 同步读取当前「打开方式」。
 * 共享 App.tsx 通过 platform.storage.setItem 写入（值为 JSON 字符串 'embedded'/'browser'），
 * 桌面端 storage 实现落地到 localStorage，故直接同步读取即可，便于 ask 编排时即时决策。
 */
function readOpenMode(): OpenMode {
  try {
    const raw = localStorage.getItem(OPEN_MODE_KEY);
    if (!raw) return 'embedded';
    const v = JSON.parse(raw);
    return v === 'browser' ? 'browser' : 'embedded';
  } catch {
    return 'embedded';
  }
}

/**
 * 从 localStorage 读取并合并 AI 配置，按 aiIds 过滤出本次要发送的配置子集。
 * Rust 编排器需要完整配置（URL + 选择器），不能仅凭 id 工作。
 */
async function resolveConfigs(aiIds?: string[]): Promise<AiConfig[]> {
  let stored: AiConfig[] | null = null;
  try {
    const raw = localStorage.getItem(AI_CONFIGS_KEY);
    if (raw) stored = JSON.parse(raw) as AiConfig[];
  } catch {
    stored = null;
  }
  const merged = mergeConfigs(stored ?? null);
  if (!aiIds || aiIds.length === 0) return merged.filter((c) => c.enabled);
  return merged.filter((c) => aiIds.includes(c.id));
}

export const tauriPlatform: PlatformApi = {
  kind: 'tauri',

  app: {
    getVersion: () => cachedVersion,
  },

  assets: {
    // Vite 打包后的 public 资源走相对根路径；dev 下 BASE_URL='/'，prod 下亦为 '/'
    assetUrl: (path) =>
      `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`,
  },

  storage: {
    // 桌面端 webview 拥有同源 localStorage，与扩展 browser.storage.local 行为等价。
    // 值统一以 JSON 序列化，保证共享 utils（history/aiConfig）读取结构一致。
    getItem: async <T = unknown>(key: string): Promise<T | null> => {
      const raw = localStorage.getItem(key);
      if (raw == null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        // 兼容历史写入的非 JSON 字符串
        return raw as unknown as T;
      }
    },
    setItem: async <T = unknown>(key: string, value: T): Promise<void> => {
      localStorage.setItem(key, JSON.stringify(value));
    },
  },

  window: {
    close: async () => {
      try {
        await getCurrentWindow().close();
      } catch (e) {
        console.warn('[askall-tauri] 关闭窗口失败:', e);
      }
    },
    openSettings: async () => {
      // 桌面端「设置」即共享 App 的「AI 配置」Tab：聚焦窗口并派发导航事件，
      // 由 App 监听切换；即便无人监听也至少把窗口拉到前台。
      try {
        await getCurrentWindow().setFocus();
      } catch {
        /* 忽略 */
      }
      window.dispatchEvent(
        new CustomEvent('askall-navigate', { detail: { tab: 'config' } }),
      );
    },
  },

  ask: {
    // 桌面 ask 编排器入口：解析选中 AI 的完整配置，连同文本、打开方式一并交给 Rust。
    // Rust 负责：按 mode 决定内嵌子 webview 或系统浏览器 → 注入自动发送脚本 → 回传回复。
    ask: async (text, aiIds) => {
      const mode = readOpenMode();
      const configs = await resolveConfigs(aiIds);
      await invoke('ask_ai', { text, configs, mode });
    },
    followUp: async (text, aiIds) => {
      const mode = readOpenMode();
      const configs = await resolveConfigs(aiIds);
      await invoke('ask_ai_followup', { text, configs, mode });
    },
    getTask: async () => {
      const task = await invoke<AskTask | null>('get_task');
      return { task: task ?? null };
    },
    // 双模式 openAiSite：内嵌 = Rust 创建/聚焦子 webview 窗口；浏览器 = 系统默认打开。
    // 用户在设置中切换「内嵌/浏览器」即实时生效（readOpenMode 每次读取最新值）。
    openAiTab: async (url) => {
      const mode = readOpenMode();
      if (mode === 'browser') {
        await openUrl(url);
      } else {
        await invoke('open_ai_webview', { url });
      }
    },
    onReply: (handler) => {
      // listen 异步返回 unlisten；在等待期间若已取消，则立即释放，避免悬挂订阅。
      let unlisten: UnlistenFn | null = null;
      let cancelled = false;
      listen<ReplyMessage>('ai-reply', (e) => {
        handler(e.payload);
      })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch((e) => {
          console.warn('[askall-tauri] 订阅 ai-reply 失败:', e);
        });
      return () => {
        cancelled = true;
        if (unlisten) unlisten();
      };
    },
  },
};

/**
 * 桌面端启动注入：先异步取版本号缓存为同步值，再 setPlatform。
 * 由 apps/desktop/src/main.tsx 在渲染前 await 调用。
 */
export async function initTauriPlatform(): Promise<void> {
  try {
    cachedVersion = await getVersion();
  } catch {
    /* 取不到版本时保留默认值，不阻断启动 */
  }
  setPlatform(tauriPlatform);
}
