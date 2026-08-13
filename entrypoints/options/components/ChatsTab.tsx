import { useState } from 'react';
import type { ChatConfig, ChatMode } from '@/lib/types';
import { uid } from '@/lib/id';
import { ChatEditor } from './ChatEditor';

interface Props {
  chats: ChatConfig[];
  onChange: (chats: ChatConfig[]) => void | Promise<void>;
}

export function ChatsTab({ chats, onChange }: Props) {
  const [editing, setEditing] = useState<ChatConfig | null>(null);
  const [isNew, setIsNew] = useState(false);

  function toggle(chat: ChatConfig, enabled: boolean) {
    void onChange(chats.map((c) => (c.id === chat.id ? { ...c, enabled } : c)));
  }

  function remove(chat: ChatConfig) {
    if (!confirm(`Remove ${chat.name}? This cannot be undone.`)) return;
    void onChange(chats.filter((c) => c.id !== chat.id));
  }

  function startEdit(chat: ChatConfig) {
    setEditing({ ...chat });
    setIsNew(false);
  }

  function startAdd() {
    setEditing({
      id: uid('chat'),
      name: '',
      icon: '🤖',
      color: '#10b981',
      url: '',
      mode: 'inject',
      inputSelector: '',
      sendSelector: '',
      paramName: 'q',
      enabled: true,
    });
    setIsNew(true);
  }

  function save(chat: ChatConfig) {
    if (!chat.name.trim() || !chat.url.trim()) return;
    if (isNew) {
      void onChange([...chats, chat]);
    } else {
      void onChange(chats.map((c) => (c.id === chat.id ? chat : c)));
    }
    setEditing(null);
  }

  const enabledCount = chats.filter((c) => c.enabled).length;

  return (
    <>
      <section className="section">
        <div className="section-head">
          <div>
            <h2>Your chats</h2>
            <div className="sub">
              {enabledCount} of {chats.length} enabled · these receive every “Ask All”
            </div>
          </div>
          <div className="spacer" />
          <button className="btn btn-primary btn-sm" onClick={startAdd}>
            + Add chat
          </button>
        </div>
        <div className="chat-list">
          {chats.length === 0 && (
            <div className="empty">
              <div className="empty-icon">✦</div>
              No chats yet. Add one to get started.
            </div>
          )}
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`chat-card ${chat.enabled ? '' : 'disabled-row'}`}
            >
              <div className="chat-avatar" style={{ background: chat.color }}>
                {chat.icon}
              </div>
              <div className="chat-meta">
                <div className="chat-name">
                  {chat.name}
                  <span className={`badge badge-mode ${chat.mode}`}>
                    {modeLabel(chat.mode)}
                  </span>
                </div>
                <div className="chat-url">{chat.url}</div>
              </div>
              <div className="chat-actions">
                <label className="toggle" title={chat.enabled ? 'Enabled' : 'Disabled'}>
                  <input
                    type="checkbox"
                    checked={chat.enabled}
                    onChange={(e) => toggle(chat, e.target.checked)}
                  />
                  <span className="track" />
                  <span className="thumb" />
                </label>
                <button className="btn btn-ghost btn-sm" onClick={() => startEdit(chat)}>
                  Edit
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => remove(chat)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>How delivery modes work</h2>
          </div>
        </div>
        <div className="section-body" style={{ display: 'grid', gap: 12 }}>
          <ModeDoc
            badge="inject"
            title="Inject"
            desc="Opens the chat in a new tab/window, fills the input box and clicks send automatically. Best for ChatGPT, Claude, Gemini. Provide accurate CSS selectors."
          />
          <ModeDoc
            badge="url_param"
            title="URL parameter"
            desc="Appends your question as ?q=… to the chat URL. Works for search-style AIs like Perplexity or Phind. Most reliable — no DOM scraping."
          />
          <ModeDoc
            badge="clipboard"
            title="Clipboard"
            desc="Opens the chat and copies your question to the clipboard so you can paste it yourself. Safe fallback for sites that block injection."
          />
        </div>
      </section>

      {editing && (
        <ChatEditor
          chat={editing}
          isNew={isNew}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}

function modeLabel(mode: ChatMode): string {
  switch (mode) {
    case 'inject':
      return 'Auto-inject';
    case 'url_param':
      return 'URL param';
    case 'clipboard':
      return 'Clipboard';
  }
}

function ModeDoc({
  badge,
  title,
  desc,
}: {
  badge: ChatMode;
  title: string;
  desc: string;
}) {
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <span className={`badge badge-mode ${badge}`} style={{ marginTop: 2 }}>
        {modeLabel(badge)}
      </span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {desc}
        </div>
      </div>
    </div>
  );
}
