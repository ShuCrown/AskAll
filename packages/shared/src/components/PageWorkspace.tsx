/**
 * PageWorkspace —— 网页内浮层版工作台（扩展端内容脚本注入；宿主页无 tailwind）。
 *
 * 与 popup / 桌面端共用同一个 Workspace 组件，交互完全一致；差别仅在展示载体：
 * 插件的 AI 聊天开在浏览器页签里，回答以时间线卡片展示；桌面端把聊天页内嵌在
 * chat 块（GridChat）里。
 *
 * 本组件只负责「浮层卡片」的壳（默认白底 + 拖拽标题栏 + 设置/固定/收起/关闭），
 * 主体渲染 <Workspace density="compact" />。Workspace 的 tailwind 样式由
 * content.tsx 在 shadow root 里注入 workspace.css（:host 提供白底主题变量），
 * 避免污染宿主页面。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { Maximize, Minimize, Minus, Search, Settings, SquarePen, X } from 'lucide-react';
import { getPlatform } from '../lib/platform';
import { useAskStore } from '../store/askStore';
import Workspace from './workspace/Workspace';
import SearchDialog from './workspace/SearchDialog';

/** 面板默认宽度：工作台需足够宽（与桌面端多聊并排一致） */
const PANEL_WIDTH = 880;

interface PageWorkspaceProps {
  /** 预填的问题（如划词文本）；为空 = 空白新话题 */
  initialText?: string;
  onClose: () => void;
  /** 触发锚点（选区底部 / 右键坐标），用于把面板垂直锚定到触发点附近 */
  position?: { left: number; top: number };
}

