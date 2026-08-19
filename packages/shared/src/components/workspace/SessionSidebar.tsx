/**
 * SessionSidebar —— 左侧会话历史栏（千问办公式布局）。
 *
 * 顶部行 = 收起按钮 + 搜索按钮（搜索走弹窗 SearchDialog）；
 * macOS 桌面端（overlay 标题栏）下顶部行左侧为系统红绿灯预留空间，
 * 且整行作为窗口拖拽区（data-tauri-drag-region）。
 * 其下为品牌行、新话题按钮、按日期分组的会话列表、底部设置入口。
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, PanelLeftClose, Search, Settings, SquarePen } from 'lucide-react';
import { getPlatform } from '../../lib/platform';
import {
  isTaskFinished,
  selectConversations,
  useAskStore,
} from '../../store/askStore';
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

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
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
  const liveTasks = useAskStore((s) => s.liveTasks);
  const openConversation = useAskStore((s) => s.openConversation);
  const newConversation = useAskStore((s) => s.newConversation);

  const [version, setVersion] = useState('');
  const macTauri = useMemo(() => isMacTauri(), []);

  useEffect(() => {
    setVersion(getPlatform().app.getVersion());
  }, []);

  const conversations = useMemo(() => selectConversations(history), [history]);

  // 按日期分组（保持最新在前）
  const groups = useMemo(() => {
    const out: { label: string; items: Conversation[] }[] = [];
    for (const conv of conversations) {
      const label = dayLabel(conv.root.timestamp);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(conv);
      else out.push({ label, items: [conv] });
    }
    return out;
  }, [conversations]);

  const isLive = (key: string) =>
    Object.values(liveTasks).some(
      (t) => t.conversationId === key && !isTaskFinished(t),
    );

  const openSettings = () => {
    getPlatform().window.openSettings().catch(() => {});
  };

  const iconBtn =
    'flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

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

      {/* 会话列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            暂无历史会话
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-1">
              <p className="px-1.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {g.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {g.items.map((conv) => {
                  const active = conv.key === activeConvId;
                  const live = isLive(conv.key);
                  return (
                    <button
                      key={conv.key}
                      type="button"
                      onClick={() => openConversation(conv.key)}
                      className={cn(
                        'w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                        active && 'bg-secondary',
                      )}
                    >
                      <span className="flex items-start gap-1.5">
                        {live && (
                          <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin text-primary" />
                        )}
                        <span
                          className={cn(
                            'line-clamp-2 flex-1 text-xs leading-snug',
                            active
                              ? 'font-medium text-foreground'
                              : 'text-foreground/85',
                          )}
                        >
                          {conv.root.question}
                        </span>
                      </span>
                      <span className="mt-0.5 block pl-[18px] text-[10px] text-muted-foreground">
                        {timeLabel(conv.root.timestamp)}
                        {conv.turns.length > 1 && ` · ${conv.turns.length} 轮`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 底部：设置（左）+ 版本号（最右），整行默认与背景一致、悬浮 #e0e0e0 */}
      <div className="flex shrink-0 items-center justify-between px-3 py-2 transition-colors hover:bg-[#e0e0e0]">
        <button
          type="button"
          onClick={openSettings}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <Settings className="h-3.5 w-3.5" />
          设置
        </button>
        <span className="text-[10px] text-muted-foreground/60">
          v{version}
        </span>
      </div>
    </div>
  );
}
