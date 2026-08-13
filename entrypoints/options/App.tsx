import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ChatConfig, GeneralSettings, HistoryRecord } from '@/lib/types';
import { ChatsTab } from './components/ChatsTab';
import { HistoryTab } from './components/HistoryTab';
import { GeneralTab } from './components/GeneralTab';

type Tab = 'chats' | 'history' | 'general';

export default function App() {
  const [tab, setTab] = useState<Tab>('chats');
  const [chats, setChats] = useState<ChatConfig[] | null>(null);
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [history, setHistory] = useState<HistoryRecord[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Apply theme as early as possible.
  useEffect(() => {
    applyTheme(settings?.theme ?? 'system');
  }, [settings?.theme]);

  useEffect(() => {
    void api.getChats().then(setChats);
    void api.getSettings().then(setSettings);
  }, []);

  useEffect(() => {
    if (tab === 'history' && history === null) {
      void api.getHistory().then(setHistory);
    }
  }, [tab, history]);

  // Keep history fresh while the tab is open (answers stream in over time).
  useEffect(() => {
    if (tab !== 'history') return;
    const onChange = (_changes: unknown, area: string) => {
      if (area === 'local') void api.getHistory().then(setHistory);
    };
    browser.storage.onChanged.addListener(onChange);
    const interval = setInterval(() => {
      void api.getHistory().then(setHistory);
    }, 4000);
    return () => {
      browser.storage.onChanged.removeListener(onChange);
      clearInterval(interval);
    };
  }, [tab]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }

  const enabledCount = chats?.filter((c) => c.enabled).length ?? 0;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">🐸</span>
          <div>
            AskAll
            <small>Multi Chat AI</small>
          </div>
        </div>
        <nav className="nav">
          <button
            className={`nav-item ${tab === 'chats' ? 'active' : ''}`}
            onClick={() => setTab('chats')}
          >
            <span className="nav-icon">✦</span>
            Chats
            <span className="nav-count">{enabledCount}</span>
          </button>
          <button
            className={`nav-item ${tab === 'history' ? 'active' : ''}`}
            onClick={() => setTab('history')}
          >
            <span className="nav-icon">⟳</span>
            History
          </button>
          <button
            className={`nav-item ${tab === 'general' ? 'active' : ''}`}
            onClick={() => setTab('general')}
          >
            <span className="nav-icon">⚙</span>
            General
          </button>
        </nav>
        <div className="sidebar-footer">
          v0.1.0 · <a href="https://wxt.dev" target="_blank" rel="noreferrer">Built with WXT</a>
        </div>
      </aside>

      <main className="content">
        <header className="hero">
          <span className="eyebrow">✦ One selection · every answer</span>
          <h1>Ask anything, everywhere.</h1>
          <p>
            Highlight any text on the web and AskAll fires your question to every AI you trust —
            simultaneously, auto-sent, no extra clicks. Answers are logged for later review.
          </p>
        </header>

        {tab === 'chats' && chats && (
          <ChatsTab
            chats={chats}
            onChange={async (next) => {
              setChats(next);
              await api.saveChats(next);
              flash('Chats saved');
            }}
          />
        )}
        {tab === 'history' && history && (
          <HistoryTab
            history={history}
            onRefresh={() => void api.getHistory().then(setHistory)}
            onClear={async () => {
              await api.clearHistory();
              setHistory([]);
              flash('History cleared');
            }}
            onDelete={async (id) => {
              await api.deleteHistory(id);
              setHistory((h) => (h ?? []).filter((r) => r.id !== id));
            }}
            onReopen={async (historyId, chatId) => {
              const ok = await api.reopenSession(historyId, chatId);
              flash(ok ? 'Reopened conversation' : 'No saved URL');
            }}
          />
        )}
        {tab === 'general' && settings && (
          <GeneralTab
            settings={settings}
            onChange={async (next) => {
              setSettings(next);
              await api.saveSettings(next);
            }}
          />
        )}
        {!chats && <div className="center-screen"><span className="spinner" /> Loading…</div>}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function applyTheme(theme: 'light' | 'dark' | 'system') {
  const prefersDark =
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-color-scheme: dark)').matches;
  const effective = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  document.documentElement.setAttribute('data-theme', effective);
}
