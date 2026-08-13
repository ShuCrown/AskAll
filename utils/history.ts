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
}

const HISTORY_KEY = 'local:history';
const MAX_ITEMS = 100;

/**
 * 写入一条历史记录（最新在前）。
 * 直接以数组形式存储，读取时用 `?? []` 兜底。
 */
export async function addHistory(
  question: string,
  aiNames: string[],
  aiUrls: { name: string; url: string }[] = [],
): Promise<HistoryItem> {
  const history = await getHistory();
  const newItem: HistoryItem = {
    id: Date.now().toString(),
    question,
    timestamp: Date.now(),
    aiNames,
    aiUrls,
  };
  history.unshift(newItem);
  if (history.length > MAX_ITEMS) history.length = MAX_ITEMS;
  await storage.setItem(HISTORY_KEY, history);
  return newItem;
}

export async function getHistory(): Promise<HistoryItem[]> {
  return (await storage.getItem(HISTORY_KEY)) ?? [];
}

/**
 * 把历史中某条记录里某个 AI 的 URL 更新为真实会话 URL。
 * 自动发送成功后，background 监听到 AI 页面跳转时会调用。
 * 优先按 aiId 匹配；旧数据没有 id 时回退按 name 匹配。
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
  if (link && link.url !== url) {
    link.url = url;
    await storage.setItem(HISTORY_KEY, history);
  }
}

export async function clearHistory(): Promise<void> {
  await storage.setItem(HISTORY_KEY, []);
}
