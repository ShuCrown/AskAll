import { useState } from 'react';
import type { ChatConfig, ChatMode } from '@/lib/types';

interface Props {
  chat: ChatConfig;
  isNew: boolean;
  onSave: (chat: ChatConfig) => void;
  onCancel: () => void;
}

const PRESET_COLORS = [
  '#10b981', '#4285f4', '#d97757', '#4d6bfe', '#7c3aed',
  '#20808d', '#1d9bf0', '#e5484d', '#f59e0b', '#1f1f1f',
];

export function ChatEditor({ chat, isNew, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<ChatConfig>(chat);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof ChatConfig>(key: K, value: ChatConfig[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function submit() {
    if (!draft.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!draft.url.trim()) {
      setError('URL is required.');
      return;
    }
    try {
      // Will throw if invalid.
      new URL(draft.url);
    } catch {
      setError('URL must be a valid http(s) URL.');
      return;
    }
    if (draft.mode === 'url_param' && !draft.paramName?.trim()) {
      setError('URL parameter name is required for url_param mode.');
      return;
    }
    if (draft.mode === 'inject' && !draft.inputSelector?.trim()) {
      setError('Input selector is required for inject mode.');
      return;
    }
    onSave({ ...draft, name: draft.name.trim(), url: draft.url.trim() });
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{isNew ? 'Add chat' : `Edit ${chat.name}`}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="avatar-preview">
            <div
              className="chat-avatar"
              style={{ background: draft.color, width: 36, height: 36 }}
            >
              {draft.icon || '🤖'}
            </div>
            <input
              className="input"
              style={{ width: 80, textAlign: 'center', fontSize: 18 }}
              value={draft.icon}
              onChange={(e) => update('icon', e.target.value)}
              maxLength={4}
              placeholder="🤖"
              title="Emoji / glyph"
            />
            <input
              className="input"
              style={{ width: 120 }}
              value={draft.color}
              onChange={(e) => update('color', e.target.value)}
              placeholder="#10b981"
              title="Avatar color"
            />
          </div>
          <div className="form-row" style={{ gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>Colors:</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update('color', c)}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    border:
                      draft.color === c
                        ? '2px solid var(--text)'
                        : '2px solid transparent',
                    background: c,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="form-field">
            <label>Name</label>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="ChatGPT"
            />
          </div>

          <div className="form-field">
            <label>Chat URL</label>
            <input
              className="input"
              value={draft.url}
              onChange={(e) => update('url', e.target.value)}
              placeholder="https://chatgpt.com/"
            />
            <div className="hint">
              The page where you normally type a question. For a fresh chat each time, link the
              “new chat” URL when the service exposes one.
            </div>
          </div>

          <div className="form-field">
            <label>Delivery mode</label>
            <div className="radio-group">
              {(['inject', 'url_param', 'clipboard'] as ChatMode[]).map((m) => (
                <label key={m}>
                  <input
                    type="radio"
                    name="mode"
                    checked={draft.mode === m}
                    onChange={() => update('mode', m)}
                  />
                  <span>
                    {m === 'inject'
                      ? 'Auto-inject'
                      : m === 'url_param'
                        ? 'URL param'
                        : 'Clipboard'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {draft.mode === 'url_param' && (
            <div className="form-field">
              <label>Query parameter name</label>
              <input
                className="input"
                value={draft.paramName ?? ''}
                onChange={(e) => update('paramName', e.target.value)}
                placeholder="q"
              />
              <div className="hint">
                The question is appended as <code>?q=…</code>. Most search AIs use{' '}
                <code>q</code>.
              </div>
            </div>
          )}

          {draft.mode === 'inject' && (
            <>
              <div className="form-field">
                <label>Input selector (CSS)</label>
                <input
                  className="input"
                  value={draft.inputSelector ?? ''}
                  onChange={(e) => update('inputSelector', e.target.value)}
                  placeholder="#prompt-textarea, div[contenteditable='true']"
                />
                <div className="hint">
                  Comma-separated selectors are tried in order. Works for{' '}
                  <code>&lt;textarea&gt;</code> and <code>contenteditable</code> elements.
                </div>
              </div>
              <div className="form-field">
                <label>Send button selector (CSS)</label>
                <input
                  className="input"
                  value={draft.sendSelector ?? ''}
                  onChange={(e) => update('sendSelector', e.target.value)}
                  placeholder="button[data-testid='send-button']"
                />
                <div className="hint">Clicked automatically after the input is filled.</div>
              </div>
            </>
          )}

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>
              {error}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {isNew ? 'Add chat' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
