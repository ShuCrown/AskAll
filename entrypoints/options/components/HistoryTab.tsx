import { useMemo, useState } from 'react';
import type { ChatSession, HistoryRecord, SessionStatus } from '@/lib/types';

interface Props {
  history: HistoryRecord[];
  onRefresh: () => void;
  onClear: () => void;
  onDelete: (id: string) => void | Promise<void>;
  onReopen: (historyId: string, chatId: string) => void | Promise<void>;
}

export function HistoryTab({ history, onRefresh, onClear, onDelete, onReopen }: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (h) =>
        h.text.toLowerCase().includes(q) ||
        h.sourceTitle.toLowerCase().includes(q) ||
        h.sessions.some(
          (s) =>
            s.chatName.toLowerCase().includes(q) ||
            (s.responseSnippet ?? '').toLowerCase().includes(q),
        ),
    );
  }, [history, query]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <section className="section">
        <div className="section-head">
          <div>
            <h2>Question history</h2>
            <div className="sub">
              {history.length} {history.length === 1 ? 'record' : 'records'} · last 200 kept
              locally
            </div>
          </div>
          <div className="spacer" />
          <button className="btn btn-sm" onClick={onRefresh}>
            ⟳ Refresh
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => {
              if (confirm('Clear all history? This cannot be undone.')) void onClear();
            }}
            disabled={history.length === 0}
          >
            Clear all
          </button>
        </div>
        <div className="section-body">
          <div className="history-search">
            <input
              className="input"
              placeholder="Search questions, chats, or answers…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="history-list">
          {filtered.length === 0 && (
            <div className="empty">
              <div className="empty-icon">⟳</div>
              {history.length === 0
                ? 'No questions yet. Select text on any page and hit Ask All.'
                : 'No records match your search.'}
            </div>
          )}
          {filtered.map((record) => {
            const isOpen = expanded.has(record.id);
            return (
              <div key={record.id} className="history-item">
                <div
                  className="row"
                  style={{ alignItems: 'flex-start', cursor: 'pointer' }}
                  onClick={() => toggle(record.id)}
                >
                  <span style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
                    {isOpen ? '▼' : '▶'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="history-q">{record.text}</div>
                    <div className="history-meta">
                      <a href={record.sourceUrl} target="_blank" rel="noreferrer" title={record.sourceUrl}>
                        {record.sourceTitle || hostname(record.sourceUrl) || 'unknown source'}
                      </a>
                      <span>·</span>
                      <span>{timeAgo(record.createdAt)}</span>
                      <span>·</span>
                      <SessionBadges sessions={record.sessions} />
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDelete(record.id);
                    }}
                    title="Delete record"
                  >
                    ✕
                  </button>
                </div>

                {isOpen && (
                  <div className="sessions">
                    {record.sessions.map((s) => (
                      <SessionCard
                        key={s.chatId}
                        session={s}
                        onReopen={() => void onReopen(record.id, s.chatId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function SessionBadges({ sessions }: { sessions: ChatSession[] }) {
  const counts = sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});
  const order: SessionStatus[] = [
    'done',
    'sent',
    'responding',
    'sending',
    'pending',
    'skipped',
    'error',
  ];
  const visible = order.filter((s) => counts[s]);
  return (
    <span className="row" style={{ gap: 6 }}>
      {visible.map((s) => (
        <span key={s} className="row" style={{ gap: 4 }}>
          <span className={`status-dot ${s}`} />
          <span className="status-label">
            {counts[s]} {s}
          </span>
        </span>
      ))}
    </span>
  );
}

function SessionCard({
  session,
  onReopen,
}: {
  session: ChatSession;
  onReopen: () => void;
}) {
  return (
    <div className="session">
      <div className="session-head">
        <div
          className="session-avatar"
          style={{ background: session.chatColor }}
        >
          {session.chatIcon}
        </div>
        <div className="session-name">{session.chatName}</div>
        <span className={`status-dot ${session.status}`} />
        <span className="status-label">{session.status}</span>
      </div>
      {session.error && (
        <div className="session-snippet" style={{ color: 'var(--danger)' }}>
          {session.error}
        </div>
      )}
      {session.responseSnippet && (
        <div className="session-snippet">{session.responseSnippet}</div>
      )}
      {!session.responseSnippet && !session.error && (
        <div className="session-snippet muted">
          {session.status === 'done'
            ? 'Answer captured but no snippet stored.'
            : session.responseUrl
              ? 'In progress or snippet unavailable.'
              : 'Waiting to send…'}
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onReopen}
          disabled={!session.responseUrl}
          title={session.responseUrl || 'No conversation URL saved'}
        >
          ↗ Reopen
        </button>
        {session.completedAt && (
          <span className="muted" style={{ fontSize: 11 }}>
            {timeAgo(session.completedAt)}
          </span>
        )}
      </div>
    </div>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
