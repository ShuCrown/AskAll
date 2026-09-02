import { getPlatform } from '../lib/platform';
import type { AttachmentInfo } from './task';

/**
 * AI 回答快照：AI_REPLY_DONE 到达后落盘，用于历史会话回放。
 * 旧数据没有 answers 字段时，历史回放只显示问题 + 会话链接（向后兼容）。
 */
export interface AiAnswerSnapshot {
  aiId?: string;
  name: string;
  /** 最终回答文本（已按 ANSWER_MAX_LEN 截断） */
  text: string;
  /** 真实会话 URL（随 updateHistoryUrl 一并回写） */
  url?: string;
  /** done = 正常回答；error = 自动发送失败的兜底提示（非真实回答） */
  status: 'done' | 'error';
  /** 落盘时间戳 */
  savedAt: number;
}

export interface HistoryItem {
  id: string;
  question: string;
  timestamp: number;
  /** 本次提问面向的 AI 名称列表 */
  aiNames: string[];
  /**
   * 每个 AI 的页面 URL。
   * 初始为模板 URL（chat 首页）；若自动发送成功后抓到真实会话 URL，
   * 会由 background 通过 updateHistoryUrl 回写覆盖。
   */
  aiUrls: { id?: string; name: string; url: string }[];
  /**
   * 会话分组标识：同一会话的多轮追问共享同一 conversationId，
   * 用于历史记录按「会话 → 轮次」两级展示。
   */
  conversationId?: string;
  /** 各 AI 的最终回答快照（v1.1 新增；旧数据可能缺失） */
  answers?: AiAnswerSnapshot[];
  /** 本次提问携带的附件元数据（仅名称/类型/大小，不含文件本体） */
  attachments?: AttachmentInfo[];
}

const HISTORY_KEY = 'local:history';
/**
 * 历史条目兜底上限：索引瘦身后单条体积极小（仅问题 + 各 AI 会话 path），
 * 可容纳数千条；近期会话才携带回答快照（见 SNAPSHOT_KEEP）。
 * 扩展端申请了 unlimitedStorage 无配额；桌面端 localStorage ~5MB 也在安全范围内。
 */
const MAX_ITEMS = 2000;
/** 回答快照（回答内容）仅保留最近 N 条历史条目，更早的仅保留话题 + path */
const SNAPSHOT_KEEP = 50;

/** 单条回答快照的最大存储长度，防止 localStorage 超限 */
export const ANSWER_MAX_LEN = 2000;

/** 截断超长回答文本（尾部附截断标记） */
export function truncateAnswer(text: string): string {
  if (!text) return '';
  if (text.length <= ANSWER_MAX_LEN) return text;
  return `${text.slice(0, ANSWER_MAX_LEN)}\n…[内容已截断，请在会话页查看完整回答]`;
}

/**
 * 判断回复文本是否为「自动发送失败」的兜底提示。
 * 两端注入脚本（扩展 autoSend.ts / 桌面 auto_send.rs）的兜底文案统一带 【AskAll】 前缀。
 * 此类文本不是真实回答，UI 应展示为警示态而非回答内容。
 */
export function isFallbackNotice(text: string): boolean {
  return typeof text === 'string' && text.startsWith('【AskAll】');
}

/**
 * 写入一条历史记录（最新在前）。
 * 直接以数组形式存储，读取时用 `?? []` 兜底。
 */
