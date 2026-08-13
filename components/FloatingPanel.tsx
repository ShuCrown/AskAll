import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiConfig } from '@/utils/aiConfig';

const AI_CONFIGS_KEY = 'local:aiConfigs';
const DEFAULT_PANEL_KEY = 'local:defaultFloatingPanel';

interface FloatingPanelProps {
  text: string;
  onClose: () => void;
}

type PanelView = 'select' | 'result';

export default function FloatingPanel({ text, onClose }: FloatingPanelProps) {
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<PanelView>('select');
  const [showAfterSend, setShowAfterSend] = useState(true);
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
  }, []);

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
      <div style={styles.card}>
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
            ⚙️
          </button>
        </div>

        {view === 'select' ? (
          <>
            <div style={styles.countRow}>
              <span style={styles.countText}>
                已选择 {selectedList.length}/{enabledList.length}
              </span>
            </div>
            <div style={styles.list}>
              {enabledList.map((ai) => (
                <label
                  key={ai.id}
                  style={{
                    ...styles.item,
                    background: selectedIds.has(ai.id)
                      ? '#eff6ff'
                      : 'transparent',
                  }}
                >
                  <span style={styles.aiName}>
                    <span style={styles.aiIcon}>{aiIcon(ai.name)}</span>
                    {ai.name}
                  </span>
                  <input
                    type="checkbox"
                    style={styles.checkbox}
                    checked={selectedIds.has(ai.id)}
                    onChange={() => toggleAi(ai.id)}
                  />
                </label>
              ))}
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

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    zIndex: 2147483647,
    inset: 0,
    pointerEvents: 'none',
  },
  card: {
    position: 'absolute',
    width: 280,
    background: '#fff',
    borderRadius: 12,
    boxShadow: '0 8px 30px rgba(0,0,0,0.16)',
    padding: 12,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    color: '#1f2937',
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
    background: '#2563eb',
    color: '#fff',
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
  },
  countRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  countText: {
    fontSize: 13,
    color: '#374151',
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
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  aiName: {
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  aiIcon: {
    fontSize: 13,
    lineHeight: 1,
  },
  checkbox: {
    width: 18,
    height: 18,
    accentColor: '#2563eb',
    cursor: 'pointer',
  },
  sendBtn: {
    width: '100%',
    padding: '10px 0',
    borderRadius: 8,
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  hint: {
    textAlign: 'center',
    fontSize: 12,
    color: '#9ca3af',
  },
  questionBox: {
    background: '#eff6ff',
    borderRadius: 8,
    padding: 10,
  },
  questionLabel: {
    fontSize: 12,
    color: '#2563eb',
    marginBottom: 4,
  },
  questionText: {
    fontSize: 14,
    lineHeight: 1.5,
    wordBreak: 'break-word',
  },
  resultHeader: {
    display: 'flex',
    gap: 12,
    borderBottom: '1px solid #e5e7eb',
    paddingBottom: 6,
  },
  resultTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#2563eb',
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
    border: '1px solid #e5e7eb',
    textDecoration: 'none',
    color: 'inherit',
    cursor: 'pointer',
  },
  resultName: {
    fontWeight: 600,
    fontSize: 14,
    marginBottom: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  resultStatus: {
    fontSize: 12,
    color: '#6b7280',
  },
  resultActions: {
    display: 'flex',
    gap: 8,
  },
  secondaryBtn: {
    flex: 1,
    padding: '9px 0',
    borderRadius: 8,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#374151',
    fontSize: 14,
    cursor: 'pointer',
  },
};
