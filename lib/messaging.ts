import type { ChatConfig, ChatSession, GeneralSettings, HistoryRecord } from './types';

/**
 * All messages exchanged between content scripts, the popup, the options page,
 * and the background service worker. Keep this as a discriminated union so
 * senders/receivers stay type-safe.
 */
export type Message =
  // From content (selection) / popup / options -> background
  | {
      type: 'ASK_ALL';
      text: string;
      sourceUrl: string;
      sourceTitle: string;
    }
  | {
      type: 'ASK_ONE';
      chatId: string;
      text: string;
      sourceUrl: string;
      sourceTitle: string;
    }
  // From content (hotkey path) -> background
  | { type: 'GET_SELECTION_FROM_ACTIVE_TAB' }
  // From injector (page) -> background
  | {
      type: 'INJECTOR_READY';
      tabId: number;
    }
  | {
      type: 'SESSION_UPDATE';
      historyId: string;
      chatId: string;
      update: Partial<ChatSession>;
    }
  // From anywhere -> background (storage reads/writes)
  | { type: 'GET_CHATS' }
  | { type: 'SAVE_CHATS'; chats: ChatConfig[] }
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: GeneralSettings }
  | { type: 'GET_HISTORY' }
  | { type: 'DELETE_HISTORY'; historyId: string }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'REOPEN_SESSION'; historyId: string; chatId: string }
  | { type: 'OPEN_OPTIONS' };

export type MessageResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): MessageResponse<T> {
  return { ok: true, data };
}

export function err(error: string): MessageResponse<never> {
  return { ok: false, error };
}
