/**
 * SessionSidebar —— 左侧会话历史栏（千问办公式布局）。
 *
 * 顶部行 = 收起按钮 + 搜索按钮（搜索走弹窗 SearchDialog）；
 * macOS 桌面端（overlay 标题栏）下顶部行左侧为系统红绿灯预留空间，
 * 且整行作为窗口拖拽区（data-tauri-drag-region）。
 * 其下为品牌行、新话题按钮、会话列表（置顶分组 + 按日期分组）、底部设置入口。
 *
 * 会话行：只展示话题文字；悬浮时左侧浮现置顶图标、右侧浮现更新时间提示；
 * 已置顶的话题固定显示置顶图标（点击取消置顶），置顶项排序在列表最上方。
 */
import { useMemo, useState } from 'react';
import {
  PanelLeftClose,
  Pin,
  Search,
  Settings,
  SquarePen,
} from 'lucide-react';
import { getPlatform } from '../../lib/platform';
import { selectConversations, useAskStore } from '../../store/askStore';
import type { Conversation } from '../../utils/history';
import { cn } from '../../lib/utils';

/** macOS + Tauri：overlay 标题栏下需为红绿灯预留左侧空间 */
export function isMacTauri(): boolean {
  return (
    getPlatform().kind === 'tauri' &&
    typeof navigator !== 'undefined' &&
    /Mac/i.test(navigator.platform)
  );
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 更新时间提示：今天仅时分，昨天带「昨天」，更早带日期 */
function updateTimeLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  const hhmm = d.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (diff === 0) return `更新于 ${hhmm}`;
  if (diff === 1) return `更新于 昨天 ${hhmm}`;
  return `更新于 ${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

/** 单个会话行：只展示话题文字；悬浮显示置顶图标（左）与更新时间（右） */
function ConvRow({
  conv,
  pinned,
  active,
  onOpen,
  onTogglePin,
}: {
  conv: Conversation;
  pinned: boolean;
  active: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1.5 transition-colors hover:bg-accent',
        active && 'bg-secondary',
      )}
    >
      {/* 置顶图标：使用同一个图标，置顶时始终显示，未置顶时悬浮显示 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        title={pinned ? '取消置顶' : '置顶'}
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground',
          pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <Pin className="h-3 w-3" fill="currentColor" />
      </button>

      <span
        className={cn(
          'line-clamp-2 flex-1 text-xs leading-snug',
          active ? 'font-medium text-foreground' : 'text-foreground/85',
        )}
      >
        {conv.root.question}
      </span>

      {/* 悬浮时间提示 */}
      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        {updateTimeLabel(conv.root.timestamp)}
      </span>
    </div>
  );
}

export default function SessionSidebar({
  onCollapse,
  onSearch,
}: {
  /** 收起左侧栏（未提供时不渲染收起按钮，如抽屉场景） */
  onCollapse?: () => void;
  /** 打开搜索弹窗 */
  onSearch: () => void;
}) {
  const history = useAskStore((s) => s.history);
  const activeConvId = useAskStore((s) => s.activeConvId);
  const openConversation = useAskStore((s) => s.openConversation);
  const newConversation = useAskStore((s) => s.newConversation);
  const pinned = useAskStore((s) => s.pinned);
  const togglePin = useAskStore((s) => s.togglePin);

  const macTauri = useMemo(() => isMacTauri(), []);

  const conversations = useMemo(() => selectConversations(history), [history]);

  // 置顶分组 + 普通分组（按日期）
  const { pinnedConvs, groups } = useMemo(() => {
    const byKey = new Map(conversations.map((c) => [c.key, c]));
    const pinnedConvs = pinned
      .map((k) => byKey.get(k))
      .filter((c): c is Conversation => !!c);
    const rest = conversations.filter((c) => !pinned.includes(c.key));
    const out: { label: string; items: Conversation[] }[] = [];
    for (const conv of rest) {
      const label = dayLabel(conv.root.timestamp);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(conv);
      else out.push({ label, items: [conv] });
    }
    return { pinnedConvs, groups: out };
  }, [conversations, pinned]);

  const openSettings = () => {
    getPlatform().window.openSettings().catch(() => {});
  };

  const iconBtn =
    'flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

  const renderConvs = (items: Conversation[]) =>
    items.map((conv) => (
      <ConvRow
        key={conv.key}
        conv={conv}
        pinned={pinned.includes(conv.key)}
        active={conv.key === activeConvId}
        onOpen={() => openConversation(conv.key)}
        onTogglePin={() => togglePin(conv.key)}
      />
    ));

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 顶部行：收起 + 搜索，上下 16px 留白；macOS 桌面端左侧为红绿灯留空（与红绿灯 x=16 对齐） */}
      <div
        data-tauri-drag-region
        className={cn(
          'flex shrink-0 items-center gap-1 py-4',
          macTauri ? 'pl-[74px] pr-2' : 'px-2',
        )}
      >
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            title="收起侧栏"
            className={iconBtn}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onSearch}
          title="搜索历史"
          className={iconBtn}
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      {/* 品牌行 */}
      <div className="flex items-center gap-1.5 px-3 pt-1">
        <img
          src={getPlatform().assets.assetUrl('icon/128.png')}
          alt="AskAll 齐问"
          className="h-5 w-5 rounded-[5px]"
        />
        <span className="text-sm font-semibold tracking-tight">
          AskAll 齐问
        </span>
      </div>

      {/* 新话题（默认与侧栏背景一致，悬浮 #e0e0e0） */}
      <div className="px-3 pt-2">
        <button
          type="button"
          onClick={() => newConversation()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-[#e0e0e0]"
        >
          <SquarePen className="h-4 w-4" />
          新话题
          <span className="ml-auto text-xs text-muted-foreground/70">
            ⌘K
          </span>
        </button>
      </div>

      {/* 会话列表：置顶分组 + 按日期分组 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {conversations.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            暂无历史会话
          </p>
        ) : (
          <>
            {pinnedConvs.length > 0 && (
              <div className="mb-1">
                <p className="px-1.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  置顶
                </p>
                <div className="flex flex-col gap-0.5">
                  {renderConvs(pinnedConvs)}
                </div>
              </div>
            )}
            {groups.map((g) => (
              <div key={g.label} className="mb-1">
                <p className="px-1.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {g.label}
                </p>
                <div className="flex flex-col gap-0.5">
                  {renderConvs(g.items)}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* 底部：设置（悬浮样式与新话题一致） */}
      <div className="px-3 py-2">
        <button
          type="button"
          onClick={openSettings}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-[#e0e0e0]"
        >
          <Settings className="h-4 w-4" />
          设置
        </button>
      </div>
    </div>
  );
}
