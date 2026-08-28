/**
 * GridChat —— 桌面端会话聊天视图（田字格，chathub.gg 式多聊并排）。
 *
 * 提问后不再弹独立窗口：各 AI 的真实聊天页由 Rust 以 Webview attach 到主窗口，
 * 本组件把每个聊天页「摆」到内容区的田字格格子里（layout_ai_grid）。
 *
 * 交互：
 *   - 默认「田字格」：2 列网格并排展示本会话全部 AI 的聊天页；
 *   - 每个格子上部有一条独立标题栏：左侧 AI 名称，右侧「放大」按钮，
 *     点击代价格铺满整窗（其余格子隐藏），标题栏右上角变为「收起」回到田字格；
 *   - 底部追问输入框（Composer）由外层 Workspace 以独立块展示。
 *
 * 仅桌面端渲染（扩展端无 attach Webview 能力，继续用 ChatView 时间线）。
 * 格子的可视边框/骨架由 DOM 占位提供；真实页面覆盖其上（native webview 层）。
 * 每个格子的标题栏（DOM）高度为 CELL_HEADER_H，Rust 布局时把聊天页下移该高度，
 * 使标题栏露在 webview 之上、可正常点击放大/收起。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { getPlatform, type OpenMode } from '../../lib/platform';
import { useAskStore } from '../../store/askStore';
import { cn } from '../../lib/utils';
import type { AiStatus } from '../../utils/task';
import AiIcon from './AiIcon';

/** 「打开方式」存储键（与 shared App.tsx / platform-tauri 一致） */
const OPEN_MODE_KEY = 'local:openMode';

/** 会话内单个 AI 聊天页（id 可能缺失：极旧的历史数据只有 name/url） */
interface GridAi {
  id?: string;
  name: string;
  url: string;
  /** 实时状态（进行中/最近任务）；无实时任务时为空 */
  status?: AiStatus;
  answer?: string;
}

/** 每个格子顶部标题栏高度（逻辑 px = 主窗口 CSS px）。Rust 布局把聊天页下移该高度，
 *  使标题栏（AI 名称 + 放大/收起按钮）露在 native webview 之上可交互。 */
const CELL_HEADER_H = 30;

/** 聊天页相对格子的内缩（px）：native webview 是直角矩形、圆角需靠 DOM 窗口边框呈现，
 *  把 webview 四边内缩该值，露出格子的圆角边框（独立圆角窗口），并保证不超出面板区。 */
const CELL_INSET = 3;

