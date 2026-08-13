import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ChatConfig } from '@/lib/types';
import './App.css';

function App() {
  const [chats, setChats] = useState<ChatConfig[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState<number | null>(null);

  useEffect(() => {
    void api.getChats().then(setChats);
    void api.getHistory().then((h) => setRecentCount(h.length));
  }, []);

  const enabled = chats.filter((c) => c.enabled);

  function notify(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2000);
  }

  async function useSelection() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      const res = (await browser.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' })) as
        | { text?: string }
        | undefined;
      const text = res?.text?.trim();
      if (text) {
        setQuestion(text);
      } else {
        notify('No selection on this page.');
      }
    } catch {
      notify("Can't read this page (try selecting text first).");
    }
  }

  async function askAll() {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.askAll(text, '', '');
      notify(`Asked ${enabled.length} chats`);
      setQuestion('');
      setTimeout(() => window.close(), 600);
    } catch (e) {
      notify(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  async function askOne(chat: ChatConfig) {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.askOne(chat.id, text, '', '');
      notify(`Sent to ${chat.name}`);
      setQuestion('');
      setTimeout(() => window.close(), 600);
    } catch (e) {
      notify(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  function openOptions() {
    void browser.runtime.openOptionsPage();
    window.close();
  }

  return (
    <div className="popup">
      <header className="popup-head">
        <div className="brand">
          <span className="logo">🐸</span>
          <span>AskAll</span>
        </div>
        <button className="icon-btn" title="Open settings" onClick={openOptions}>
          ⚙
        </button>
      </header>

      <textarea
        className="q-input"
        placeholder="Type a question, or use the page selection…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        autoFocus
      />
      <button className="link-btn" onClick={useSelection}>
        ↧ Use current selection
      </button>

      <button
        className="primary-btn"
        onClick={askAll}
        disabled={!question.trim() || busy || enabled.length === 0}
      >
        {busy ? <span className="spinner" /> : null}
        Ask All{enabled.length > 0 ? ` · ${enabled.length}` : ''}
      </button>

      {enabled.length > 0 && (
        <>
          <div className="divider">
            <span>or pick one</span>
          </div>
          <div className="chats-grid">
            {enabled.map((c) => (
              <button
                key={c.id}
                className="chat-pill"
                title={`Ask ${c.name}`}
                onClick={() => askOne(c)}
                disabled={!question.trim() || busy}
              >
                <span
                  className="chat-dot"
                  style={{ background: c.color }}
                >
                  {c.icon}
                </span>
                <span className="chat-pill-name">{c.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {enabled.length === 0 && (
        <div className="empty-hint">
          No chats enabled.{' '}
          <button className="link-btn inline" onClick={openOptions}>
            Configure →
          </button>
        </div>
      )}

      <footer className="popup-foot">
        <span className="muted">
          {recentCount === null ? '…' : `${recentCount} in history`}
        </span>
        <button className="link-btn" onClick={openOptions}>
          Settings →
        </button>
      </footer>

      {flash && <div className="popup-toast">{flash}</div>}
    </div>
  );
}

export default App;
