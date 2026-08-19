/**
 * SearchDialog —— 弹窗式历史搜索（参考千问办公搜索面板）。
 *
 * 顶部大输入框 + 结果列表：空查询时列出最近会话，输入后按
 * 「问题标题或会话内容」过滤（匹配各轮问题文本与回答快照）。
 * 支持 ↑↓ 选择、Enter 打开、⌘1-9 快捷打开、Esc 关闭。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { selectConversations, useAskStore } from '../../store/askStore';
import type { Conversation } from '../../utils/history';

const MAX_RESULTS = 20;

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const history = useAskStore((s) => s.history);
  const openConversation = useAskStore((s) => s.openConversation);

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const conversations = useMemo(() => selectConversations(history), [history]);

  /** 命中信息：命中的轮次问题（非首轮时作为副标题展示） */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { conv: Conversation; matchedTurn?: string }[] = [];
    for (const conv of conversations) {
      if (!q) {
        out.push({ conv });
      } else {
        const hit = conv.turns.find(
          (t) =>
            t.question.toLowerCase().includes(q) ||
            t.answers?.some((a) => a.text.toLowerCase().includes(q)),
        );
        if (hit) out.push({ conv, matchedTurn: hit.question });
      }
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }, [conversations, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const pick = (key: string) => {
    openConversation(key);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[selectedIdx];
      if (r) pick(r.conv.key);
      return;
    }
    // ⌘/Ctrl + 1-9 快捷打开
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      const r = results[Number(e.key) - 1];
      if (r) {
        e.preventDefault();
        pick(r.conv.key);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/20"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="mx-auto mt-10 flex w-[min(640px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border bg-card shadow-xl"
        onKeyDown={onKeyDown}
      >
        {/* 输入行 */}
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索问题标题或会话内容…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* 结果列表 */}
        <div className="flex items-center justify-between px-4 pt-2 text-xs text-muted-foreground">
          <span>共 {results.length} 个会话</span>
          <span className="text-muted-foreground/70">⌘+数字 快捷打开</span>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              没有匹配的会话
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.conv.key}
                type="button"
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => pick(r.conv.key)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left ${
                  i === selectedIdx ? 'bg-accent' : ''
                }`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full border border-muted-foreground/50" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground/90">
                    {r.conv.root.question}
                  </span>
                  {r.matchedTurn && r.matchedTurn !== r.conv.root.question && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {r.matchedTurn}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {timeLabel(r.conv.root.timestamp)}
                  {r.conv.turns.length > 1 && ` · ${r.conv.turns.length} 轮`}
                </span>
                {i < 9 && (
                  <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                    <kbd className="rounded border bg-muted px-1">⌘</kbd>
                    <kbd className="rounded border bg-muted px-1">{i + 1}</kbd>
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