export default function GridChat({ convKey }: { convKey: string }) {
  const activeConvId = useAskStore((s) => s.activeConvId);
  const history = useAskStore((s) => s.history);
  const liveTasks = useAskStore((s) => s.liveTasks);

  /** 放大中的 AI key（id ?? name）；null = 田字格视图 */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** 打开方式：embedded = 聊天页 attach 到主窗口网格；browser = 系统浏览器打开（不布局） */
  const [openMode, setOpenMode] = useState<OpenMode | null>(null);

  useEffect(() => {
    getPlatform()
      .storage.getItem<OpenMode>(OPEN_MODE_KEY)
      .then((v) => setOpenMode(v === 'browser' ? 'browser' : 'embedded'))
      .catch(() => setOpenMode('embedded'));
  }, []);

  // 当前会话参与过的 AI：历史侧先入表（旧轮次打底），实时任务后入表覆盖（URL 最新）
  const ais = useMemo<GridAi[]>(() => {
    if (!activeConvId) return [];
    const map = new Map<string, GridAi>();
    for (const h of [...history].reverse()) {
      if ((h.conversationId || h.id) !== activeConvId) continue;
      for (const u of h.aiUrls ?? []) {
        if (!u.url) continue;
        map.set(u.id ?? u.name, { id: u.id, name: u.name, url: u.url });
      }
    }
    // 实时任务的 results（createdAt 最新优先），覆盖 URL + 补状态/回答摘要
    const tasks = Object.values(liveTasks).filter(
      (t) => t.conversationId === activeConvId,
    );
    tasks.sort((a, b) => b.createdAt - a.createdAt);
    for (const task of tasks) {
      for (const r of Object.values(task.results)) {
        const prev = map.get(r.aiId);
        map.set(r.aiId, {
          id: r.aiId,
          name: r.aiName,
          url: r.url || prev?.url || '',
          status: r.status,
          answer: r.answer,
        });
      }
    }
    return [...map.values()].filter((a) => a.url);
  }, [activeConvId, history, liveTasks]);

  const keyOf = (a: GridAi) => a.id ?? a.name;

  // 切换会话时回到田字格视图
  useEffect(() => {
    setFocusKey(null);
  }, [activeConvId]);

  // 布局：把各聊天页摆到对应格子（放大 = focus 格铺满网格区，其余隐藏）。
  // browser 模式不注入本地网格（聊天页在系统浏览器打开），跳过布局。
  // 每个格子的聊天页 DOM/native webview 都下移 CELL_HEADER_H，腾出顶部标题栏，
  // 标题栏（AI 名称 + 放大/收起按钮）因此露在页面之上、可交互。
  useEffect(() => {
    const layoutFn = getPlatform().ask.layoutAiGrid;
    if (!layoutFn || openMode !== 'embedded') return;
    const el = gridRef.current;
    if (!el) return;

    // 无 AI（空会话/新话题）时仍调一次清空布局：隐藏所有残留的 ai-* 聊天页
    if (ais.length === 0) {
      void layoutFn([]).catch(() => {});
      return;
    }

    const apply = () => {
      const r = el.getBoundingClientRect();
      const gap = 8;
      const cells: {
        aiId: string;
        url: string;
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }[] = [];
      const focusAi = focusKey ? ais.find((a) => keyOf(a) === focusKey) : undefined;
      // 传入 Rust 的是「聊天页」rect：在完整格子位置上再往下让出标题栏高度
      const pushCell = (
        a: GridAi,
        x: number,
        y: number,
        width: number,
        height: number,
        visible: boolean,
      ) => {
        cells.push({
          aiId: keyOf(a),
          url: a.url,
          name: a.name,
          x: visible ? x + CELL_INSET : 0,
          y: visible ? y + CELL_HEADER_H + CELL_INSET : 0,
          width: visible ? Math.max(0, width - CELL_INSET * 2) : 0,
          height: visible
            ? Math.max(0, height - CELL_HEADER_H - CELL_INSET * 2)
            : 0,
        });
      };
      if (focusAi) {
        pushCell(focusAi, r.left, r.top, r.width, r.height, true);
        for (const a of ais) {
          if (keyOf(a) === focusKey) continue;
          pushCell(a, 0, 0, 0, 0, false);
        }
      } else {
        const cols = Math.min(2, Math.max(1, ais.length));
        const rows = Math.ceil(ais.length / cols);
        const w = (r.width - gap * (cols - 1)) / cols;
        const h = (r.height - gap * (rows - 1)) / rows;
        ais.forEach((a, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          pushCell(a, r.left + col * (w + gap), r.top + row * (h + gap), w, h, true);
        });
      }
      void layoutFn(cells).catch(() => {});
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ais, focusKey, activeConvId, openMode]);

  // 卸载（新话题切到空态 / 切换视图）时清空布局：隐藏所有内嵌 AI 聊天页，
  // 避免旧的 chat 窗口仍显示于主窗口之上。
  useEffect(() => {
    return () => {
      const layoutFn = getPlatform().ask.layoutAiGrid;
      if (openMode === 'embedded' && layoutFn) {
        layoutFn([]).catch(() => {});
      }
    };
  }, [openMode]);

  const visibleAis = focusKey ? ais.filter((a) => keyOf(a) === focusKey) : ais;

  return (
    <div className="flex h-full flex-col">
      {/* 田字格区：DOM 占位（骨架），真实页面由 Rust webview 覆盖（下移标题栏高度） */}
      <div ref={gridRef} className="relative min-h-0 flex-1">
        {visibleAis.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>发起提问后，这里将以田字格展示各 AI 的聊天页</p>
          </div>
        ) : focusKey && visibleAis[0] ? (
          <GridCellView
            ai={visibleAis[0]}
            embedded={openMode === 'embedded'}
            focused
            onFocus={setFocusKey}
          />
        ) : (
          <GridCells
            ais={ais}
            embedded={openMode === 'embedded'}
            onFocus={setFocusKey}
          />
        )}
      </div>
    </div>
  );
}

/** 田字格骨架容器：列/行数与 Rust 布局计算保持一致（cols=2，rows=ceil(n/2)） */
function GridCells({
  ais,
  embedded,
  onFocus,
}: {
  ais: GridAi[];
  embedded: boolean;
  onFocus: (key: string | null) => void;
}) {
  const cols = Math.min(2, Math.max(1, ais.length));
  const rows = Math.ceil(ais.length / cols);
  return (
    <div
      className="absolute inset-0 grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {ais.map((a) => (
        <GridCellView
          key={a.id ?? a.name}
          ai={a}
          embedded={embedded}
          focused={false}
          onFocus={onFocus}
        />
      ))}
    </div>
  );
}

/** 单个格子：顶部独立标题栏（AI 名称 + 放大/收起按钮），下方是聊天页。
 *  标题栏高度为 CELL_HEADER_H，Rust 布局把聊天页下移该高度，使标题栏露在
 *  native webview 之上、按钮可点击（放大铺满 / 收起回田字格）。 */
function GridCellView({
  ai,
  embedded,
  focused,
  onFocus,
}: {
  ai: GridAi;
  embedded: boolean;
  focused: boolean;
  onFocus: (key: string | null) => void;
}) {
  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card',
        focused &&
          'rounded-xl border-border shadow-[0_4px_20px_rgba(0,0,0,0.08)]',
      )}
      style={{ height: focused ? '100%' : undefined }}
    >
      {/* 标题栏：左 AI 名称，右 放大/收起 */}
      <div
        className="flex shrink-0 items-center gap-1.5 border-b px-2"
        style={{ height: CELL_HEADER_H }}
      >
        <AiIcon aiId={ai.id} name={ai.name} size={14} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {ai.name}
        </span>
        {embedded && !focused && (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
        )}
        <button
          type="button"
          onClick={() => onFocus(focused ? null : (ai.id ?? ai.name))}
          title={focused ? `收起 ${ai.name}，回到田字格` : `放大 ${ai.name}，铺满本窗口`}
          className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {focused ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* 聊天页落点：下方空白由 native webview 覆盖 */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 text-center text-[11px] text-muted-foreground">
        {embedded
          ? '聊天页加载中…'
          : '已在系统浏览器中打开，回答完成后可在此查看会话链接'}
      </div>
    </div>
  );
}