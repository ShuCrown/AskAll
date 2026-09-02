/**
 * SearchDialog —— 弹窗式历史搜索（参考千问办公搜索面板）。
 *
 * 顶部大输入框 + 结果列表：空查询时列出最近会话，输入后按
 * 「问题标题或会话内容」过滤（匹配各轮问题文本与回答快照）。
 * 历史量大时的查看方式：
 *   - 时间分组：今天 / 昨天 / 近 7 天 / 更早；
 *   - 滚动加载：初始一页，滚到底自动加载更多（不再一次性渲染全部）；
 *   - 置顶会话固定展示在顶部，不参与分批。
 * 支持 ↑↓ 选择、Enter 打开、⌘1-9 快捷打开、Esc 关闭。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { selectConversations, useAskStore } from '../../store/askStore';
import type { Conversation } from '../../utils/history';

/** 每批加载条数 */
const PAGE = 30;

const GROUP_ORDER = ['今天', '昨天', '近 7 天', '更早'] as const;
type GroupKey = (typeof GROUP_ORDER)[number];

/** 按时间分到 今天/昨天/近7天/更早 */
function groupKey(ts: number): GroupKey {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.floor((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (dayDiff <= 0) return '今天';
  if (dayDiff === 1) return '昨天';
  if (dayDiff <= 7) return '近 7 天';
  return '更早';
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 单个结果行：标题 + 命中的轮次副标题 + 时间/轮数 + ⌘数字快捷打开 */
function SearchRow({
  r,
  idx,
  selected,
  onPick,
  onHover,
}: {
  r: { conv: Conversation; matchedTurn?: string };
  idx: number;
  selected: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={onPick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left ${
        selected ? 'bg-accent' : ''
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
      {idx < 9 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
          <kbd className="rounded border bg-muted px-1">⌘</kbd>
          <kbd className="rounded border bg-muted px-1">{idx + 1}</kbd>
        </span>
      )}
    </button>
  );
}

/** 分组标题 */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
      {children}
    </p>
  );
}

export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const history = useAskStore((s) => s.history);
  const openConversation = useAskStore((s) => s.openConversation);
  const pinned = useAskStore((s) => s.pinned);

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  // 滚动加载：当前已渲染的条目数（仅作用于非置顶分组）
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 搜索词变化时重置滚动加载分页与选中
  useEffect(() => {
    setVisibleCount(PAGE);
    setSelectedIdx(0);
  }, [query]);

  const conversations = useMemo(() => selectConversations(history), [history]);

  /** 置顶会话：空查询时展示于结果顶部（保留手动置顶的快捷入口） */
  const pinnedConvs = useMemo(() => {
    const byKey = new Map(conversations.map((c) => [c.key, c]));
    return pinned
      .map((k) => byKey.get(k))
      .filter((c): c is Conversation => !!c);
  }, [conversations, pinned]);

  /** 全部会话（不截断条数）：空查询 = 最近会话；有输入 = 命中问题/回答内容的会话 */
  const allResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { conv: Conversation; matchedTurn?: string }[] = [];
    if (!q) {
      return conversations.map((conv) => ({ conv }));
    }
    for (const conv of conversations) {
      const hit = conv.turns.find(
        (t) =>
          t.question.toLowerCase().includes(q) ||
          t.answers?.some((a) => a.text.toLowerCase().includes(q)),
      );
      if (hit) out.push({ conv, matchedTurn: hit.question });
    }
    return out;
  }, [conversations, query]);

  /** 非置顶部分按时间分组（保持组内最新在前） */
  const grouped = useMemo(() => {
    const pinnedKeys = new Set(pinnedConvs.map((c) => c.key));
    const buckets: Record<GroupKey, { conv: Conversation; matchedTurn?: string }[]> =
      { 今天: [], 昨天: [], '近 7 天': [], 更早: [] };
    for (const r of allResults) {
      if (pinnedKeys.has(r.conv.key)) continue;
      buckets[groupKey(r.conv.root.timestamp)].push(r);
    }
    return GROUP_ORDER.filter((g) => buckets[g].length > 0).map((g) => ({
      key: g,
      items: buckets[g],
    }));
  }, [allResults, pinnedConvs]);

  /** 分批后各分组实际渲染的条目 */
  const renderBuckets = useMemo(() => {
    let remaining = visibleCount;
    return grouped.map((g) => {
      const take = Math.min(g.items.length, Math.max(0, remaining));
      remaining -= take;
      return { key: g.key, visible: g.items.slice(0, take) };
    });
  }, [grouped, visibleCount]);

  /** 已渲染的扁平列表（置顶 + 各分组已加载部分），供键盘导航与选中高亮 */
  const flatRendered = useMemo(() => {
    const out: { conv: Conversation; matchedTurn?: string }[] =
      pinnedConvs.map((c) => ({ conv: c }));
    for (const b of renderBuckets) out.push(...b.visible);
    return out;
  }, [pinnedConvs, renderBuckets]);

  // 滚动到底加载更多
  const onListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      setVisibleCount((c) => c + PAGE);
    }
  };

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
      setSelectedIdx((i) => Math.min(i + 1, flatRendered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = flatRendered[selectedIdx];
      if (r) pick(r.conv.key);
      return;
    }
    // ⌘/Ctrl + 1-9 快捷打开
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      const r = flatRendered[Number(e.key) - 1];
      if (r) {
        e.preventDefault();
        pick(r.conv.key);
      }
    }
  };

  const totalCount = allResults.length + pinnedConvs.length;
  const renderedCount = flatRendered.length;

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
          <span>
            共 {totalCount} 个会话
            {renderedCount < totalCount && ` · 已显示 ${renderedCount}`}
          </span>
          <span className="text-muted-foreground/70">⌘+数字 快捷打开</span>
        </div>
        <div
          onScroll={onListScroll}
          className="max-h-[50vh] overflow-y-auto p-2"
        >
          {totalCount === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              没有匹配的会话
            </p>
          ) : (
            <>
              {pinnedConvs.length > 0 && <GroupLabel>置顶</GroupLabel>}
              {pinnedConvs.map((conv, i) => (
                <SearchRow
                  key={conv.key}
                  r={{ conv }}
                  idx={i}
                  selected={i === selectedIdx}
                  onPick={() => pick(conv.key)}
                  onHover={() => setSelectedIdx(i)}
                />
              ))}
              {renderBuckets.map((bucket) => {
                if (bucket.visible.length === 0) return null;
                return (
                  <div key={bucket.key}>
                    <GroupLabel>{bucket.key}</GroupLabel>
                    {bucket.visible.map((r) => {
                      const idx = flatRendered.findIndex(
                        (x) => x.conv.key === r.conv.key,
                      );
                      return (
                        <SearchRow
                          key={r.conv.key}
                          r={r}
                          idx={idx}
                          selected={idx === selectedIdx}
                          onPick={() => pick(r.conv.key)}
                          onHover={() => setSelectedIdx(idx)}
                        />
                      );
                    })}
                  </div>
                );
              })}
              {renderedCount < totalCount && (
                <p className="py-2 text-center text-[11px] text-muted-foreground/70">
                  滚动加载更多…
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
