/**
 * AskPanel —— 共享「提问」面板。
 *
 * 扩展 popup 与 Tauri 桌面端共用：输入问题 → 勾选目标 AI → 发送，
 * 通过 platform.ask.ask() 触发各平台编排器（扩展 background / Rust 桌面端），
 * 并订阅 onReply 实时展示每个 AI 的回复状态与文本摘要。
 *
 * 不直接依赖任何平台 API，仅通过 getPlatform() 调用抽象能力。
 */
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, Send } from 'lucide-react';
import { getPlatform, type ReplyMessage } from '../lib/platform';
import {
  DEFAULT_AI_CONFIGS,
  mergeConfigs,
  type AiConfig,
} from '../utils/aiConfig';
import type { AiStatus } from '../utils/task';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';

const AI_CONFIGS_KEY = 'local:aiConfigs';

interface AiState {
  status: AiStatus;
  answer: string;
}

const STATUS_MAP: Record<AiStatus, { text: string; cls: string }> = {
  opening: { text: '准备中', cls: 'bg-muted text-muted-foreground' },
  sending: { text: '发送中', cls: 'bg-blue-100 text-blue-700' },
  streaming: { text: '回复中', cls: 'bg-amber-100 text-amber-700' },
  done: { text: '已完成', cls: 'bg-green-100 text-green-700' },
  error: { text: '失败', cls: 'bg-red-100 text-red-700' },
};

export default function AskPanel() {
  const [text, setText] = useState('');
  const [configs, setConfigs] = useState<AiConfig[]>(DEFAULT_AI_CONFIGS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Record<string, AiState>>({});
  const [sending, setSending] = useState(false);

  // 加载并合并 AI 配置；默认勾选所有 enabled 项
  useEffect(() => {
    getPlatform()
      .storage.getItem<AiConfig[]>(AI_CONFIGS_KEY)
      .then((stored) => {
        const merged = mergeConfigs(stored ?? null);
        setConfigs(merged);
        setSelected(new Set(merged.filter((c) => c.enabled).map((c) => c.id)));
      });
  }, []);

  // 订阅回复进度
  useEffect(() => {
    const off = getPlatform().ask.onReply((msg: ReplyMessage) => {
      setStates((prev) => {
        const cur = prev[msg.aiId] ?? { status: 'opening', answer: '' };
        switch (msg.type) {
          case 'AI_SENDING':
            return { ...prev, [msg.aiId]: { ...cur, status: 'sending' } };
          case 'AI_REPLY':
            return {
              ...prev,
              [msg.aiId]: {
                status: 'streaming',
                answer: cur.answer + msg.text,
              },
            };
          case 'AI_REPLY_DONE':
            return { ...prev, [msg.aiId]: { status: 'done', answer: msg.text } };
          default:
            return prev;
        }
      });
    });
    return off;
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAsk = useCallback(async () => {
    const t = text.trim();
    if (!t || selected.size === 0 || sending) return;
    setSending(true);
    setStates({});
    try {
      await getPlatform().ask.ask(t, [...selected]);
    } finally {
      setSending(false);
    }
  }, [text, selected, sending]);

  const selectedList = configs.filter((c) => selected.has(c.id));

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 输入区 */}
      <div className="flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入要同时提问的问题…（将发送至已勾选的 AI）"
          rows={4}
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleAsk();
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            已选 {selected.size} 个 AI · ⌘/Ctrl+Enter 发送
          </span>
          <Button
            size="sm"
            onClick={handleAsk}
            disabled={sending || !text.trim() || selected.size === 0}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            发送
          </Button>
        </div>
      </div>

      {/* AI 勾选 */}
      <div className="flex flex-wrap gap-2">
        {configs.map((c) => {
          const on = selected.has(c.id);
          return (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1 hover:bg-accent"
            >
              <Checkbox checked={on} onCheckedChange={() => toggle(c.id)} />
              <span className="text-sm">{c.name}</span>
            </label>
          );
        })}
      </div>

      {/* 回复进度 */}
      {selectedList.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {selectedList.map((c) => {
            const st = states[c.id];
            const badge = st ? STATUS_MAP[st.status] : STATUS_MAP.opening;
            return (
              <div key={c.id} className="rounded-md border p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{c.name}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}
                    >
                      {badge.text}
                    </span>
                    <button
                      type="button"
                      title="打开"
                      onClick={() =>
                        getPlatform()
                          .ask.openAiTab(c.url)
                          .catch(() => {})
                      }
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {st?.answer ? (
                  <p className="break-words whitespace-pre-wrap text-xs text-muted-foreground">
                    {st.answer}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground/60">等待回复…</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
