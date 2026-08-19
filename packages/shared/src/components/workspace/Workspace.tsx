/**
 * Workspace —— v1.1 工作台根组件（历史与提问合并页，千问办公式布局）。
 *
 * 无整页顶栏：
 *   - 侧栏展开时：侧栏顶部行 = 收起 + 搜索按钮；右侧纯内容区。
 *   - 侧栏收起时：右侧顶部行 = 展开 + 搜索按钮（+ 当前会话标题）。
 *   - 搜索统一走弹窗（SearchDialog），匹配历史会话。
 * 内容卡片顶部为会话内 chat 标签页（ChatTabs，仅桌面端）：
 *   - 「问答」为默认页——提问不弹窗，回答实际内容直接展示在时间线面板；
 *   - 各 AI tab 唤起/复用其问答页子窗口（弹窗显示），切换查看不同 chat。
 * 两种密度：
 *   - full    ：静态双栏（桌面主窗口 / 宽容器），侧栏可收起；
 *   - compact ：侧栏默认收起，展开时为覆盖式抽屉（扩展 popup 等窄容器）。
 * 未显式指定密度时按容器宽度自动判定（≥860px → full）。
 *
 * macOS 桌面端为 overlay 标题栏：顶部行左侧为红绿灯留空并作为窗口拖拽区。
 *
 * 生命周期职责：挂载即 hydrate（popup 重开可恢复进行中任务）、
 * 订阅 onReply 流入 store、窗口聚焦时刷新配置与历史（设置窗口改动同步）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanelLeftOpen, Search, SquarePen } from 'lucide-react';
import { getPlatform } from '../../lib/platform';
import { selectConversations, useAskStore } from '../../store/askStore';
import { cn } from '../../lib/utils';
import ChatTabs from './ChatTabs';
import ChatView from './ChatView';
import EmptyState from './EmptyState';
import SearchDialog from './SearchDialog';
import SessionSidebar, { isMacTauri } from './SessionSidebar';

export type WorkspaceDensity = 'full' | 'compact';

const FULL_MIN_WIDTH = 860;

export default function Workspace({
  density,
}: {
  density?: WorkspaceDensity;
}) {
  const hydrated = useAskStore((s) => s.hydrated);
  const activeConvId = useAskStore((s) => s.activeConvId);
  const history = useAskStore((s) => s.history);
  const hydrate = useAskStore((s) => s.hydrate);
  const applyReply = useAskStore((s) => s.applyReply);
  const refreshConfigs = useAskStore((s) => s.refreshConfigs);
  const refreshHistory = useAskStore((s) => s.refreshHistory);
  const newConversation = useAskStore((s) => s.newConversation);

  const containerRef = useRef<HTMLDivElement>(null);
  const [autoDensity, setAutoDensity] = useState<WorkspaceDensity>(
    density ?? 'full',
  );
  // 侧栏展开态：full 默认展开，compact 默认收起
  const [sidebarOpen, setSidebarOpen] = useState((density ?? 'full') === 'full');
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

  // 未显式指定密度时按容器宽度自动判定；密度变化时重置侧栏默认态
  const lastDensityRef = useRef<WorkspaceDensity | null>(null);
  useEffect(() => {
    const apply = (d: WorkspaceDensity) => {
      if (lastDensityRef.current !== d) {
        lastDensityRef.current = d;
        setAutoDensity(d);
        setSidebarOpen(d === 'full');
      }
    };
    if (density) {
      apply(density);
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      apply(el.clientWidth >= FULL_MIN_WIDTH ? 'full' : 'compact');
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [density, hydrated]);

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
  // 切到新提问态并注入问题，由 Composer 预填并自动发送。
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

  // 收起态下 compact 模式打开会话后自动收起抽屉
  useEffect(() => {
    if (activeConvId && autoDensity === 'compact') setSidebarOpen(false);
  }, [activeConvId, autoDensity]);

  const activeTitle = useMemo(() => {
    if (!activeConvId) return '新话题';
    const conv = selectConversations(history).find(
      (c) => c.key === activeConvId,
    );
    return conv?.root.question ?? '会话';
  }, [activeConvId, history]);

  if (!hydrated) {
    return (
      <div
        ref={containerRef}
        className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground"
      >
        加载中…
      </div>
    );
  }

  const isFull = autoDensity === 'full';
  const main = activeConvId ? (
    <ChatView convKey={activeConvId} />
  ) : (
    <EmptyState />
  );

  /**
   * 右侧内容：灰底之上四周留白的白色圆角卡片，视觉悬浮（Trae Work 式）。
   * 收起态下卡片占满整个 main 区（与展开态等高），顶部行悬浮于卡片之上，
   * 卡片内部预留等高占位（h-14 = py-4×2 + 按钮 24px）避免内容与顶栏重叠。
   */
  const mainCard = (
    <div className="absolute inset-0 p-2">
      <div className="flex h-full flex-col overflow-hidden rounded-xl bg-card shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
        {!sidebarOpen && <div className="h-14 shrink-0" aria-hidden="true" />}
        {/* 会话内 chat 标签页（仅桌面端；「问答」为默认面板内展示，AI tab 唤起弹窗） */}
        <ChatTabs />
        <div className="min-h-0 flex-1">{main}</div>
      </div>
    </div>
  );

  const iconBtn =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

  /**
   * 收起态顶部行：展开 + 搜索 + 新话题（+ 当前会话标题）。
   * 上下 16px 留白；下方为悬浮卡片，无需 border-b 分隔。
   */
  const collapsedTopRow = (
    <div
      data-tauri-drag-region
      className={cn(
        'flex shrink-0 items-center gap-1 py-4',
        macTauri ? 'pl-[74px] pr-2' : 'pl-2 pr-2',
      )}
    >
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        title="展开侧栏"
        className={iconBtn}
      >
        <PanelLeftOpen className="h-4 w-4" />
      </button>
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
    </div>
  );

  /** 收起态顶栏：悬浮在白色卡片上方（透明背景） */
  const floatingTopRow = !sidebarOpen && (
    <div className="absolute inset-x-0 top-0 z-10">{collapsedTopRow}</div>
  );

  return (
    <div ref={containerRef} className="relative flex h-full bg-background">
      {isFull ? (
        <>
          {sidebarOpen && (
            <aside className="w-[240px] shrink-0">
              <SessionSidebar
                onCollapse={() => setSidebarOpen(false)}
                onSearch={() => setSearchOpen(true)}
              />
            </aside>
          )}
          <main className="relative min-w-0 flex-1">
            {mainCard}
            {floatingTopRow}
          </main>
        </>
      ) : (
        <>
          <main className="relative h-full min-w-0 flex-1">
            {mainCard}
            {floatingTopRow}
          </main>

          {/* compact：侧栏为覆盖式抽屉 */}
          {sidebarOpen && (
            <>
              <div
                className="absolute inset-0 z-30 bg-black/20"
                onClick={() => setSidebarOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 z-40 w-[260px] bg-background shadow-lg">
                <SessionSidebar
                  onCollapse={() => setSidebarOpen(false)}
                  onSearch={() => setSearchOpen(true)}
                />
              </div>
            </>
          )}
        </>
      )}

      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
