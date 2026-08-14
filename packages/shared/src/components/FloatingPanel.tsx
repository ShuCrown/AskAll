import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Pin, Settings, X } from 'lucide-react';
import { mergeConfigs } from '../utils/aiConfig';
import type { AiConfig } from '../utils/aiConfig';
import type { AskTask, AiResult, AiStatus } from '../utils/task';
import { getPlatform } from '../lib/platform';

const AI_CONFIGS_KEY = 'local:aiConfigs';
const AUTO_SEND_KEY = 'local:autoSend';

interface FloatingPanelProps {
  text: string;
  onClose: () => void;
  position?: { left: number; top: number };
}

type PanelView = 'select' | 'result';

export default function FloatingPanel({
  text,
  onClose,
  position,
}: FloatingPanelProps) {
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<PanelView>('select');
  const [showAfterSend, setShowAfterSend] = useState(true);
  const [autoSend, setAutoSend] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [task, setTask] = useState<AskTask | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const sentRef = useRef(false);

  // 将「固定/收起」状态同步给 content script：
  // 固定或收起到小浮窗时，点击面板外部不应自动关闭面板
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('askall-panel-state', {
        detail: { pinned, minimized },
      }),
    );
  }, [pinned, minimized]);

  // 拖拽位置 & 四边调整大小
  const [pos, setPos] = useState(position ?? { left: 100, top: 100 });
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

  useEffect(() => {
    getPlatform().storage.getItem(AI_CONFIGS_KEY).then((data) => {
      // 合并默认配置：确保所有未禁用的默认 Chat 都展示
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
    getPlatform().storage.getItem('local:showResultAfterSend').then((v) => {
      if (typeof v === 'boolean') setShowAfterSend(v);
    });
    getPlatform().storage.getItem(AUTO_SEND_KEY).then((v) => {
      const val = typeof v === 'boolean' ? v : false;
      setAutoSend(val);
      // 视图由自动发送开关决定：开启→直接进结果面板；关闭→显示选择面板
      setView(val ? 'result' : 'select');
    });
  }, []);

  // 自动发送：开启时直接向所有启用的 AI 发送，并展示第二个面板（结果面板）
  useEffect(() => {
    if (!autoSend || sentRef.current || aiConfigs.length === 0) return;
    const enabled = aiConfigs.filter((ai) => ai.enabled && ai.url);
    if (enabled.length === 0) return;
    sentRef.current = true;
    getPlatform()
      .ask.ask(text, enabled.map((ai) => ai.id))
      .catch(() => {});
    setView('result');
  }, [autoSend, aiConfigs]);

  // 结果面板：先拉一次当前任务，再订阅各 AI 回复进度实时更新
  useEffect(() => {
    if (view !== 'result') return;
    getPlatform()
      .ask.getTask()
      .then(({ task }) => setTask(task))
      .catch(() => {});
    const applyReply = (msg: import('../lib/platform').ReplyMessage) => {
      setTask((prev) => {
        if (!prev || msg.taskId !== prev.id) return prev;
        const result = prev.results[msg.aiId];
        if (!result) return prev;
        const patch: Partial<AiResult> = {};
        if (msg.type === 'AI_SENDING') patch.status = 'sending';
        else if (msg.type === 'AI_REPLY') {
          patch.status = 'streaming';
          patch.answer = msg.text;
        } else if (msg.type === 'AI_REPLY_DONE') {
          patch.status = 'done';
          patch.answer = msg.text;
        }
        return {
          ...prev,
          results: {
            ...prev.results,
            [msg.aiId]: { ...result, ...patch },
          },
        };
      });
    };
    const unsub = getPlatform().ask.onReply(applyReply);
    return unsub;
  }, [view]);

  const toggleAutoSend = async (checked: boolean) => {
    await getPlatform().storage.setItem(AUTO_SEND_KEY, checked);
    setAutoSend(checked);
    // 关闭自动发送时回到选择面板，避免停留在结果面板
    if (!checked) {
      setView('select');
    }
  };

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

  const handleSend = () => {
    if (selectedList.length === 0) return;
    if (sentRef.current) return;
    sentRef.current = true;

    getPlatform()
      .ask.ask(text, selectedList.map((ai) => ai.id))
      .catch(() => {});

    if (showAfterSend) {
      setView('result');
    } else {
      onClose();
    }
  };

  // 查看原文：让平台切换到该 AI 已打开的聊天窗口，找不到才新开
  const openAiTab = (ai: AiConfig) => {
    getPlatform().ask.openAiTab(buildUrl(ai)).catch(() => {});
  };

  const togglePinned = () => setPinned((p) => !p);

  const openSettings = () => {
    getPlatform().window.openSettings().catch(() => {});
  };

  // 在结果面板手动输入新的问题，直接向已打开的聊天窗口发送，不新建标签页/弹窗
  const handleFollowUpSend = () => {
    const q = followUp.trim();
    if (!q || selectedList.length === 0) return;
    getPlatform()
      .ask.followUp(q, selectedList.map((ai) => ai.id))
      .catch(() => {});
    setFollowUp('');
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // 未勾选任何平台时回车失效，不允许发送
      if (e.key === 'Enter' && view === 'select' && selectedList.length > 0) {
        handleSend();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [view, selectedList, showAfterSend]);

  const enabledList = useMemo(
    () => aiConfigs.filter((ai) => ai.enabled && ai.url),
    [aiConfigs],
  );

  const buildUrl = (ai: AiConfig) => {
    if (ai.url.includes('{query}')) {
      return ai.url.replace(/\{query\}/g, encodeURIComponent(text));
    }
    return ai.url;
  };

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
          left: pos.left,
          top: pos.top,
          ...(view === 'result' ? { width: 560 } : {}),
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

        {/* 中间内容区：可滚动 */}
        <div style={styles.body}>
        {view === 'select' ? (
          <>
            <div style={styles.countRow}>
              <span style={styles.countText}>
                已选择 {selectedList.length}/{enabledList.length}
              </span>
              <label style={styles.autoSendLabel} title="开启后划词自动发送并直接展示结果面板">
                <span style={styles.autoSendText}>自动发送</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoSend}
                  onClick={() => toggleAutoSend(!autoSend)}
                  style={{
                    ...styles.switchTrack,
                    ...(autoSend ? styles.switchTrackOn : {}),
                  }}
                >
                  <span
                    style={{
                      ...styles.switchThumb,
                      ...(autoSend ? styles.switchThumbOn : {}),
                    }}
                  />
                </button>
              </label>
            </div>
            <div style={styles.list}>
              {enabledList.map((ai) => {
                const selected = selectedIds.has(ai.id);
                return (
                  <label
                    key={ai.id}
                    className="askall-item"
                    onClick={() => toggleAi(ai.id)}
                    style={{
                      ...styles.item,
                      ...(selected ? styles.itemSelected : {}),
                    }}
                  >
                    <span style={styles.aiName}>
                      <span
                        style={{
                          ...styles.aiIcon,
                          ...(selected ? styles.aiIconSelected : {}),
                        }}
                      >
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
                  </label>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div style={styles.questionBox}>
              <div style={styles.questionLabel}>我的问题</div>
              <div style={styles.questionText}>{text}</div>
            </div>
            <div style={styles.resultHeader}>
              <span style={styles.resultTitle}>全部回答</span>
            </div>
            <div style={styles.resultList}>
              {selectedList.map((ai) => {
                const result = task?.results?.[ai.id];
                const reply = result?.answer || '';
                const status = result?.status;
                return (
                  <div key={ai.id} style={styles.resultItem}>
                    <div style={styles.resultName}>
                      <span style={styles.aiIcon}><AiIcon ai={ai} /></span>
                      {ai.name}
                      <StatusBadge status={status} />
                      <a
                        href={buildUrl(ai)}
                        onClick={(e) => {
                          e.preventDefault();
                          openAiTab(ai);
                        }}
                        style={styles.resultLink}
                      >
                        查看原文
                      </a>
                    </div>
                    {reply ? (
                      <div style={styles.resultText}>{reply}</div>
                    ) : (
                      <div style={styles.resultStatus}>
                        {statusText(status)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
        </div>

        {/* 底部栏：发送/输入 */}
        <div style={styles.footer}>
          {view === 'select' ? (
            <div style={styles.selectFooter}>
              <button
                type="button"
                style={{
                  ...styles.sendBtn,
                  width: '100%',
                  ...(selectedList.length === 0
                    ? styles.sendBtnDisabled
                    : {}),
                }}
                onClick={handleSend}
                disabled={selectedList.length === 0}
              >
                开始提问
              </button>
              <div style={styles.footerHint}>按 Enter 发送 · Esc 关闭</div>
            </div>
          ) : (
            <>
              <input
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFollowUpSend();
                }}
                placeholder="输入追加问题，向已打开的聊天窗口发送…"
                style={styles.footerInput}
              />
              <button
                type="button"
                style={styles.composeBtn}
                onClick={handleFollowUpSend}
                disabled={!followUp.trim()}
              >
                发送
              </button>
            </>
          )}
        </div>

        {/* 底部信息栏：插件名 / 版本 / 设置（仅结果面板展示） */}
        {view === 'result' && (
          <div style={styles.infoBar}>
            <span style={styles.infoName}>齐问</span>
            <span style={styles.infoVersion}>
              v{getPlatform().app.getVersion()}
            </span>
            <button
              type="button"
              style={styles.infoSettingsBtn}
              onClick={openSettings}
              aria-label="设置"
              title="设置"
            >
              <Settings style={{ width: 14, height: 14 }} />
              设置
            </button>
          </div>
        )}

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

/** 内置 AI 图标资源映射（public/ai 下），key 为内置平台的 id */
const AI_ICON_FILES: Record<string, string> = {
  deepseek: 'deepseek.svg',
  doubao: 'doubao.svg',
  wenxin: 'wenxin.svg',
  qwen: 'qianwen.svg',
};

/** 渲染单个 AI 图标：优先使用 public/ai 下的官方图标，加载失败则回退到品牌色徽标 */
function AiIcon({ ai }: { ai: AiConfig }) {
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
    width: 280,
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
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minHeight: 0,
    // 默认（未手动缩放）时限制最大高度，避免面板超出视口；缩放增高后列表可随 body 一起增高
    maxHeight: 'calc(100vh - 160px)',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
    paddingTop: 10,
    marginTop: 10,
  },
  // 灰色背景铺满卡片底部一行；无分割线
  infoBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexShrink: 0,
    marginTop: 10,
    marginLeft: -12,
    marginRight: -12,
    marginBottom: -12,
    padding: '8px 12px',
    background: 'hsl(220 14.3% 95.9%)',
  },
  infoName: {
    fontSize: 12,
    fontWeight: 400,
    color: 'hsl(224 71.4% 4.1%)',
  },
  infoVersion: {
    fontSize: 11,
    color: 'hsl(220 8.9% 46.1% / 0.8)',
  },
  infoSettingsBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    color: 'hsl(220 8.9% 46.1%)',
    padding: '3px 6px',
    borderRadius: 6,
  },
  selectFooter: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
    width: '100%',
  },
  footerHint: {
    fontSize: 11,
    color: 'hsl(220 8.9% 46.1% / 0.7)',
    textAlign: 'center',
    userSelect: 'none',
    lineHeight: 1.4,
  },
  footerInput: {
    flex: 1,
    minWidth: 0,
    height: 34,
    padding: '0 10px',
    borderRadius: 8,
    border: '1px solid hsl(220 13% 91%)',
    background: 'hsl(0 0% 100%)',
    fontSize: 13,
    color: 'hsl(224 71.4% 4.1%)',
    outline: 'none',
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
  countRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countText: {
    fontSize: 12,
    color: 'hsl(220 8.9% 46.1%)',
  },
  autoSendLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    cursor: 'pointer',
  },
  autoSendText: {
    fontSize: 12,
    color: 'hsl(220 8.9% 46.1%)',
  },
  switchTrack: {
    width: 30,
    height: 18,
    borderRadius: 999,
    border: '1px solid hsl(220 13% 91%)',
    background: 'hsl(220 14.3% 95.9%)',
    padding: 0,
    position: 'relative',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  switchTrackOn: {
    background: 'hsl(221.2 83.2% 53.3%)',
    borderColor: 'hsl(221.2 83.2% 53.3%)',
  },
  switchThumb: {
    position: 'absolute',
    top: 1,
    left: 1,
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
    transition: 'left 0.15s',
  },
  switchThumbOn: {
    left: 13,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    // 占据 body 剩余空间：面板增高时 AI 平台列表随之增高，超高时内部滚动
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 6px',
    borderRadius: 8,
    transition: 'background 0.15s',
  },
  itemSelected: {
    background: 'hsl(221.2 83.2% 53.3% / 0.08)',
  },
  aiName: {
    fontSize: 14,
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
  aiIconSelected: {
    filter: 'none',
    opacity: 1,
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
  sendBtn: {
    padding: '0 16px',
    height: 34,
    borderRadius: 8,
    border: 'none',
    background: 'hsl(221.2 83.2% 53.3%)',
    color: 'hsl(210 40% 98%)',
    fontSize: 14,
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
  hint: {
    textAlign: 'center',
    fontSize: 12,
    color: 'hsl(220 8.9% 46.1%)',
  },
  composeBox: {
    display: 'flex',
    gap: 8,
  },
  composeInput: {
    flex: 1,
    minWidth: 0,
    height: 34,
    padding: '0 10px',
    borderRadius: 8,
    border: '1px solid hsl(220 13% 91%)',
    background: 'hsl(0 0% 100%)',
    fontSize: 13,
    color: 'hsl(224 71.4% 4.1%)',
    outline: 'none',
  },
  composeBtn: {
    height: 34,
    padding: '0 14px',
    borderRadius: 8,
    border: 'none',
    background: 'hsl(221.2 83.2% 53.3%)',
    color: 'hsl(210 40% 98%)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    flexShrink: 0,
  },
  questionBox: {
    background: 'hsl(221.2 83.2% 53.3% / 0.08)',
    borderRadius: 8,
    padding: 10,
  },
  questionLabel: {
    fontSize: 12,
    color: 'hsl(221.2 83.2% 53.3%)',
    marginBottom: 4,
  },
  questionText: {
    fontSize: 14,
    lineHeight: 1.5,
    wordBreak: 'break-word',
    color: 'hsl(224 71.4% 4.1%)',
  },
  resultHeader: {
    display: 'flex',
    gap: 12,
    borderBottom: '1px solid hsl(220 13% 91%)',
    paddingBottom: 6,
  },
  resultTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'hsl(221.2 83.2% 53.3%)',
  },
  resultList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    // 占据 body 剩余空间，随面板高度自适应
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  resultItem: {
    display: 'block',
    padding: 10,
    borderRadius: 8,
    border: '1px solid hsl(220 13% 91%)',
    color: 'inherit',
  },
  resultName: {
    fontWeight: 600,
    fontSize: 14,
    marginBottom: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: 'hsl(224 71.4% 4.1%)',
  },
  resultLink: {
    marginLeft: 'auto',
    fontSize: 12,
    fontWeight: 500,
    color: 'hsl(221.2 83.2% 53.3%)',
    textDecoration: 'none',
  },
  resultText: {
    fontSize: 13,
    lineHeight: 1.5,
    color: 'hsl(224 71.4% 4.1%)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: 160,
    overflowY: 'auto',
  },
  resultStatus: {
    fontSize: 12,
    color: 'hsl(220 8.9% 46.1%)',
  },
  resultActions: {
    display: 'flex',
    gap: 8,
  },
  secondaryBtn: {
    flex: 1,
    padding: '9px 0',
    borderRadius: 8,
    border: '1px solid hsl(220 13% 91%)',
    background: 'hsl(0 0% 100%)',
    color: 'hsl(224 71.4% 4.1%)',
    fontSize: 14,
    cursor: 'pointer',
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
