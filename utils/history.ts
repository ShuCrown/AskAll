export interface HistoryItem {
  id: string;
  question: string;
  timestamp: number;
  /** 本次提问面向的 AI 名称列表 */
  aiNames: string[];
  /** 实际打开的 AI 页面 URL，可点击跳转 */
  aiUrls: { name: string; url: string }[];
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

export async function clearHistory(): Promise<void> {
  await storage.setItem(HISTORY_KEY, []);
}
