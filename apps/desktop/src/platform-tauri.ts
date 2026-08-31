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
 *   show_ai_chat(ai_id: String, url: String, name?: String)
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
  resolveRecipe,
  genericSteps,
  DEFAULT_RECIPES,
  type Recipe,
} from '@askall/shared';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';

/** AI 配置存储键（与共享 utils/aiConfig 保持一致）。 */
const AI_CONFIGS_KEY = 'local:aiConfigs';

/**
 * PlatformApp.getVersion() 契约为同步返回 string，而 Tauri 的 getVersion()
 * 是异步的。这里在 initTauriPlatform() 启动时预先取回并缓存，运行时同步返回。
 */
let cachedVersion = '0.0.0';

/**
 * 打开方式设置已移除：桌面端固定「应用内嵌」展示 chat（attach 到主窗口田字格），
 * 不再用系统浏览器打开。保留 OpenMode 返回类型以兼容调用方。
 */
function readOpenMode(): OpenMode {
  return 'embedded';
}

/**
 * 为某个 AI 构建自动化 Recipe（与扩展端 background 的 resolveRecipe 同一份数据）。
 * - 默认平台：用内置 Recipe（含站点专属选择器，改版时随 @askall/shared 更新）；
 * - 自定义平台：通用策略链；若用户在设置里配过选择器，注入到通用链里。
 * 仅随 ask 请求传给 Rust，不写回 localStorage，避免持久化过期的 Recipe。
 */
function recipeForConfig(ai: AiConfig): Recipe {
  if (DEFAULT_RECIPES.some((r) => r.id === ai.id)) {
    return resolveRecipe(ai.id, ai.name, ai.url);
  }
  const sel = ai.selectors;
  return {
    id: ai.id,
    name: ai.name,
    version: 0,
    url: ai.url,
    steps: genericSteps(
      sel?.inputCandidates ?? (sel?.input ? [sel.input] : []),
      sel?.sendButtonCandidates ?? (sel?.sendButton ? [sel.sendButton] : []),
      sel?.replyCandidates ?? [],
    ),
  };
}

/**
 * 从 localStorage 读取并合并 AI 配置，按 aiIds 过滤出本次要发送的配置子集。
 * Rust 编排器需要完整配置（URL + Recipe），不能仅凭 id 工作。
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
  const list =
    !aiIds || aiIds.length === 0
      ? merged.filter((c) => c.enabled)
      : merged.filter((c) => aiIds.includes(c.id));
  return list.map((c) => ({ ...c, recipe: recipeForConfig(c) }));
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
      // v1.1：设置独立窗口。调用 Rust 命令创建/聚焦 label=settings 的窗口
      // （加载同一份 SPA 的 #settings 路由渲染 SettingsApp）。
      try {
        await invoke('open_settings_window');
      } catch (e) {
        console.warn('[askall-tauri] 打开设置窗口失败:', e);
        try {
          await getCurrentWindow().setFocus();
        } catch {
          /* 忽略 */
        }
      }
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
    // 携带 aiId 时走 show_ai_chat：复用提问时创建的 ai-{aiId} 隐藏子窗口
    // （保留该 AI 的当前聊天状态），实现顶部 chat tabs 的「弹窗显示」切换。
    openAiTab: async (url, aiId, name) => {
      const mode = readOpenMode();
      if (aiId && mode !== 'browser') {
        await invoke('show_ai_chat', { aiId, url, name });
        return;
      }
      if (mode === 'browser') {
        await openUrl(url);
      } else {
        await invoke('open_ai_webview', { url });
      }
    },
    // 田字格布局：把各 AI 聊天页 attach 到主窗口并定位（cells 坐标/尺寸为逻辑像素）
    layoutAiGrid: async (cells) => {
      await invoke('layout_ai_grid', { cells });
    },
    // 外链打开：在系统默认浏览器中打开该会话（GridChat 单元格「外链」按钮）
    openExternal: async (url) => {
      try {
        await openUrl(url);
      } catch (e) {
        console.warn('[askall-tauri] 外链打开失败:', e);
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

  // 桥接 Rust 端 OS 级「划词提问」事件（全局快捷键 / macOS 右键菜单）到 window 事件，
  // 供共享 App.tsx 监听后切到「提问」Tab 并预填问题。扩展端无此事件，监听无副作用。
  listen<{ text: string; source: string }>('askall-external-ask', (e) => {
    window.dispatchEvent(
      new CustomEvent('askall-external-ask', {
        detail: { text: e.payload.text, source: e.payload.source },
      }),
    );
  }).catch((err) => {
    console.warn('[askall-tauri] 订阅 askall-external-ask 失败:', err);
  });
}
