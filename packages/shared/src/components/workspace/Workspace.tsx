/**
 * Workspace —— 工作台根组件（历史与提问合并页）。
 *
 * 无左侧历史栏、无整页顶栏：
 *   - 顶部常驻悬浮行 = 搜索 + 新话题 + 当前会话标题 + 设置。
 *     （hideTopActions 时隐藏 搜索/新话题/设置，仅保留标题；插件浮层改由
 *       PageWorkspace 标题栏承载这些动作）
 *   - 搜索统一走弹窗（SearchDialog）：空态顶部「置顶」分组 + 最近会话，
 *     输入后按问题标题或会话内容过滤。历史会话不再常驻展示，仅通过搜索找回。
 * 会话内容（卡片内）：
 *   - 桌面端：GridChat 田字格——各 AI 真实聊天页并排展示（提问不弹窗），
 *     点击顶部 AI 按钮放大单个 chat 铺满整窗，可还原回田字格；
 *   - 扩展端：ChatView 时间线（问题 + 回答卡片）。
 *
 * macOS 桌面端为 overlay 标题栏：顶部行左侧为红绿灯留空并作为窗口拖拽区。
 *
 * 生命周期职责：挂载即 hydrate（popup 重开可恢复进行中任务）、
 * 订阅 onReply 流入 store、窗口聚焦时刷新配置与历史（设置窗口改动同步）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, Settings, SquarePen } from 'lucide-react';
import { getPlatform, isMacTauri } from '../../lib/platform';
import { selectConversations, useAskStore } from '../../store/askStore';
import { cn } from '../../lib/utils';
import GridChat from './GridChat';
import ChatView from './ChatView';
import Composer from './Composer';
import EmptyState from './EmptyState';
import SearchDialog from './SearchDialog';

interface WorkspaceProps {
  /** 不渲染顶部行（插件浮层）：搜索/新话题/设置由 PageWorkspace 标题栏承载，会话标题不显示 */
  hideTopActions?: boolean;
}

export default function Workspace({ hideTopActions = false }: WorkspaceProps) {
  const hydrated = useAskStore((s) => s.hydrated);
  const activeConvId = useAskStore((s) => s.activeConvId);
  const history = useAskStore((s) => s.history);
  const hydrate = useAskStore((s) => s.hydrate);
  const applyReply = useAskStore((s) => s.applyReply);
  const refreshConfigs = useAskStore((s) => s.refreshConfigs);
  const refreshHistory = useAskStore((s) => s.refreshHistory);
  const newConversation = useAskStore((s) => s.newConversation);

  const [searchOpen, setSearchOpen] = useState(false);
  const macTauri = useMemo(() => isMacTauri(), []);

  // 挂载即 hydrate：冷启动 / popup 重开都从存储 + 当前任务重建视图
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // 订阅回复流（唯一入口进 store.applyReply）
  useEffect(() => {
    const off = getPlatform().ask.onReply((msg) => applyReply(msg));
    return off;
  }, [applyReply]);

  // 窗口聚焦：刷新配置与历史（独立设置窗口改动后的跨窗口同步兜底）
  useEffect(() => {
    const onFocus = () => {
      void refreshConfigs();
      void refreshHistory();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshConfigs, refreshHistory]);

  // 快捷键：⌘/Ctrl+K 新话题
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        newConversation();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newConversation]);

  // OS 级划词/右键菜单提问（桌面端经 platform-tauri 派发；扩展端无此事件）：
  // 切到新提问态并注入问题，由 Composer 预填（不自动发送）。
  useEffect(() => {
    const onExternalAsk = (e: Event) => {
      const detail = (e as CustomEvent).detail as { text?: string } | undefined;
      const t = detail?.text?.trim();
      if (!t) return;
      newConversation();
      useAskStore.getState().setPendingQuestion(t);
    };
    window.addEventListener('askall-external-ask', onExternalAsk);
    return () => window.removeEventListener('askall-external-ask', onExternalAsk);
  }, [newConversation]);

  const activeTitle = useMemo(() => {
    if (!activeConvId) return '新话题';
    const conv = selectConversations(history).find(
      (c) => c.key === activeConvId,
    );
    return conv?.root.question ?? '会话';
  }, [activeConvId, history]);

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  const isTauri = getPlatform().kind === 'tauri';
  const main = activeConvId ? (
    // 桌面端：田字格并排展示各 AI 聊天页（可放大单个/还原）；扩展端：时间线
    isTauri ? (
      <GridChat convKey={activeConvId} />
    ) : (
      <ChatView convKey={activeConvId} />
    )
  ) : (
    <EmptyState />
  );

  /**
   * 内容区：灰底之上四周留白的白色圆角卡片，视觉悬浮（Trae Work 式）。
   * 顶部行悬浮于卡片之上，卡片内部预留等高占位（h-14 = py-4×2 + 按钮 24px）
   * 避免内容与顶栏重叠。
   *
   * 桌面端（田字格）把「chat 区」与「底部问答输入框」拆成两块独立卡片，
   * 用 gap 隔开，互不合在一起；扩展端时间线内仍自带 Composer，不在此重复。
   */
  const bottomComposer =
    isTauri && activeConvId ? (
      <Composer placeholder="继续追问，将发送至所选 AI 的当前聊天页…" />
    ) : null;

  const mainCard = (
    <div className="absolute inset-0 flex flex-col bg-card pl-3 pt-4 pr-4">
      {/* 占位等高于悬浮顶行，避免内容与顶行重叠；插件浮层无顶行则不留占位 */}
      {!hideTopActions && <div className="h-14 shrink-0" aria-hidden="true" />}
      <div className="min-h-0 flex-1 overflow-hidden">{main}</div>
      {bottomComposer && (
        <div className="shrink-0 pb-4 pt-2">{bottomComposer}</div>
      )}
    </div>
  );

  const iconBtn =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

  const openSettings = () => {
    getPlatform().window.openSettings().catch(() => {});
  };

  /**
   * 顶部常驻悬浮行：搜索 + 新话题 + 标题 + 设置（macOS 左侧为红绿灯留空）。
   * 插件浮层（hideTopActions）完全不渲染此行：搜索/新话题/设置由 PageWorkspace
   * 标题栏承载，会话标题（含「新话题」）也不显示，内容区从卡片顶部直接开始。
   */
  const topRow = hideTopActions ? null : (
    <div
      data-tauri-drag-region
      className={cn(
        'flex shrink-0 items-center gap-1 py-4',
        macTauri ? 'pl-[74px] pr-2' : 'pl-2 pr-2',
      )}
    >
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        title="搜索历史"
        className={iconBtn}
      >
        <Search className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => newConversation()}
        title="新话题（⌘K）"
        className={iconBtn}
      >
        <SquarePen className="h-4 w-4" />
      </button>
      <span className="ml-2 truncate text-sm font-medium tracking-tight">
        {activeTitle}
      </span>
      <button
        type="button"
        onClick={openSettings}
        title="设置"
        className={cn(iconBtn, 'ml-auto')}
      >
        <Settings className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="relative flex h-full bg-background">
      <main className="relative min-w-0 flex-1">
        {mainCard}
        <div className="absolute inset-x-0 top-0 z-10">{topRow}</div>
      </main>

      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
