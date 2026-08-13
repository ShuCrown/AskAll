// Core data model for AskAll

/** How a question gets delivered to a chat. */
export type ChatMode = 'url_param' | 'inject' | 'clipboard';

/** A user-configurable chat AI target. */
export interface ChatConfig {
  id: string;
  name: string;
  /** Emoji or short glyph used as the avatar. */
  icon: string;
  /** Hex color used for the avatar chip. */
  color: string;
  /** Base URL of the chat (the page where you type a question). */
  url: string;
  /** Delivery strategy. */
  mode: ChatMode;
  /** For url_param mode: the query parameter name to carry the question. */
  paramName?: string;
  /** For inject mode: CSS selector for the input element (textarea or contenteditable). */
  inputSelector?: string;
  /** For inject mode: CSS selector for the send button. */
  sendSelector?: string;
  /** Whether this chat participates in "Ask All". */
  enabled: boolean;
}

/** Lifecycle of a single chat's response within a history record. */
export type SessionStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'responding'
  | 'done'
  | 'error'
  | 'skipped';

/** One chat's attempt to answer a history question. */
export interface ChatSession {
  chatId: string;
  chatName: string;
  chatIcon: string;
  chatColor: string;
  /** Tab id opened for this session, if any. */
  tabId?: number;
  /** Window id opened for this session, if any. */
  windowId?: number;
  status: SessionStatus;
  /** Final URL of the conversation (for re-opening later). */
  responseUrl?: string;
  /** First ~400 chars of the answer, when captured. */
  responseSnippet?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

/** A single "ask all" event, persisted for later review. */
export interface HistoryRecord {
  id: string;
  text: string;
  sourceUrl: string;
  sourceTitle: string;
  createdAt: number;
  sessions: ChatSession[];
}

/** Global, non-chat preferences. */
export interface GeneralSettings {
  /** Open each chat as a separate window instead of tabs. */
  openInWindows: boolean;
  /** Tile opened windows across the screen. */
  tileWindows: boolean;
  /** Close the chat tab/window automatically once the answer is captured. */
  autoCloseOnDone: boolean;
  /** Try to scrape the first answer chunk for the history log. */
  captureResponseSnippet: boolean;
  /** How long (ms) to wait for an answer before giving up on capture. */
  captureTimeoutMs: number;
  /** Where the selection action button appears. */
  selectionTrigger: 'fab' | 'hotkey' | 'both';
  /** Min selection length before the FAB appears. */
  minSelectionLength: number;
  /** UI theme. */
  theme: 'light' | 'dark' | 'system';
}

/** Question staged for a freshly-opened chat tab so the injector can pick it up. */
export interface PendingQuestion {
  historyId: string;
  chatId: string;
  chatName: string;
  question: string;
  createdAt: number;
}
