import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import type { AiConfig } from '@/utils/aiConfig';

const AI_CONFIGS_KEY = 'local:aiConfigs';
const DEFAULT_PANEL_KEY = 'local:defaultFloatingPanel';
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
  const sentRef = useRef(false);

  useEffect(() => {
    storage.getItem(AI_CONFIGS_KEY).then((data) => {
      const configs = (data as AiConfig[]) ?? [];
      setAiConfigs(configs);
      storage.getItem('local:selectAllByDefault').then((selectAll) => {
        const shouldSelectAll =
          typeof selectAll === 'boolean' ? selectAll : true;
        const enabled = configs.filter((ai) => ai.enabled && ai.url);
        setSelectedIds(
          new Set(shouldSelectAll ? enabled.map((ai) => ai.id) : []),
        );
      });
    });
    storage.getItem(DEFAULT_PANEL_KEY).then((v) => {
      if (v === 'result' || v === 'select') {
        setView(v as PanelView);
      }
    });
    storage.getItem('local:showResultAfterSend').then((v) => {
      if (typeof v === 'boolean') setShowAfterSend(v);
    });
    storage.getItem(AUTO_SEND_KEY).then((v) => {
      if (typeof v === 'boolean') setAutoSend(v);
    });
  }, []);

  // 自动发送：开启时直接向所有启用的 AI 发送，并展示第二个面板（结果面板）
  useEffect(() => {
    if (!autoSend || sentRef.current || aiConfigs.length === 0) return;
    const enabled = aiConfigs.filter((ai) => ai.enabled && ai.url);
    if (enabled.length === 0) return;
    sentRef.current = true;
    browser.runtime.sendMessage({
      type: 'ASK_AI',
      text,
      aiIds: enabled.map((ai) => ai.id),
    });
    setView('result');
    storage.setItem(DEFAULT_PANEL_KEY, 'result');
  }, [autoSend, aiConfigs]);

  const toggleAutoSend = async (checked: boolean) => {
    await storage.setItem(AUTO_SEND_KEY, checked);
    setAutoSend(checked);
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

    browser.runtime.sendMessage({
      type: 'ASK_AI',
      text,
      aiIds: selectedList.map((ai) => ai.id),
    });

    if (showAfterSend) {
      setView('result');
      storage.setItem(DEFAULT_PANEL_KEY, 'result');
    } else {
      onClose();
    }
  };

  const openSettings = () => {
    browser.runtime.sendMessage({ type: 'OPEN_SETTINGS' });
  };

  // 在结果面板手动输入新的问题，直接向已打开的聊天窗口发送，不新建标签页/弹窗
  const handleFollowUpSend = () => {
    const q = followUp.trim();
    if (!q || selectedList.length === 0) return;
    browser.runtime.sendMessage({
      type: 'ASK_AI_FOLLOWUP',
      text: q,
      aiIds: selectedList.map((ai) => ai.id),
    });
    setFollowUp('');
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && view === 'select') handleSend();
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
      <div style={{ ...styles.card, ...(position ? { left: position.left, top: position.top } : {}) }}>
        <div style={styles.header}>
          <div style={styles.title}>
            <span style={styles.logo}>齐</span>
            <span>齐问</span>
          </div>
          <button
            type="button"
            style={styles.iconBtn}
            onClick={openSettings}
            aria-label="设置"
            title="设置"
          >
            <Settings style={{ width: 16, height: 16 }} />
          </button>
        </div>

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
                        {aiIcon(ai.name)}
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
            <button
              type="button"
              style={{
                ...styles.sendBtn,
                opacity: selectedList.length === 0 ? 0.6 : 1,
              }}
              onClick={handleSend}
              disabled={selectedList.length === 0}
            >
              开始提问
            </button>
            <div style={styles.hint}>Enter 发送，Esc 关闭</div>
          </>
        ) : (
          <>
            <div style={styles.composeBox}>
              <input
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFollowUpSend();
                }}
                placeholder="输入新的问题，向已打开的聊天窗口发送…"
                style={styles.composeInput}
              />
              <button
                type="button"
                style={styles.composeBtn}
                onClick={handleFollowUpSend}
                disabled={!followUp.trim()}
              >
                发送
              </button>
            </div>
            <div style={styles.questionBox}>
              <div style={styles.questionLabel}>我的问题</div>
              <div style={styles.questionText}>{text}</div>
            </div>
            <div style={styles.resultHeader}>
              <span style={styles.resultTitle}>全部回答</span>
            </div>
            <div style={styles.resultList}>
              {selectedList.map((ai) => (
                <a
                  key={ai.id}
                  href={buildUrl(ai)}
                  target="_blank"
                  rel="noreferrer"
                  style={styles.resultItem}
                >
                  <div style={styles.resultName}>
                    <span style={styles.aiIcon}>{aiIcon(ai.name)}</span>
                    {ai.name}
                  </div>
                  <div style={styles.resultStatus}>已向 {ai.name} 发送，点击查看</div>
                </a>
              ))}
            </div>
            <div style={styles.resultActions}>
              <button
                type="button"
                style={styles.secondaryBtn}
                onClick={() => {
                  setView('select');
                  storage.setItem(DEFAULT_PANEL_KEY, 'select');
                }}
              >
                返回选择
              </button>
              <button type="button" style={styles.sendBtn} onClick={onClose}>
                关闭
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function aiIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes('chatgpt') || lower.includes('gpt')) return '🟢 ';
  if (lower.includes('claude')) return '🟤 ';
  if (lower.includes('gemini')) return '🔵 ';
  if (lower.includes('deepseek')) return '🔷 ';
  if (lower.includes('通义') || lower.includes('千问') || lower.includes('qwen'))
    return '🟣 ';
  if (lower.includes('文心')) return '🔶 ';
  if (lower.includes('豆包')) return '🟡 ';
  if (lower.includes('kimi')) return '🌙 ';
  return '🤖 ';
}

const panelCss = `
  .askall-item { cursor: pointer; }
  .askall-item:hover { background: hsl(220 14.3% 95.9%); }
  .askall-item:hover .askall-checkbox { border-color: hsl(221.2 83.2% 53.3%); }
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
    gap: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    borderRadius: 6,
    background: 'hsl(221.2 83.2% 53.3%)',
    color: 'hsl(210 40% 98%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
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
    maxHeight: 260,
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
    filter: 'grayscale(0.4)',
    opacity: 0.6,
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
    width: '100%',
    padding: '9px 0',
    borderRadius: 8,
    border: 'none',
    background: 'hsl(221.2 83.2% 53.3%)',
    color: 'hsl(210 40% 98%)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s',
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
    maxHeight: 220,
    overflowY: 'auto',
  },
  resultItem: {
    display: 'block',
    padding: 10,
    borderRadius: 8,
    border: '1px solid hsl(220 13% 91%)',
    textDecoration: 'none',
    color: 'inherit',
    cursor: 'pointer',
    transition: 'background 0.15s',
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
};
