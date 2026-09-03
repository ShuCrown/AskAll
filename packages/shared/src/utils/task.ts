/**
 * AskTask 任务模型：一次提问（可能同时发给多个 AI）对应一个任务。
 *
 * 相比旧的 `Map<aiName, reply>`，这里以「任务 × AI」为维度管理结果，
 * 多轮追问会生成新的 taskId，但会话（conversationId + 复用的 Tab）保持不变，
 * 从而避免不同轮次之间的回答互相覆盖。
 */

export type AiStatus =
  | 'opening' // 已创建/复用标签页，尚未开始注入
  | 'sending' // 正在填充并发送
  | 'streaming' // 已发送，正在流式生成回答
  | 'done' // 回答完成
  | 'error'; // 发送失败

export interface AiResult {
  aiId: string;
  aiName: string;
  /** 对应 AI 的标签页（同一次会话内复用） */
  tabId?: number;
  status: AiStatus;
  answer: string;
  /** 真实会话 URL（自动发送成功后页面跳转得到的地址） */
  url?: string;
  error?: string;
}

/** 附件元数据（历史/任务中只存元信息，文件本体仅内存流转） */
export interface AttachmentInfo {
  name: string;
  mime: string;
  size: number;
}

export interface AskTask {
  id: string;
  question: string;
  createdAt: number;
  /** 会话标识：多轮追问共享同一 conversationId，用于历史分组 */
  conversationId: string;
  /**
   * 对应历史记录条目的 id（v1.1 新增，可选）。
   * 扩展端由 background 在 addHistory 后回填。
   * 用于 AI_REPLY_DONE 时把回答快照写入正确的历史条目。
   */
  historyId?: string;
  /** 本次提问携带的附件元数据（不含文件本体） */
  attachments?: AttachmentInfo[];
  /** aiId -> 结果 */
  results: Record<string, AiResult>;
}

/** 生成唯一 id（时间戳 + 随机后缀，避免同一毫秒内冲突） */
export function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}