/**
 * PlatformApi —— 浏览器扩展 UI 的平台抽象层。
 *
 * 共享 UI 组件（Workspace / SettingsApp / AiConfigPanel / FloatingPanel 等）只调用
 * `getPlatform()` 返回的接口，不直接触碰 `browser.*`。
 * 具体实现由扩展在启动时通过 `setPlatform()` 注入：
 *   - 浏览器扩展：apps/extension/entrypoints/_platform.ts
 *
 * 设计原则：接口尽量贴合现有 UI 已有的调用形态，避免大改 UI 逻辑。
 */
import type { AttachmentPayload } from '../../automation/types';
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
      /** 回复发生时的页面地址（真实会话页 chat/xxx），用于跳转对应会话 */
      url?: string;
    }
  | {
      type: 'AI_REPLY_DONE';
      aiId: string;
      aiName: string;
      taskId: string;
      text: string;
      /** 回复完成时的页面地址（真实会话页 chat/xxx），用于跳转与历史回写 */
      url?: string;
    };

/** AI 站点打开方式（当前仅浏览器标签页；保留语义以兼容未来扩展） */
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
   * 扩展走 browser.runtime.getURL。
   */
  assetUrl(path: string): string;
}

export interface PlatformWindow {
  /** 关闭当前窗口/标签页（options 标签页、popup 均适用）。 */
  close(): Promise<void>;
  /** 打开设置视图（扩展：openOptionsPage）。 */
  openSettings(): Promise<void>;
}

export interface PlatformAsk {
  /**
   * 一次性提问：新建任务（新会话），并行打开各 AI 标签页/聊天页并发送。
   * 立即返回；各 AI 的回复进度通过 onReply 推送。
   * `attachments` 可选：随问题一并发送的附件。
   */
  ask(text: string, aiIds?: string[], attachments?: AttachmentPayload[]): Promise<void>;
  /**
   * 追问：延续当前会话（复用已打开的聊天页），生成新任务。
   * `attachments` 语义同 ask。
   * `conversationId` 可选：指定要延续的会话 id（前端当前激活会话）。
   * 后台优先使用它，避免 service worker 休眠重启后内存会话状态丢失、
   * 追问被误判为新话题。
   */
  followUp(
    text: string,
    aiIds?: string[],
    attachments?: AttachmentPayload[],
    conversationId?: string,
  ): Promise<void>;
  /** 获取当前任务（含各 AI 结果）。 */
  getTask(): Promise<{ task: AskTask | null }>;
  /**
   * 打开/切换到某 AI 聊天标签页/窗口。
   * 携带 `aiId` 时优先复用该 AI 已有的聊天页（保留当前聊天状态），
   * 找不到才以 `url` 新开；`name` 用作新建窗口标题。
   */
  openAiTab(url: string, aiId?: string, name?: string): Promise<void>;
  /**
   * 在系统浏览器/新标签页打开 URL（外链）。
   */
  openExternal(url: string): Promise<void>;
  /**
   * 手动同步某 AI 的回答状态：向该 AI 已打开的标签页注入一次性探测，
   * 重新读取当前回答并回传（用于面板手动刷新，兜底引擎自动同步失效的场景）。
   */
  syncAi?(aiId: string, aiName: string, taskId: string): Promise<void>;
  /** 订阅各 AI 回复进度。返回取消订阅函数。 */
  onReply(handler: (msg: ReplyMessage) => void): () => void;
}

export interface PlatformApi {
  readonly kind: 'extension';
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
