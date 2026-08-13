import type {
  ChatConfig,
  GeneralSettings,
  HistoryRecord,
} from './types';
import type { Message, MessageResponse } from './messaging';

/** Typed wrapper around browser.runtime.sendMessage for the React UIs. */
export async function send<T = unknown>(msg: Message): Promise<T> {
  const res = (await browser.runtime.sendMessage(msg)) as MessageResponse<T>;
  if (!res || !res.ok) {
    throw new Error(res?.error || 'unknown error');
  }
  return res.data as T;
}

export const api = {
  getChats: () => send<ChatConfig[]>({ type: 'GET_CHATS' }),
  saveChats: (chats: ChatConfig[]) =>
    send<null>({ type: 'SAVE_CHATS', chats }),
  getSettings: () => send<GeneralSettings>({ type: 'GET_SETTINGS' }),
  saveSettings: (settings: GeneralSettings) =>
    send<null>({ type: 'SAVE_SETTINGS', settings }),
  getHistory: () => send<HistoryRecord[]>({ type: 'GET_HISTORY' }),
  deleteHistory: (historyId: string) =>
    send<null>({ type: 'DELETE_HISTORY', historyId }),
  clearHistory: () => send<null>({ type: 'CLEAR_HISTORY' }),
  askAll: (text: string, sourceUrl: string, sourceTitle: string) =>
    send<{ historyId: string }>({
      type: 'ASK_ALL',
      text,
      sourceUrl,
      sourceTitle,
    }),
  askOne: (
    chatId: string,
    text: string,
    sourceUrl: string,
    sourceTitle: string,
  ) =>
    send<{ historyId: string }>({
      type: 'ASK_ONE',
      chatId,
      text,
      sourceUrl,
      sourceTitle,
    }),
  reopenSession: (historyId: string, chatId: string) =>
    send<boolean>({ type: 'REOPEN_SESSION', historyId, chatId }),
};
