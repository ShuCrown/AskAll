import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { getHistory, clearHistory } from '../utils/history';
import type { HistoryItem } from '../utils/history';
import { getPlatform } from '../lib/platform';
import { Button } from './ui/button';

interface Conversation {
  key: string;
  /** 会话首轮问题（作为会话标题） */
  root: HistoryItem;
  /** 该会话的所有轮次（最新在前） */
  turns: HistoryItem[];
}

/** 时间戳 → 中文格式：2026年8月14日 10时57分25秒 */
function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(
    d.getHours(),
  )}时${pad(d.getMinutes())}分${pad(d.getSeconds())}秒`;
}

export default function HistoryPanel() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    getHistory().then(setHistory);
  }, []);

  /** 打开问答链接：优先切换到该 AI 已打开的会话标签页/窗口，找不到才打开链接地址 */
  const openLink = (url: string) => {
    getPlatform().ask.openAiTab(url).catch(() => {
      window.open(url, '_blank', 'noreferrer');
    });
  };

  // 按 conversationId 分组：同一会话的多轮追问归为一组；无 conversationId 的旧数据各自成组
  const conversations = useMemo<Conversation[]>(() => {
    const map = new Map<string, HistoryItem[]>();
    const order: string[] = [];
    for (const item of history) {
      const key = item.conversationId || item.id;
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(item);
    }
    return order.map((key) => {
      const turns = map.get(key)!;
      return { key, root: turns[turns.length - 1]!, turns };
    });
  }, [history]);

  const handleClear = async () => {
    await clearHistory();
    setHistory([]);
  };

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight">历史记录</h2>
        <Button variant="outline" size="sm" onClick={handleClear}>
          清空
        </Button>
      </div>

      {conversations.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          暂无历史记录
        </p>
      ) : (
        conversations.map((conv) => {
          const isOpen = expanded.has(conv.key);
          const multiTurn = conv.turns.length > 1;
          return (
            <div key={conv.key} className="rounded-lg border bg-card p-3">
              <button
                type="button"
                onClick={() => toggle(conv.key)}
                className="w-full text-left"
              >
                <div className="flex items-center gap-2">
                  {multiTurn && (
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                  <p className="flex-1 text-sm font-medium leading-snug">
                    {conv.root.question}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(conv.root.timestamp)}
                  {multiTurn && ` · ${conv.turns.length} 轮`}
                </p>
              </button>

              {isOpen && multiTurn && (
                <div className="mt-2 flex flex-col gap-2 border-l border-border pl-3">
                  {conv.turns.map((turn) => (
                    <div key={turn.id}>
                      <p className="text-sm leading-snug">{turn.question}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatDateTime(turn.timestamp)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {turn.aiUrls?.map((link, i) => (
                          <button
                            key={`${link.name}-${i}`}
                            type="button"
                            onClick={() => openLink(link.url)}
                            className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground transition-colors hover:bg-accent"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {link.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!multiTurn && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {conv.root.aiUrls?.map((link, i) => (
                    <button
                      key={`${link.name}-${i}`}
                      type="button"
                      onClick={() => openLink(link.url)}
                      className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {link.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}