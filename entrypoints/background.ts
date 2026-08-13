import { autoSendInjector, clipboardInjector } from '@/lib/injector';
import { uid } from '@/lib/id';
import { err, ok, type Message, type MessageResponse } from '@/lib/messaging';
import {
  addHistory,
  clearHistory,
  clearPendingQuestion,
  deleteHistory,
  getChats,
  getHistory,
  getPendingQuestion,
  getSettings,
  saveChats,
  saveSettings,
  setPendingQuestion,
  updateHistorySession,
} from '@/lib/storage';
import type { ChatConfig, ChatSession, HistoryRecord } from '@/lib/types';

export default defineBackground(() => {
  // Open the options page when the toolbar icon is clicked and there is no
  // popup registered (we ship a popup, but also expose an options entry).
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      await getChats(); // seed defaults
      await getSettings();
    }
  });

  // ---- Keyboard commands -------------------------------------------------
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'ask-all-from-selection') return;
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      const response = await browser.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' });
      const text = (response as { text?: string } | undefined)?.text?.trim();
      if (!text) return;
      await askAll(text, tab.url || '', tab.title || '');
    } catch {
      // Content script not present (e.g. on chrome:// pages) — ignore.
    }
  });

  // ---- Message router ----------------------------------------------------
  browser.runtime.onMessage.addListener(
    (msg: Message, sender, sendResponse): boolean => {
      handle(msg, sender)
        .then((res) => sendResponse(res))
        .catch((e) => sendResponse(err(String(e?.message || e))));
      return true; // async response
    },
  );

  async function handle(
    msg: Message,
    sender: Browser.runtime.MessageSender,
  ): Promise<MessageResponse> {
    switch (msg.type) {
      case 'ASK_ALL': {
        const historyId = await askAll(msg.text, msg.sourceUrl, msg.sourceTitle);
        return ok({ historyId });
      }
      case 'ASK_ONE': {
        const historyId = await askOne(msg.chatId, msg.text, msg.sourceUrl, msg.sourceTitle);
        return ok({ historyId });
      }
      case 'GET_SELECTION_FROM_ACTIVE_TAB': {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return err('no active tab');
        try {
          const res = await browser.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' });
          return ok(res as { text: string });
        } catch {
          return err('no content script on active tab');
        }
      }
      case 'SESSION_UPDATE': {
        await updateHistorySession(msg.historyId, msg.chatId, msg.update);
        return ok(null);
      }
      case 'GET_CHATS':
        return ok(await getChats());
      case 'SAVE_CHATS':
        await saveChats(msg.chats);
        return ok(null);
      case 'GET_SETTINGS':
        return ok(await getSettings());
      case 'SAVE_SETTINGS':
        await saveSettings(msg.settings);
        return ok(null);
      case 'GET_HISTORY':
        return ok(await getHistory());
      case 'DELETE_HISTORY':
        await deleteHistory(msg.historyId);
        return ok(null);
      case 'CLEAR_HISTORY':
        await clearHistory();
        return ok(null);
      case 'REOPEN_SESSION':
        return ok(await reopenSession(msg.historyId, msg.chatId));
      case 'OPEN_OPTIONS':
        await browser.runtime.openOptionsPage();
        return ok(null);
      default:
        return err('unknown message');
    }
  }

  // ---- Core orchestration ------------------------------------------------
  async function askAll(
    text: string,
    sourceUrl: string,
    sourceTitle: string,
  ): Promise<string> {
    const chats = await getChats();
    const enabled = chats.filter((c) => c.enabled);
    const historyId = uid('hist');
    const sessions: ChatSession[] = enabled.map((c) => ({
      chatId: c.id,
      chatName: c.name,
      chatIcon: c.icon,
      chatColor: c.color,
      status: 'pending',
      startedAt: Date.now(),
    }));
    const record: HistoryRecord = {
      id: historyId,
      text,
      sourceUrl,
      sourceTitle,
      createdAt: Date.now(),
      sessions,
    };
    await addHistory(record);

    // Fire all chats in parallel — they open as tabs/windows simultaneously.
    void Promise.all(
      enabled.map((chat, i) =>
        launchChat(chat, text, historyId, i, enabled.length).catch((e) => {
          void updateHistorySession(historyId, chat.id, {
            status: 'error',
            error: String(e?.message || e),
            completedAt: Date.now(),
          });
        }),
      ),
    );
    return historyId;
  }

  async function askOne(
    chatId: string,
    text: string,
    sourceUrl: string,
    sourceTitle: string,
  ): Promise<string> {
    const chats = await getChats();
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) throw new Error('chat not found');
    const historyId = uid('hist');
    const record: HistoryRecord = {
      id: historyId,
      text,
      sourceUrl,
      sourceTitle,
      createdAt: Date.now(),
      sessions: [
        {
          chatId: chat.id,
          chatName: chat.name,
          chatIcon: chat.icon,
          chatColor: chat.color,
          status: 'pending',
          startedAt: Date.now(),
        },
      ],
    };
    await addHistory(record);
    void launchChat(chat, text, historyId, 0, 1).catch((e) => {
      void updateHistorySession(historyId, chat.id, {
        status: 'error',
        error: String(e?.message || e),
        completedAt: Date.now(),
      });
    });
    return historyId;
  }

  async function launchChat(
    chat: ChatConfig,
    question: string,
    historyId: string,
    index: number,
    total: number,
  ): Promise<void> {
    const settings = await getSettings();
    await updateHistorySession(historyId, chat.id, { status: 'sending' });

    // Build the target URL.
    let targetUrl = chat.url;
    if (chat.mode === 'url_param' && chat.paramName) {
      const u = new URL(chat.url);
      u.searchParams.set(chat.paramName, question);
      targetUrl = u.toString();
    }

    // Decide where to open: a new window (optionally tiled) or a new tab.
    let tabId: number | undefined;
    let windowId: number | undefined;
    if (settings.openInWindows) {
      const win = await openTiledWindow(index, total, settings.tileWindows);
      if (!win?.id) {
        throw new Error('failed to open chat window');
      }
      windowId = win.id;
      // Create a tab inside the new window.
      const tab = await browser.tabs.create({ url: targetUrl, windowId: win.id });
      tabId = tab.id;
    } else {
      const tab = await browser.tabs.create({ url: targetUrl });
      tabId = tab.id;
    }

    await updateHistorySession(historyId, chat.id, { tabId, windowId });

    // For url_param mode the question is already in the URL — nothing to inject.
    if (chat.mode === 'url_param') {
      // Wait for the page to settle, then mark sent + capture if enabled.
      await waitTabComplete(tabId!);
      await updateHistorySession(historyId, chat.id, {
        status: 'sent',
        responseUrl: targetUrl,
      });
      await captureUrlParamAnswer(chat, historyId, tabId!, settings);
      return;
    }

    if (chat.mode === 'clipboard') {
      await waitTabComplete(tabId!);
      try {
        await browser.scripting.executeScript({
          target: { tabId: tabId! },
          func: clipboardInjector,
          args: [{ question }],
        });
      } catch {
        /* ignore — clipboard may be blocked */
      }
      await updateHistorySession(historyId, chat.id, {
        status: 'done',
        responseUrl: targetUrl,
        completedAt: Date.now(),
      });
      return;
    }

    // inject mode
    await waitTabComplete(tabId!);
    // Stage the pending question (used by the options/popup UI to show "in flight").
    await setPendingQuestion(tabId!, {
      historyId,
      chatId: chat.id,
      chatName: chat.name,
      question,
      createdAt: Date.now(),
    });

    let result;
    try {
      const [res] = await browser.scripting.executeScript({
        target: { tabId: tabId! },
        func: autoSendInjector,
        args: [
          {
            question,
            inputSelector: chat.inputSelector || '',
            sendSelector: chat.sendSelector || '',
            captureSnippet: settings.captureResponseSnippet,
            captureTimeoutMs: settings.captureTimeoutMs,
          } satisfies Parameters<typeof autoSendInjector>[0],
        ],
      });
      result = res?.result as
        | { status: 'done' | 'error'; responseUrl?: string; responseSnippet?: string; error?: string }
        | undefined;
    } catch (e) {
      await updateHistorySession(historyId, chat.id, {
        status: 'error',
        error: String((e as Error)?.message || e),
        completedAt: Date.now(),
      });
      await clearPendingQuestion(tabId!);
      return;
    }

    await clearPendingQuestion(tabId!);

    if (!result) {
      await updateHistorySession(historyId, chat.id, {
        status: 'error',
        error: 'no result from injector',
        completedAt: Date.now(),
      });
      return;
    }

    await updateHistorySession(historyId, chat.id, {
      status: result.status,
      responseUrl: result.responseUrl,
      responseSnippet: result.responseSnippet,
      error: result.error,
      completedAt: result.status === 'done' ? Date.now() : undefined,
    });

    if (settings.autoCloseOnDone && result.status === 'done') {
      try {
        if (windowId !== undefined) await browser.windows.remove(windowId);
        else await browser.tabs.remove(tabId!);
      } catch {
        /* ignore */
      }
    }
  }

  async function captureUrlParamAnswer(
    chat: ChatConfig,
    historyId: string,
    tabId: number,
    settings: Awaited<ReturnType<typeof getSettings>>,
  ): Promise<void> {
    if (!settings.captureResponseSnippet) {
      await updateHistorySession(historyId, chat.id, {
        status: 'done',
        completedAt: Date.now(),
      });
      return;
    }
    // For url_param chats (Perplexity/Phind) the answer is rendered on the
    // page after a redirect; do a best-effort late poll for a big text block.
    try {
      const [res] = await browser.scripting.executeScript({
        target: { tabId },
        func: () => {
          const main = document.querySelector('main, article, [class*="answer"], [class*="result"]');
          const text = (main?.textContent || document.body.textContent || '').trim();
          return text.slice(0, 500);
        },
      });
      const snippet = (res?.result as string | undefined) || undefined;
      await updateHistorySession(historyId, chat.id, {
        status: 'done',
        responseSnippet: snippet && snippet.length > 40 ? snippet : undefined,
        completedAt: Date.now(),
      });
    } catch {
      await updateHistorySession(historyId, chat.id, {
        status: 'done',
        completedAt: Date.now(),
      });
    }
  }

  async function reopenSession(
    historyId: string,
    chatId: string,
  ): Promise<boolean> {
    const history = await getHistory();
    const record = history.find((h) => h.id === historyId);
    const session = record?.sessions.find((s) => s.chatId === chatId);
    if (!session) return false;
    const url = session.responseUrl;
    if (!url) return false;
    await browser.tabs.create({ url });
    return true;
  }

  // ---- helpers -----------------------------------------------------------
  function waitTabComplete(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        browser.tabs.onUpdated.removeListener(listener);
        resolve(); // proceed anyway after 60s
      }, 60000);
      const listener = (id: number, info: Browser.tabs.OnUpdatedInfo) => {
        if (id === tabId && info.status === 'complete') {
          clearTimeout(timeout);
          browser.tabs.onUpdated.removeListener(listener);
          // Small grace period for SPA hydration.
          setTimeout(resolve, 800);
        }
      };
      browser.tabs.onUpdated.addListener(listener);
      // If the tab is already complete, resolve immediately.
      browser.tabs.get(tabId).then((t) => {
        if (t.status === 'complete') {
          clearTimeout(timeout);
          browser.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 800);
        }
      }).catch(reject);
    });
  }

  async function openTiledWindow(
    index: number,
    total: number,
    tile: boolean,
  ): Promise<Browser.windows.Window | undefined> {
    let area = { left: 0, top: 0, width: 1280, height: 800 };
    if (tile) {
      try {
        const last = await browser.windows.getLastFocused();
        if (last.width && last.height) {
          area = {
            left: last.left ?? 0,
            top: last.top ?? 0,
            width: last.width,
            height: last.height,
          };
        }
      } catch {
        /* ignore */
      }
      const cols = Math.ceil(Math.sqrt(total));
      const rows = Math.ceil(total / cols);
      const col = index % cols;
      const row = Math.floor(index / cols);
      const cellW = Math.floor(area.width / cols);
      const cellH = Math.floor(area.height / rows);
      return browser.windows.create({
        type: 'popup',
        left: area.left + col * cellW,
        top: area.top + row * cellH,
        width: cellW,
        height: cellH,
      });
    }
    return browser.windows.create({ type: 'popup', width: 720, height: 900 });
  }

  // Clean up pending questions when a tab is closed before the injector
  // could consume them.
  browser.tabs.onRemoved.addListener(async (tabId) => {
    const pending = await getPendingQuestion(tabId);
    if (pending) {
      await updateHistorySession(pending.historyId, pending.chatId, {
        status: 'skipped',
        completedAt: Date.now(),
      });
      await clearPendingQuestion(tabId);
    }
  });
});
