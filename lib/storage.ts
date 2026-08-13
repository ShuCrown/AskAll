import type {
  ChatConfig,
  ChatSession,
  GeneralSettings,
  HistoryRecord,
  PendingQuestion,
} from './types';
import { DEFAULT_CHATS } from './default-chats';
import { DEFAULT_SETTINGS } from './default-settings';

const CHATS_KEY = 'askall:chats';
const SETTINGS_KEY = 'askall:settings';
const HISTORY_KEY = 'askall:history';
const PENDING_PREFIX = 'askall:pending:tab:';

const HISTORY_LIMIT = 200;

export async function getChats(): Promise<ChatConfig[]> {
  const result = await browser.storage.local.get(CHATS_KEY);
  const stored = result[CHATS_KEY] as ChatConfig[] | undefined;
  if (!stored || !Array.isArray(stored) || stored.length === 0) {
    await browser.storage.local.set({ [CHATS_KEY]: DEFAULT_CHATS });
    return DEFAULT_CHATS;
  }
  return stored;
}

export async function saveChats(chats: ChatConfig[]): Promise<void> {
  await browser.storage.local.set({ [CHATS_KEY]: chats });
}

export async function getSettings(): Promise<GeneralSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...((result[SETTINGS_KEY] as Partial<GeneralSettings>) || {}) };
}

export async function saveSettings(settings: GeneralSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getHistory(): Promise<HistoryRecord[]> {
  const result = await browser.storage.local.get(HISTORY_KEY);
  const stored = result[HISTORY_KEY] as HistoryRecord[] | undefined;
  return Array.isArray(stored) ? stored : [];
}

export async function addHistory(record: HistoryRecord): Promise<void> {
  const history = await getHistory();
  history.unshift(record);
  const trimmed = history.slice(0, HISTORY_LIMIT);
  await browser.storage.local.set({ [HISTORY_KEY]: trimmed });
}

export async function updateHistoryRecord(
  historyId: string,
  mutate: (record: HistoryRecord) => void,
): Promise<HistoryRecord | null> {
  const history = await getHistory();
  const record = history.find((h) => h.id === historyId);
  if (!record) return null;
  mutate(record);
  await browser.storage.local.set({ [HISTORY_KEY]: history });
  return record;
}

export async function updateHistorySession(
  historyId: string,
  chatId: string,
  update: Partial<ChatSession>,
): Promise<void> {
  await updateHistoryRecord(historyId, (record) => {
    const session = record.sessions.find((s) => s.chatId === chatId);
    if (session) Object.assign(session, update);
  });
}

export async function deleteHistory(historyId: string): Promise<void> {
  const history = await getHistory();
  const filtered = history.filter((h) => h.id !== historyId);
  await browser.storage.local.set({ [HISTORY_KEY]: filtered });
}

export async function clearHistory(): Promise<void> {
  await browser.storage.local.set({ [HISTORY_KEY]: [] });
}

/** Stage a question for a tab the background is about to open. */
export async function setPendingQuestion(
  tabId: number,
  question: PendingQuestion,
): Promise<void> {
  await browser.storage.local.set({ [`${PENDING_PREFIX}${tabId}`]: question });
}

export async function getPendingQuestion(tabId: number): Promise<PendingQuestion | null> {
  const key = `${PENDING_PREFIX}${tabId}`;
  const result = await browser.storage.local.get(key);
  return (result[key] as PendingQuestion | undefined) ?? null;
}

export async function clearPendingQuestion(tabId: number): Promise<void> {
  await browser.storage.local.remove(`${PENDING_PREFIX}${tabId}`);
}
