/**
 * FloatingPanel —— 划词/右键问答浮层（扩展端内容脚本注入；宿主页无 tailwind，全内联样式）。
 *
 * 与应用一致的「单块聊天」交互（v1.2，取代旧版 选AI→结果 两步视图）：
 *   - 上方为滚动会话区：每轮 = 右对齐问题气泡 + 各 AI 回答卡（多卡并排网格）；
 *   - 底部为单个 Composer：输入框 + 「已选 N 个 AI」浮层 + 发送（Enter 发送 / Shift+Enter 换行）；
 *   - 各 AI 页签的回复经 background 广播（AI_SENDING/AI_REPLY/AI_REPLY_DONE），
 *     按 taskId 就地流式更新到当前块；轮次乐观追加，任务经 getTask 轮询绑定；
 *   - 首次发送为新会话提问（ask），其后为向已打开聊天窗口追问（followUp）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, Minus, Pin, Settings, X } from 'lucide-react';
import { mergeConfigs } from '../utils/aiConfig';
import type { AiConfig } from '../utils/aiConfig';
import { genId, type AiResult, type AiStatus } from '../utils/task';
import { getPlatform, type ReplyMessage } from '../lib/platform';

const AI_CONFIGS_KEY = 'local:aiConfigs';

/** 面板默认宽度：回答为多卡并排，需足够宽（与桌面端多聊并排一致） */
const PANEL_WIDTH = 880;

interface FloatingPanelProps {
  /** 预填的问题（如划词文本）；为空 = 空白新话题，由用户输入后手动发送 */
  initialText?: string;
  onClose: () => void;
  position?: { left: number; top: number };
}

/** 面板内的一轮问答：乐观追加；taskId 绑定后由回复流驱动更新 */
interface PanelTurn {
  id: string;
  question: string;
  /** 后台任务 id；AI_SENDING/REPLY/AI_REPLY_DONE 按此归位到轮次 */
  taskId?: string;
  results: Record<string, AiResult>;
}