export default function PageWorkspace({
  initialText = '',
  onClose,
  position,
}: PageWorkspaceProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  // 固定态恒为 true：面板默认钉在页面上，点击面板外部不自动关闭（pin 按钮已移除）
  const [minimized, setMinimized] = useState(false);
  // 最大化：铺满视口；还原时回到最大化前记录的位置与尺寸
  const [maximized, setMaximized] = useState(false);
  const restoreRef = useRef<{
    docked: boolean;
    pos: { left: number; top: number };
  } | null>(null);
  // 搜索历史弹窗（由标题栏「搜索」按钮触发，同 Workspace 顶部搜索）
  const [searchOpen, setSearchOpen] = useState(false);

  // 将「收起」状态同步给 content script（固定恒为 true，点击面板外部不自动关闭）
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('askall-panel-state', {
        detail: { pinned: true, minimized },
      }),
    );
  }, [minimized]);

  // 拖拽位置
  const [pos, setPos] = useState(
    position ?? { left: window.innerWidth - PANEL_WIDTH - 16, top: 56 },
  );
  /** 是否贴右显示（默认右侧白色卡片；传入 position 贴近触发点或拖拽后为自由定位） */
  const [docked, setDocked] = useState(!position);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
  } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const startDrag = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (maximized) return;
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: pos.left,
      origTop: pos.top,
    };
    e.preventDefault();
    e.stopPropagation();
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setDocked(false);
      setPos({
        left: Math.max(
          0,
          Math.min(d.origLeft + (e.clientX - d.startX), window.innerWidth - 60),
        ),
        top: Math.max(
          0,
          Math.min(d.origTop + (e.clientY - d.startY), window.innerHeight - 40),
        ),
      });
    };
    const onMouseUp = () => {
      dragRef.current = null;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // 贴近触发点智能摆位：优先放锚点下方，底部放不下翻到上方，水平夹紧在视口内。
  // 后续拖拽可自由覆盖此位置。
  useLayoutEffect(() => {
    if (!position) return;
    const card = cardRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = card?.offsetWidth ?? Math.min(PANEL_WIDTH, vw - 32);
    const h = card?.offsetHeight ?? Math.min(600, vh - 72);
    const gap = 8;
    const margin = 8;
    const top =
      position.top + gap + h <= vh - margin
        ? position.top + gap
        : Math.max(margin, position.top - h - gap);
    const left = Math.max(
      margin,
      Math.min(position.left - w / 2, vw - w - margin),
    );
    setPos({ left, top });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 划词文本预填（不自动发送，由用户确认后手动发送，经 store 注入给 Composer）
  const prefillRef = useRef(false);
  useEffect(() => {
    if (prefillRef.current) return;
    prefillRef.current = true;
    const t = initialText.trim();
    if (!t) return;
    const store = useAskStore.getState();
    store.newConversation();
    store.setPendingQuestion(t);
  }, [initialText]);

  // Esc 关闭面板
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const openSettings = () => {
    getPlatform().window.openSettings().catch(() => {});
  };

  // 最大化 / 还原：最大化前记录当前停靠态与位置，还原时恢复到之前的宽高与位置
  const toggleMaximize = () => {
    if (!maximized) {
      restoreRef.current = { docked, pos };
      setMaximized(true);
    } else {
      setMaximized(false);
      const r = restoreRef.current;
      if (r) {
        setDocked(r.docked);
        setPos(r.pos);
      }
    }
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
          style={
            maximized
              ? {
                  ...styles.card,
                  left: 0,
                  top: 0,
                  width: '100vw',
                  height: '100vh',
                  maxHeight: '100vh',
                  borderRadius: 0,
                  border: 'none',
                }
              : {
                  ...styles.card,
                  ...(docked ? { right: 16 } : { left: pos.left }),
                  top: docked ? 56 : pos.top,
                  width: `min(${PANEL_WIDTH}px, calc(100vw - 32px))`,
                  height: 'min(600px, calc(100vh - 72px))',
                  maxHeight: 'calc(100vh - 72px)',
                }
          }
        >
          {/* 顶部拖拽标题栏：左侧 = 品牌 + 功能操作（搜索/新话题/设置），右侧 = 窗口控制（最大化/收起/关闭） */}
          <div style={styles.header} onMouseDown={startDrag}>
            <div style={styles.headerLeft}>
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
                  style={styles.iconBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchOpen(true);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  aria-label="搜索历史"
                  title="搜索历史"
                >
                  <Search style={{ width: 15, height: 15 }} />
                </button>
                <button
                  type="button"
                  style={styles.iconBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    useAskStore.getState().newConversation();
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  aria-label="新话题"
                  title="新话题"
                >
                  <SquarePen style={{ width: 15, height: 15 }} />
                </button>
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
            </div>
            <div style={styles.headerActions}>
              <button
                type="button"
                style={styles.iconBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMaximize();
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={maximized ? '还原面板' : '最大化面板'}
                title={maximized ? '还原面板' : '最大化面板'}
              >
                {maximized ? (
                  <Minimize style={{ width: 14, height: 14 }} />
                ) : (
                  <Maximize style={{ width: 14, height: 14 }} />
                )}
              </button>
              <button
                type="button"
                style={styles.iconBtn}
                onClick={() => {
                  setMinimized(true);
                  // 收起时退出最大化，还原小浮窗后回到常规宽高
                  setMaximized(false);
                }}
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

          {/* 主体：共享工作台（搜索/新话题/设置已上移到标题栏，此处仅保留时间线 + Composer） */}
          <div style={styles.body}>
            <Workspace hideTopActions />
          </div>

          {/* 搜索历史弹窗：与标题栏「搜索」按钮联动（置于卡片内，与 Workspace 内渲染同堆叠上下文） */}
          {searchOpen && (
            <SearchDialog onClose={() => setSearchOpen(false)} />
          )}
        </div>
      )}
    </div>
  );
}

const panelCss = `
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

const styles: Record<string, CSSProperties> = {
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
    boxShadow:
      '0 4px 6px -1px rgba(0,0,0,0.05), 0 10px 20px -2px rgba(0,0,0,0.08)',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    color: 'hsl(224 71.4% 4.1%)',
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'move',
    userSelect: 'none',
    flexShrink: 0,
    height: 36,
    padding: '0 10px',
    borderBottom: '1px solid hsl(220 13% 91%)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontWeight: 600,
    fontSize: 14,
  },
  logo: {
    width: 20,
    height: 20,
    objectFit: 'contain',
    display: 'block',
    border: 'none',
    outline: 'none',
    boxShadow: 'none',
  },
  logoFallback: {
    width: 20,
    height: 20,
    borderRadius: 5,
    background: 'hsl(221.2 83.2% 53.3%)',
    color: 'hsl(210 40% 98%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
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
  body: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
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
};
