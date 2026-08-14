/**
 * PlatformApi —— 浏览器扩展 / Tauri 桌面端共用 UI 的平台抽象层。
 *
 * 共享 UI 组件（App / AiConfigPanel / HistoryPanel / FloatingPanel）只调用
 * `getPlatform()` 返回的接口，不直接触碰 `browser.*` 或 `@tauri-apps/api`。
 * 具体实现由各 App 在启动时通过 `setPlatform()` 注入：
 *   - 浏览器扩展：apps/extension/entrypoints/_platform.ts
 *   - Tauri 桌面端：apps/desktop/src/platform-tauri.ts
 *
 * 设计原则：接口尽量贴合现有 UI 已有的调用形态，避免大改 UI 逻辑。
 */
import type { AskTask } from '../../utils/task';

/** 各 AI 回复进度消息（与扩展 background.ts 的运行时消息一一对应）。 */
export type ReplyMessage =
  | { type: 'AI_SENDING'; aiId: string; aiName: string; taskId: string }
  | {
      type: 'AI_REPLY';
      aiId: string;
      aiName: string;
      taskId: string;
      text: string;
    }
  | {
      type: 'AI_REPLY_DONE';
      aiId: string;
      aiName: string;
      taskId: string;
      text: string;
    };

/** AI 站点打开方式：内嵌于应用窗口 / 在系统浏览器中打开。 */
export type OpenMode = 'embedded' | 'browser';

export interface PlatformStorage {
  getItem<T = unknown>(key: string): Promise<T | null>;
  setItem<T = unknown>(key: string, value: T): Promise<void>;
}

export interface PlatformApp {
  /** 当前应用版本号（用于 UI 展示）。 */
  getVersion(): string;
}

export interface PlatformAssets {
  /**
   * 解析 public 资源路径（如 'icon/128.png'、'ai/deepseek.svg'）为可用 URL。
   * 扩展走 browser.runtime.getURL；Tauri 走打包后的相对根路径。
   */
  assetUrl(path: string): string;
}

export interface PlatformWindow {
  /** 关闭当前窗口/标签页（options 标签页、popup、桌面窗口均适用）。 */
  close(): Promise<void>;
  /** 打开设置视图（扩展：openOptionsPage；桌面：切换到设置 Tab）。 */
  openSettings(): Promise<void>;
}

export interface PlatformAsk {
  /**
   * 一次性提问：新建任务（新会话），并行打开各 AI 标签页/子 webview 并发送。
   * 立即返回；各 AI 的回复进度通过 onReply 推送。
   */
  ask(text: string, aiIds?: string[]): Promise<void>;
  /**
   * 追问：延续当前会话（复用已打开的聊天窗口），生成新任务。
   */
  followUp(text: string, aiIds?: string[]): Promise<void>;
  /** 获取当前任务（含各 AI 结果）。 */
  getTask(): Promise<{ task: AskTask | null }>;
  /** 打开/切换到某 AI 聊天标签页/窗口。 */
  openAiTab(url: string): Promise<void>;
  /** 订阅各 AI 回复进度。返回取消订阅函数。 */
  onReply(handler: (msg: ReplyMessage) => void): () => void;
}

export interface PlatformApi {
  readonly kind: 'extension' | 'tauri';
  app: PlatformApp;
  assets: PlatformAssets;
  storage: PlatformStorage;
  window: PlatformWindow;
  ask: PlatformAsk;
}

/** 平台尚未注入时抛出的错误，便于发现「忘记 setPlatform」的 bug。 */
export class PlatformNotSetError extends Error {
  constructor() {
    super(
      '[askall] Platform has not been initialized. Call setPlatform(...) at app boot.',
    );
    this.name = 'PlatformNotSetError';
  }
}