export async function addHistory(
  question: string,
  aiNames: string[],
  aiUrls: { name: string; url: string }[] = [],
  conversationId?: string,
  attachments?: AttachmentInfo[],
): Promise<HistoryItem> {
  const history = await getHistory();
  const newItem: HistoryItem = {
    id: Date.now().toString(),
    question,
    timestamp: Date.now(),
    aiNames,
    aiUrls,
    conversationId,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
  history.unshift(newItem);
  // 瘦身：超出快照窗口的旧条目清除回答内容，仅保留话题 + path（支撑大量历史）
  for (let i = SNAPSHOT_KEEP; i < history.length; i++) {
    const h = history[i];
    if (h && h.answers && h.answers.length) delete h.answers;
  }
  if (history.length > MAX_ITEMS) history.length = MAX_ITEMS;
  await getPlatform().storage.setItem(HISTORY_KEY, history);
  return newItem;
}

export async function getHistory(): Promise<HistoryItem[]> {
  return (await getPlatform().storage.getItem<HistoryItem[]>(HISTORY_KEY)) ?? [];
}

/**
 * 将某条历史记录中指定 AI 的最终回答合并为快照（存在则覆盖）。
 * 文本自动截断；兜底提示文案自动标记为 error 状态。
 * 优先按 aiId 匹配；旧数据没有 id 时回退按 name 匹配。
 */
export async function mergeAnswer(
  historyId: string,
  aiId: string | undefined,
  aiName: string,
  text: string,
): Promise<void> {
  const history = await getHistory();
  const idx = history.findIndex((h) => h.id === historyId);
  const item = idx >= 0 ? history[idx] : undefined;
  if (!item) return;
  // 超出快照保留窗口的旧会话不再写回答内容（仅保留话题 + path）
  if (idx >= SNAPSHOT_KEEP) return;
  if (!item.answers) item.answers = [];
  const fallback = isFallbackNotice(text);
  let snap = item.answers.find(
    (s) => (aiId && s.aiId === aiId) || (!aiId && s.name === aiName),
  );
  if (!snap) {
    snap = {
      aiId,
      name: aiName,
      text: '',
      status: 'done',
      savedAt: Date.now(),
    };
    item.answers.push(snap);
  }
  snap.text = truncateAnswer(fallback ? '' : text);
  snap.status = fallback ? 'error' : 'done';
  snap.savedAt = Date.now();
  await getPlatform().storage.setItem(HISTORY_KEY, history);
}

/**
 * 把历史中某条记录里某个 AI 的 URL 更新为真实会话 URL。
 * 自动发送成功后，background 监听到 AI 页面跳转时会调用。
 * 优先按 aiId 匹配；旧数据没有 id 时回退按 name 匹配。
 * 同步回写 answers 快照中的 url，保证历史回放的跳转链接一致。
 */
export async function updateHistoryUrl(
  historyId: string,
  aiId: string | undefined,
  aiName: string,
  url: string,
): Promise<void> {
  const history = await getHistory();
  const item = history.find((h) => h.id === historyId);
  if (!item || !item.aiUrls) return;
  const link = item.aiUrls.find(
    (l) => (aiId && l.id === aiId) || (!aiId && l.name === aiName),
  );
  const snap = item.answers?.find(
    (s) => (aiId && s.aiId === aiId) || (!aiId && s.name === aiName),
  );
  let changed = false;
  if (link && link.url !== url) {
    link.url = url;
    changed = true;
  }
  if (snap && snap.url !== url) {
    snap.url = url;
    changed = true;
  }
  if (changed) {
    await getPlatform().storage.setItem(HISTORY_KEY, history);
  }
}

export async function clearHistory(): Promise<void> {
  await getPlatform().storage.setItem(HISTORY_KEY, []);
}

/** 会话分组视图：按 conversationId 归组（无 conversationId 的旧数据各自成组） */
export interface Conversation {
  key: string;
  /** 会话首轮问题（作为会话标题） */
  root: HistoryItem;
  /** 该会话的所有轮次（最新在前） */
  turns: HistoryItem[];
}

/**
 * 将历史记录按 conversationId 分组为会话列表。
 * 输入为 getHistory() 的结果（最新在前），输出保持会话级最新在前；
 * 每个会话内部 turns 亦为最新在前（与 HistoryPanel 既有展示逻辑一致）。
 */
export function groupConversations(history: HistoryItem[]): Conversation[] {
  const map = new Map<string, HistoryItem[]>();
  const order: string[] = [];
  for (const item of history) {
    const key = item.conversationId || item.id;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(item);
  }
  return order.map((key) => {
    const turns = map.get(key)!;
    return { key, root: turns[turns.length - 1]!, turns };
  });
}
