/**
 * GridChat —— 桌面端会话聊天视图（田字格，chathub.gg 式多聊并排）。
 *
 * 提问后不再弹独立窗口：各 AI 的真实聊天页由 Rust 以 Webview attach 到主窗口，
 * 本组件把每个聊天页「摆」到内容区的田字格格子里（layout_ai_grid）。
 *
 * 交互：
 *   - 默认「田字格」：2 列网格并排展示本会话全部 AI 的聊天页；
 *   - 顶部 AI 按钮 = 放大该 chat：整窗铺满（其余格子尺寸归零即隐藏），
 *     顶部出现「还原」按钮回到田字格；
 *   - 底部 Composer 用于追问（复用各 AI 已打开的聊天页）。
 *
 * 仅桌面端渲染（扩展端无 attach Webview 能力，继续用 ChatView 时间线）。
 * 格子的可视边框/骨架由 DOM 占位提供；真实页面覆盖其上（native webview 层），
 * 因此格子内部不放置任何交互控件，状态与操作统一收敛到顶部工具条。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { getPlatform, type OpenMode } from '../../lib/platform';
import { useAskStore } from '../../store/askStore';
import { cn } from '../../lib/utils';
import { isFallbackNotice } from '../../utils/history';
import type { AiStatus } from '../../utils/task';
import AiIcon from './AiIcon';
import Composer from './Composer';

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

const STATUS_DOT: Record<AiStatus, string> = {
  opening: 'bg-muted-foreground',
  sending: 'bg-blue-500',
  streaming: 'bg-amber-500',
  done: 'bg-green-500',
  error: 'bg-red-500',
};

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
  useEffect(() => {
    const el = gridRef.current;
    const layoutFn = getPlatform().ask.layoutAiGrid;
    if (!el || !layoutFn || ais.length === 0 || openMode !== 'embedded') return;

    const apply = () => {
      const r = el.getBoundingClientRect();
      const gap = 8;
      const cells = [];
      const focusAi = focusKey ? ais.find((a) => keyOf(a) === focusKey) : undefined;
      const cell = (a: GridAi, x: number, y: number, width: number, height: number) => ({
        aiId: keyOf(a),
        url: a.url,
        name: a.name,
        x,
        y,
        width,
        height,
      });
      if (focusAi) {
        cells.push(cell(focusAi, r.left, r.top, r.width, r.height));
        for (const a of ais) {
          if (keyOf(a) === focusKey) continue;
          cells.push(cell(a, 0, 0, 0, 0));
        }
      } else {
        const cols = Math.min(2, Math.max(1, ais.length));
        const rows = Math.ceil(ais.length / cols);
        const w = (r.width - gap * (cols - 1)) / cols;
        const h = (r.height - gap * (rows - 1)) / rows;
        ais.forEach((a, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          cells.push(cell(a, r.left + col * (w + gap), r.top + row * (h + gap), w, h));
        });
      }
      void layoutFn(cells).catch(() => {});
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ais, focusKey, activeConvId, openMode]);

  const visibleAis = focusKey ? ais.filter((a) => keyOf(a) === focusKey) : ais;

  return (
    <div className="flex h-full flex-col">
      {/* 顶部工具条：AI 按钮（点击放大 / 放大态还原）+ 进行中计数 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2">
        <span className="mr-1 flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {focusKey ? (
            <>
              <Minimize2 className="h-3.5 w-3.5" />
              已放大
            </>
          ) : (
            <>
              <LayoutGrid className="h-3.5 w-3.5" />
              田字格
            </>
          )}
        </span>
        {ais.map((a) => {
          const key = keyOf(a);
          const active = focusKey === key;
          const fallback = a.answer ? isFallbackNotice(a.answer) : false;
          return (
            <button
              type="button"
              key={key}
              onClick={() => setFocusKey(active ? null : key)}
              title={`${active ? '还原田字格' : `放大 ${a.name}`}\n当前地址：${a.url}`}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                active
                  ? 'bg-secondary font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <AiIcon aiId={a.id} name={a.name} size={14} />
              <span className="max-w-[110px] truncate">{a.name}</span>
              {a.status && (
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    fallback ? 'bg-red-500' : STATUS_DOT[a.status],
                  )}
                />
              )}
              {active ? (
                <Minimize2 className="h-3 w-3 shrink-0 opacity-60" />
              ) : (
                <Maximize2 className="h-3 w-3 shrink-0 opacity-60" />
              )}
            </button>
          );
        })}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          共 {ais.length} 个 AI 聊天页
        </span>
      </div>

      {/* 田字格区：DOM 占位（骨架），真实页面由 Rust webview 覆盖 */}
      <div ref={gridRef} className="relative min-h-0 flex-1">
        {visibleAis.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>发起提问后，这里将以田字格展示各 AI 的聊天页</p>
          </div>
        ) : focusKey && visibleAis[0] ? (
          <GridCellView ai={visibleAis[0]} embedded={openMode === 'embedded'} />
        ) : (
          <GridCells ais={ais} embedded={openMode === 'embedded'} />
        )}
      </div>

      {/* 追问输入：发送至所选 AI 的已打开聊天页 */}
      <div className="shrink-0 border-t px-3 py-2">
        <Composer placeholder="继续追问，将发送至所选 AI 的当前聊天页…" />
      </div>
    </div>
  );
}

/** 田字格骨架容器：列/行数与 Rust 布局计算保持一致（cols=2，rows=ceil(n/2)） */
function GridCells({ ais, embedded }: { ais: GridAi[]; embedded: boolean }) {
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
        <GridCellView key={a.id ?? a.name} ai={a} embedded={embedded} />
      ))}
    </div>
  );
}

/** 单个格子：真实页面（embedded）或提示（browser）覆盖前的占位骨架 */
function GridCellView({ ai, embedded }: { ai: GridAi; embedded: boolean }) {
  return (
    <div className="relative flex min-h-0 flex-col overflow-hidden rounded-md border bg-card">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1">
        <AiIcon aiId={ai.id} name={ai.name} size={14} />
        <span className="truncate text-xs font-medium">{ai.name}</span>
        {embedded && (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 text-center text-[11px] text-muted-foreground">
        {embedded
          ? '聊天页加载中…'
          : '已在系统浏览器中打开，回答完成后可在此查看会话链接'}
      </div>
    </div>
  );
}