export default function FloatingPanel({
  initialText = '',
  onClose,
  position,
}: FloatingPanelProps) {
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 输入框内容（initialText 预填，可编辑） */
  const [draft, setDraft] = useState(initialText);
  /** 会话轮次（面板存续期内本地维护；历史落盘由 background 负责） */
  const [turns, setTurns] = useState<PanelTurn[]>([]);
  const [logoFailed, setLogoFailed] = useState(false);
  // 默认钉在页面上：点击面板外部不自动关闭
  const [pinned, setPinned] = useState(true);
  const [minimized, setMinimized] = useState(false);
  /** AI 选择浮层展开态 */
  const [pickerOpen, setPickerOpen] = useState(false);

  // 将「固定/收起」状态同步给 content script：
  // 固定或收起到右下角小浮窗时，点击面板外部不应自动关闭面板
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('askall-panel-state', {
        detail: { pinned, minimized },
      }),
    );
  }, [pinned, minimized]);

  // 拖拽位置 & 四边调整大小
  const [pos, setPos] = useState(position ?? { left: window.innerWidth - PANEL_WIDTH - 16, top: 56 });
  /** 是否贴右显示（默认右侧白色卡片，与应用右侧内容区一致；拖拽后自由定位） */
  const [docked, setDocked] = useState(true);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef<{
    type: 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | null;
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    origWidth: number;
    origHeight: number;
  }>({ type: null, startX: 0, startY: 0, origLeft: 0, origTop: 0, origWidth: 0, origHeight: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  const startDrag = useCallback(
    (
      type: 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
      e: React.MouseEvent,
    ) => {
      if ((e.target as HTMLElement).closest('button')) return;
      const card = cardRef.current;
      if (!card) return;
      dragRef.current = {
        type,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: pos.left,
        origTop: pos.top,
        origWidth: card.offsetWidth,
        origHeight: card.offsetHeight,
      };
      e.preventDefault();
      e.stopPropagation();
    },
    [pos],
  );

  useEffect(() => {
    const minW = 240;
    const minH = 200;
    const onMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d.type) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;

      if (d.type === 'move') {
        setDocked(false);
        setPos({
          left: Math.max(0, Math.min(d.origLeft + dx, window.innerWidth - 60)),
          top: Math.max(0, Math.min(d.origTop + dy, window.innerHeight - 40)),
        });
        return;
      }

      let { origLeft, origTop, origWidth, origHeight } = d;
      const dir = d.type;

      if (dir.includes('e')) origWidth = Math.max(minW, d.origWidth + dx);
      if (dir.includes('s')) origHeight = Math.max(minH, d.origHeight + dy);
      if (dir.includes('w')) {
        const newW = Math.max(minW, d.origWidth - dx);
        origLeft = d.origLeft + (d.origWidth - newW);
        origWidth = newW;
      }
      if (dir.includes('n')) {
        const newH = Math.max(minH, d.origHeight - dy);
        origTop = d.origTop + (d.origHeight - newH);
        origHeight = newH;
      }

      setSize({ width: origWidth, height: origHeight });
      setPos({ left: origLeft, top: origTop });
    };
    const onMouseUp = () => {
      dragRef.current.type = null;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // 加载 AI 配置：合并默认项；默认勾选启用项（或遵循 selectAllByDefault 偏好）
  useEffect(() => {
    getPlatform().storage.getItem(AI_CONFIGS_KEY).then((data) => {
      const stored = data as AiConfig[] | null;
      const configs = mergeConfigs(stored);
      setAiConfigs(configs);
      getPlatform().storage.getItem('local:selectAllByDefault').then((selectAll) => {
        const shouldSelectAll =
          typeof selectAll === 'boolean' ? selectAll : true;
        const enabled = configs.filter((ai) => ai.enabled && ai.url);
        setSelectedIds(
          new Set(shouldSelectAll ? enabled.map((ai) => ai.id) : []),
        );
      });
    });
  }, []);

  // 会话轮次与回复流：turnsRef 与 turns 严格同步（在 updater 内写入），
  // 供回复流判断「taskId 是否已绑定」；未绑定的回复先暂存，绑定后并入对应轮次。
  const turnsRef = useRef<PanelTurn[]>([]);
  const pendingByTaskRef = useRef(new Map<string, Record<string, AiResult>>());
  const updateTurns = useCallback(
    (updater: (prev: PanelTurn[]) => PanelTurn[]) => {
      setTurns((prev) => {
        const next = updater(prev);
        turnsRef.current = next;
        return next;
      });
    },
    [],
  );

  // 订阅回复流（唯一实时数据入口）：AI_REPLY/AI_REPLY_DONE 均为全量文本，替换而非追加
  useEffect(() => {
    const apply = (msg: ReplyMessage) => {
      const patch: Partial<AiResult> =
        msg.type === 'AI_SENDING'
          ? { status: 'sending' }
          : msg.type === 'AI_REPLY'
            ? {
                status: 'streaming',
                answer: msg.text,
                ...(msg.url ? { url: msg.url } : {}),
              }
            : {
                status: 'done',
                answer: msg.text,
                ...(msg.url ? { url: msg.url } : {}),
              };
      const mergeInto = (base?: AiResult): AiResult => ({
        aiId: msg.aiId,
        aiName: msg.aiName,
        status: 'opening',
        answer: '',
        ...base,
        ...patch,
      });

      if (!turnsRef.current.some((t) => t.taskId === msg.taskId)) {
        // 轮次尚未绑定 taskId（getTask 轮询间隙到达）：暂存，bindTask 时并入
        const stashed = pendingByTaskRef.current.get(msg.taskId) ?? {};
        pendingByTaskRef.current.set(msg.taskId, {
          ...stashed,
          [msg.aiId]: mergeInto(stashed[msg.aiId]),
        });
        return;
      }
      updateTurns((prev) =>
        prev.map((t) => {
          if (t.taskId !== msg.taskId) return t;
          return {
            ...t,
            results: {
              ...t.results,
              [msg.aiId]: mergeInto(t.results[msg.aiId]),
            },
          };
        }),
      );
    };
    return getPlatform().ask.onReply(apply);
  }, [updateTurns]);

  // 绑定后台任务：ask/followUp 立即返回，任务由 background 异步创建。
  // 以「发起时间 + 问题文本」双重校验，避免把上一轮的旧任务错绑到本轮。
  const bindTask = async (
    turnId: string,
    question: string,
    dispatchedAt: number,
  ) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const { task } = await getPlatform().ask.getTask();
        if (
          task &&
          task.createdAt >= dispatchedAt - 1000 &&
          task.question === question
        ) {
          const stashed = pendingByTaskRef.current.get(task.id);
          pendingByTaskRef.current.delete(task.id);
          updateTurns((prev) =>
            prev.map((t) => {
              if (t.id !== turnId) return t;
              // 后台任务快照覆盖乐观 opening；暂存的运行时回复（更实时）最后覆盖
              return {
                ...t,
                taskId: task.id,
                results: { ...t.results, ...task.results, ...(stashed ?? {}) },
              };
            }),
          );
          return;
        }
      } catch {
        /* 后台未就绪，重试 */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  // 有新轮次/新回复时把会话区滚到底部。
  // 直接设 scrollTop 而非 scrollIntoView：后者会连带滚动宿主网页。
  const bodyRef = useRef<HTMLDivElement>(null);
  const liveSignature = turns
    .map((t) =>
      Object.values(t.results)
        .map((r) => `${r.status}:${r.answer.length}`)
        .join('|'),
    )
    .join('#');
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [liveSignature, turns.length]);

  const toggleAi = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedList = useMemo(
    () => aiConfigs.filter((ai) => selectedIds.has(ai.id)),
    [aiConfigs, selectedIds],
  );

  const enabledList = useMemo(
    () => aiConfigs.filter((ai) => ai.enabled && ai.url),
    [aiConfigs],
  );

  /** 发送：乐观追加轮次并派发；首次为新会话提问，其后为追问已打开的聊天窗口 */
  const handleSend = () => {
    const q = draft.trim();
    const aiIds = selectedList.map((ai) => ai.id);
    if (!q || aiIds.length === 0) return;

    const turn: PanelTurn = {
      id: genId(),
      question: q,
      results: Object.fromEntries(
        selectedList.map((ai): [string, AiResult] => [
          ai.id,
          { aiId: ai.id, aiName: ai.name, status: 'opening', answer: '' },
        ]),
      ),
    };
    // turnsRef 此刻仍是发送前状态：长度 > 0 = 会话内已有轮次 → 追问
    const isFollowUp = turnsRef.current.length > 0;
    updateTurns((prev) => [...prev, turn]);
    setDraft('');

    const dispatchedAt = Date.now();
    const platform = getPlatform();
    const dispatch = isFollowUp
      ? platform.ask.followUp(q, aiIds)
      : platform.ask.ask(q, aiIds);
    dispatch.catch(() => {});
    void bindTask(turn.id, q, dispatchedAt);
  };

  /** 该 AI 的提问直达链接（{query} 模板以该轮问题填充） */
  const buildUrlFor = (aiId: string, question: string) => {
    const conf = aiConfigs.find((c) => c.id === aiId);
    if (!conf) return '';
    if (conf.url.includes('{query}')) {
      return conf.url.replace(/\{query\}/g, encodeURIComponent(question));
    }
    return conf.url;
  };

  // AI 选择浮层：点击面板内浮层之外关闭
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  const togglePinned = () => setPinned((p) => !p);

  const openSettings = () => {
    getPlatform().window.openSettings().catch(() => {});
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={styles.overlay} onClick={(e) => e.stopPropagation()}>
      <style>{panelCss}</style>
      {minimized ? (
        <button
          type="button"
          style={styles.miniBtn}
          onClick={() => setMinimized(false)}
          title="还原齐问面板"
        >
          {logoFailed ? (
            <span style={styles.miniLogoFallback}>齐</span>
          ) : (
            <img
              src={getPlatform().assets.assetUrl('icon/128.png')}
              alt="齐问"
              className="askall-logo-img"
              style={styles.miniLogo}
              onError={() => setLogoFailed(true)}
            />
          )}
        </button>
      ) : (
      <div
        ref={cardRef}
        style={{
          ...styles.card,
          // 默认贴右侧白色卡片；拖拽后转为 left 自由定位
          ...(docked ? { right: 16 } : { left: pos.left }),
          top: docked ? 56 : pos.top,
          width: `min(${PANEL_WIDTH}px, calc(100vw - 32px))`,
          height: 'min(560px, calc(100vh - 72px))',
          maxHeight: 'calc(100vh - 72px)',
          ...(size.width ? { width: size.width } : {}),
          ...(size.height ? { height: size.height } : {}),
        }}
      >
        {/* 顶部标题栏：可拖动 */}
        <div style={styles.header} onMouseDown={(e) => startDrag('move', e)}>
          <div style={styles.title}>
            {logoFailed ? (
              <span style={styles.logoFallback}>齐</span>
            ) : (
              <img
                src={getPlatform().assets.assetUrl('icon/128.png')}
                alt="齐问"
                className="askall-logo-img"
                style={styles.logo}
                onError={() => setLogoFailed(true)}
              />
            )}
            <span>齐问</span>
            <button
              type="button"
              style={styles.iconBtn}
              onClick={(e) => {
                e.stopPropagation();
                openSettings();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="设置"
              title="设置"
            >
              <Settings style={{ width: 14, height: 14 }} />
            </button>
          </div>
          <div style={styles.headerActions}>
            <button
              type="button"
              style={
                pinned
                  ? { ...styles.iconBtn, ...styles.iconBtnActive }
                  : styles.iconBtn
              }
              onClick={togglePinned}
              aria-label={pinned ? '取消固定' : '固定面板'}
              title={
                pinned
                  ? '取消固定（点击面板外将关闭）'
                  : '固定面板（点击面板外不关闭）'
              }
            >
              <Pin style={{ width: 16, height: 16 }} />
            </button>
            <button
              type="button"
              style={styles.iconBtn}
              onClick={() => setMinimized(true)}
              aria-label="收起到右下角"
              title="收起到右下角小浮窗"
            >
              <Minus style={{ width: 16, height: 16 }} />
            </button>
            <button
              type="button"
              style={styles.iconBtn}
              onClick={onClose}
              aria-label="关闭"
              title="关闭"
            >
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>
        </div>

        {/* 会话区：多轮问答（问题气泡 + 各 AI 回答卡），随回复流式更新 */}
        <div style={styles.body} ref={bodyRef}>
          {turns.length === 0 ? (
            <div style={styles.emptyState}>
              {logoFailed ? (
                <span style={styles.emptyLogoFallback}>齐</span>
              ) : (
                <img
                  src={getPlatform().assets.assetUrl('icon/128.png')}
                  alt="AskAll 齐问"
                  className="askall-logo-img"
                  style={styles.emptyLogo}
                  onError={() => setLogoFailed(true)}
                />
              )}
              <div style={styles.emptyTitle}>AskAll 齐问</div>
              <div style={styles.emptyDesc}>
                一个问题，同时问多个 AI。
                <br />
                输入问题并发送，回答将直接显示在这里。
              </div>
            </div>
          ) : (
            turns.map((turn) => {
              const results = Object.values(turn.results);
              return (
                <div key={turn.id} style={styles.turnBlock}>
                  {/* 问题气泡：右对齐（与应用一致） */}
                  <div style={styles.turnQRow}>
                    <div style={styles.turnBubble}>{turn.question}</div>
                  </div>
                  {/* 回答卡：多 AI 并排，单个 AI 时铺满整行 */}
                  <div
                    style={
                      results.length > 1
                        ? styles.turnGrid
                        : { ...styles.turnGrid, gridTemplateColumns: '1fr' }
                    }
                  >
                    {results.map((r) => {
                      const link = r.url || buildUrlFor(r.aiId, turn.question);
                      return (
                        <div key={r.aiId} style={styles.cell}>
                          <div style={styles.cellHeader}>
                            <span style={styles.aiIcon}>
                              <AiIcon ai={{ id: r.aiId, name: r.aiName }} />
                            </span>
                            <span style={styles.cellName}>{r.aiName}</span>
                            <StatusBadge status={r.status} />
                            <a
                              href={link}
                              onClick={(e) => {
                                e.preventDefault();
                                if (link) openAiUrl(link);
                              }}
                              style={styles.resultLink}
                            >
                              查看原文
                            </a>
                          </div>
                          <div style={styles.cellBody}>
                            {r.answer ? (
                              <div style={styles.resultText}>{r.answer}</div>
                            ) : (
                              <div style={styles.resultStatus}>
                                {statusText(r.status)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部 Composer：单个圆角框，内含输入区 + 底部操作条（AI 选择 + 发送），无分隔线 */}
        <div style={styles.footer}>
          <div style={styles.composerBox}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter 发送（Shift+Enter 换行）；输入法组合中的 Enter 不发送
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="输入问题，同时问多个 AI…"
              rows={2}
              autoFocus
              style={styles.composerInput}
            />
            <div style={styles.composerBar}>
            <div ref={pickerRef} style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                title="选择发送给哪些 AI"
                style={styles.pickerBtn}
              >
                <Bot style={{ width: 14, height: 14 }} />
                已选 {selectedList.length} 个 AI
                <ChevronDown
                  style={{
                    width: 12,
                    height: 12,
                    transform: pickerOpen ? 'rotate(180deg)' : 'none',
                  }}
                />
              </button>
              {pickerOpen && (
                <div style={styles.pickerMenu}>
                  {enabledList.map((ai) => {
                    const selected = selectedIds.has(ai.id);
                    return (
                      <div
                        key={ai.id}
                        className="askall-item"
                        onClick={() => toggleAi(ai.id)}
                        style={styles.pickerItem}
                      >
                        <span style={styles.aiName}>
                          <span style={styles.aiIcon}>
                            <AiIcon ai={ai} />
                          </span>
                          {ai.name}
                        </span>
                        <span
                          className="askall-checkbox"
                          style={{
                            ...styles.checkbox,
                            ...(selected ? styles.checkboxSelected : {}),
                          }}
                        >
                          {selected && <span style={styles.checkmark}>✓</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <span style={styles.footerHint}>Enter 发送 · Shift+Enter 换行</span>
            <button
              type="button"
              style={{
                ...styles.sendBtn,
                ...(draft.trim() && selectedList.length > 0
                  ? {}
                  : styles.sendBtnDisabled),
              }}
              onClick={handleSend}
              disabled={!draft.trim() || selectedList.length === 0}
            >
              发送
            </button>
            </div>
          </div>
        </div>

        {/* 四边 + 四角拖拽缩放 */}
        <div style={styles.resizeN} onMouseDown={(e) => startDrag('n', e)} />
        <div style={styles.resizeS} onMouseDown={(e) => startDrag('s', e)} />
        <div style={styles.resizeE} onMouseDown={(e) => startDrag('e', e)} />
        <div style={styles.resizeW} onMouseDown={(e) => startDrag('w', e)} />
        <div style={styles.resizeNE} onMouseDown={(e) => startDrag('ne', e)} />
        <div style={styles.resizeNW} onMouseDown={(e) => startDrag('nw', e)} />
        <div style={styles.resizeSE} onMouseDown={(e) => startDrag('se', e)} />
        <div style={styles.resizeSW} onMouseDown={(e) => startDrag('sw', e)} />
      </div>
      )}
    </div>
  );
}

/** 查看原文：让平台切换到该 AI 已打开的聊天窗口，找不到才新开 */
function openAiUrl(url: string) {
  getPlatform().ask.openAiTab(url).catch(() => {});
}

/** 内置 AI 图标资源映射（public/ai 下），key 为内置平台的 id */
const AI_ICON_FILES: Record<string, string> = {
  deepseek: 'deepseek.svg',
  doubao: 'doubao.svg',
  wenxin: 'wenxin.svg',
  qwen: 'qianwen.svg',
};

/** 渲染单个 AI 图标：优先使用 public/ai 下的官方图标，加载失败则回退到品牌色徽标 */
function AiIcon({ ai }: { ai: Pick<AiConfig, 'id' | 'name'> }) {
  const [failed, setFailed] = useState(false);
  const file = AI_ICON_FILES[ai.id];

  if (file && !failed) {
    const src = getPlatform().assets.assetUrl(`ai/${file}`);
    return (
      <span
        title={ai.name}
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          userSelect: 'none',
          overflow: 'hidden',
        }}
      >
        <img
          src={src}
          alt={ai.name}
          width={18}
          height={18}
          style={{ width: 18, height: 18, objectFit: 'contain' }}
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  const ch = (ai.name || 'AI').trim().charAt(0) || 'AI';
  const color = brandColor(ai.name);
  return (
    <span
      title={ai.name}
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        background: color,
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {ch}
    </span>
  );
}

/** 根据 AI 名称返回对应品牌色，未知名称使用中性灰 */
function brandColor(name: string): string {
  const l = name.toLowerCase();
  if (l.includes('deepseek')) return '#4D6BFE';
  if (l.includes('豆包') || l.includes('doubao')) return '#00C8FF';
  if (l.includes('通义') || l.includes('千问') || l.includes('qwen'))
    return '#615CED';
  if (l.includes('文心')) return '#2E2E2E';
  if (l.includes('chatgpt') || l.includes('gpt')) return '#10A37F';
  if (l.includes('claude')) return '#D97757';
  if (l.includes('gemini')) return '#4285F4';
  if (l.includes('kimi')) return '#333333';
  return '#6b7280';
}

/** 状态文案 */
function statusText(status?: AiStatus): string {
  switch (status) {
    case 'opening':
      return '正在打开页面…';
    case 'sending':
      return '正在发送…';
    case 'streaming':
      return '正在生成回答…';
    case 'error':
      return '发送失败，点击上方「查看原文」前往平台';
    default:
      return '未能获取回复，点击上方「查看原文」前往平台';
  }
}

/** 状态徽标（完成/失败显示，其余状态用文字） */
function StatusBadge({ status }: { status?: AiStatus }) {
  if (status === 'done') {
    return (
      <span
        style={{
          fontSize: 11,
          color: 'hsl(158 64% 40%)',
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        完成
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        style={{
          fontSize: 11,
          color: 'hsl(0 72% 51%)',
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        失败
      </span>
    );
  }
  return null;
}

const panelCss = `
  .askall-item { cursor: pointer; }
  .askall-item:hover { background: hsl(220 14.3% 95.9%); }
  .askall-item:hover .askall-checkbox { border-color: hsl(221.2 83.2% 53.3%); }
  /* logo 图标：彻底去除宿主网页全局样式可能注入的边框/描边/阴影 */
  .askall-logo-img {
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
    background: transparent !important;
    padding: 0 !important;
    margin: 0 !important;
    border-radius: 0 !important;
    max-width: none !important;
    max-height: none !important;
    filter: none !important;
  }
`;

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    zIndex: 2147483647,
    inset: 0,
    pointerEvents: 'none',
  },
  card: {
    position: 'fixed',
    zIndex: 2147483647,
    background: 'hsl(0 0% 100%)',
    borderRadius: 8,
    border: '1px solid hsl(220 13% 91%)',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 20px -2px rgba(0,0,0,0.08)',
    padding: 12,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    color: 'hsl(224 71.4% 4.1%)',
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'move',
    userSelect: 'none',
    flexShrink: 0,
    paddingBottom: 10,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  iconBtnActive: {
    color: 'hsl(221.2 83.2% 53.3%)',
    background: 'hsl(221.2 83.2% 53.3% / 0.12)',
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: '2px 2px 8px',
  },
  // 空态：品牌区 + 引导文案（与应用 EmptyState 一致的语气）
  emptyState: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    textAlign: 'center',
    padding: 24,
  },
  emptyLogo: {
    width: 48,
    height: 48,
    objectFit: 'contain',
    display: 'block',
    border: 'none',
    outline: 'none',
    boxShadow: 'none',
  },
  emptyLogoFallback: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: 'hsl(221.2 83.2% 53.3%)',
    color: 'hsl(210 40% 98%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    fontWeight: 700,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 600,
  },
  emptyDesc: {
    fontSize: 12,
    color: 'hsl(220 8.9% 46.1%)',
    maxWidth: 320,
    lineHeight: 1.6,
  },
  // 一轮问答：问题气泡（右对齐）+ 回答卡网格
  turnBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  turnQRow: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  turnBubble: {
    maxWidth: '75%',
    background: '#eeeeee',
    borderRadius: 12,
    padding: '8px 12px',
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'hsl(224 71.4% 4.1%)',
  },
  turnGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
  },
  // 回答卡：顶部标题栏 + 可滚动回答内容（超高时卡片内部滚动，时间线保持紧凑）
  cell: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    overflow: 'hidden',
    borderRadius: 10,
    border: '1px solid hsl(220 13% 91%)',
    background: 'hsl(0 0% 100%)',
  },
  cellHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 30,
    padding: '0 8px',
    borderBottom: '1px solid hsl(220 13% 91%)',
    flexShrink: 0,
  },
  cellName: {
    minWidth: 0,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    fontWeight: 600,
    color: 'hsl(224 71.4% 4.1%)',
  },
  cellBody: {
    padding: '8px 10px',
    overflowY: 'auto',
    maxHeight: 320,
  },
  resultLink: {
    marginLeft: 'auto',
    fontSize: 12,
    fontWeight: 500,
    color: 'hsl(221.2 83.2% 53.3%)',
    textDecoration: 'none',
    flexShrink: 0,
  },
  resultText: {
    fontSize: 13,
    lineHeight: 1.5,
    color: 'hsl(224 71.4% 4.1%)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  resultStatus: {
    fontSize: 12,
    color: 'hsl(220 8.9% 46.1%)',
  },
  // 底部 Composer
  footer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flexShrink: 0,
    paddingTop: 10,
    marginTop: 4,
  },
  // 单个圆角框：输入区 + 底部操作条同框，无分隔线（与桌面端 Composer 一致）
  composerBox: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 12,
    border: '1px solid hsl(220 13% 91%)',
    background: 'hsl(0 0% 100%)',
    padding: '8px 10px 8px',
    boxSizing: 'border-box' as const,
  },
  composerInput: {
    width: '100%',
    boxSizing: 'border-box',
    minHeight: 40,
    maxHeight: 140,
    resize: 'none',
    padding: 0,
    border: 'none',
    background: 'transparent',
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily: 'inherit',
    color: 'hsl(224 71.4% 4.1%)',
    outline: 'none',
  },
  composerBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  pickerBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 9px',
    borderRadius: 8,
    border: '1px solid hsl(220 13% 91%)',
    background: 'hsl(220 14.3% 95.9%)',
    fontSize: 12,
    color: 'hsl(224 71.4% 4.1%)',
    cursor: 'pointer',
    flexShrink: 0,
    fontFamily: 'inherit',
  },
  pickerMenu: {
    position: 'absolute',
    bottom: 'calc(100% + 6px)',
    left: 0,
    zIndex: 1,
    minWidth: 220,
    maxHeight: 260,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    background: 'hsl(0 0% 100%)',
    border: '1px solid hsl(220 13% 91%)',
    borderRadius: 10,
    padding: 4,
    boxShadow: '0 10px 20px -2px rgba(0,0,0,0.12)',
  },
  pickerItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '7px 8px',
    borderRadius: 8,
    fontSize: 13,
  },
  aiName: {
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: 'hsl(224 71.4% 4.1%)',
  },
  aiIcon: {
    fontSize: 13,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    border: '1px solid hsl(220 13% 91%)',
    background: 'hsl(0 0% 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxSelected: {
    borderColor: 'hsl(221.2 83.2% 53.3%)',
    background: 'hsl(221.2 83.2% 53.3%)',
  },
  checkmark: {
    fontSize: 10,
    lineHeight: 1,
    color: 'hsl(210 40% 98%)',
    fontWeight: 700,
  },
  footerHint: {
    fontSize: 11,
    color: 'hsl(220 8.9% 46.1% / 0.7)',
    userSelect: 'none',
    marginLeft: 'auto',
  },
  sendBtn: {
    padding: '0 16px',
    height: 30,
    borderRadius: 8,
    border: 'none',
    background: 'hsl(221.2 83.2% 53.3%)',
    color: 'hsl(210 40% 98%)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  sendBtnDisabled: {
    background: 'hsl(220 14.3% 95.9%)',
    color: 'hsl(220 8.9% 46.1% / 0.55)',
    cursor: 'not-allowed',
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontWeight: 600,
    fontSize: 15,
  },
  logo: {
    width: 24,
    height: 24,
    objectFit: 'contain',
    display: 'block',
    border: 'none',
    outline: 'none',
    boxShadow: 'none',
  },
  logoFallback: {
    width: 24,
    height: 24,
    borderRadius: 6,
    background: 'hsl(221.2 83.2% 53.3%)',
    color: 'hsl(210 40% 98%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
  },
  miniBtn: {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 2147483647,
    width: 56,
    height: 56,
    borderRadius: 16,
    border: 'none',
    background: 'transparent',
    padding: 0,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'auto',
  },
  miniLogo: {
    width: 40,
    height: 40,
    objectFit: 'contain',
    display: 'block',
    border: 'none',
    outline: 'none',
    boxShadow: 'none',
  },
  miniLogoFallback: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: 'hsl(221.2 83.2% 53.3%)',
    color: 'hsl(210 40% 98%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    fontWeight: 700,
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    padding: 4,
    borderRadius: 6,
    lineHeight: 1,
    color: 'hsl(220 8.9% 46.1%)',
  },
  resizeN: {
    position: 'absolute',
    top: -2,
    left: 8,
    right: 8,
    height: 6,
    cursor: 'ns-resize',
    pointerEvents: 'auto',
  },
  resizeS: {
    position: 'absolute',
    bottom: -2,
    left: 8,
    right: 8,
    height: 6,
    cursor: 'ns-resize',
    pointerEvents: 'auto',
  },
  resizeE: {
    position: 'absolute',
    right: -2,
    top: 8,
    bottom: 8,
    width: 6,
    cursor: 'ew-resize',
    pointerEvents: 'auto',
  },
  resizeW: {
    position: 'absolute',
    left: -2,
    top: 8,
    bottom: 8,
    width: 6,
    cursor: 'ew-resize',
    pointerEvents: 'auto',
  },
  resizeNE: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    cursor: 'nesw-resize',
    pointerEvents: 'auto',
  },
  resizeNW: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 12,
    height: 12,
    cursor: 'nwse-resize',
    pointerEvents: 'auto',
  },
  resizeSE: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    cursor: 'nwse-resize',
    pointerEvents: 'auto',
  },
  resizeSW: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 12,
    height: 12,
    cursor: 'nesw-resize',
    pointerEvents: 'auto',
  },
};
