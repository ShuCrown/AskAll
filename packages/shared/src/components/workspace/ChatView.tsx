/**
 * ChatView —— 会话时间线视图。
 *
 * 渲染某会话的全部轮次（时间正序）：每轮 = 问题 + 各 AI 回答卡片。
 * 数据来源双通道合并：
 *   - 实时侧：liveTasks（进行中/最近任务），优先展示；
 *   - 历史侧：history.answers 快照（已落盘的最终回答）。
 * 底部固定 Composer 用于追问。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { getPlatform } from '../../lib/platform';
import {
  buildTurns,
  useAskStore,
  type TurnView,
} from '../../store/askStore';
import { ANSWER_MAX_LEN } from '../../utils/history';
import type { AiStatus } from '../../utils/task';
import AiAnswerCard from './AiAnswerCard';
import Composer from './Composer';

/** 判断快照文本是否被截断过（truncateAnswer 的尾部标记） */
function isTruncated(text: string): boolean {
  return text.includes('…[内容已截断');
}

function TurnBlock({ turn, index }: { turn: TurnView; index: number }) {
  const openSource = (url?: string) => {
    if (!url) return;
    getPlatform().ask.openAiTab(url).catch(() => {});
  };

  const [copied, setCopied] = useState(false);
  const copyQuestion = async () => {
    try {
      await navigator.clipboard.writeText(turn.question);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  // 该轮的回答展示：实时结果 > 历史快照 > 仅链接（旧数据兼容）
  const liveResults = turn.liveResults ? Object.values(turn.liveResults) : null;

  return (
    <div className="group flex flex-col gap-2">
      {/* 问题气泡：右对齐，#eeeeee 背景，最大 70% 宽度 */}
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[70%] rounded-2xl bg-[#eeeeee] px-4 py-3">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {turn.question}
          </p>
        </div>
        <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="text-[10px] text-muted-foreground/70">
            {new Date(turn.timestamp).toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
          <button
            type="button"
            onClick={copyQuestion}
            title="复制问题"
            className="text-muted-foreground hover:text-foreground"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-600" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      {/* 回答卡片 */}
      {liveResults ? (
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {liveResults.map((r) => (
            <AiAnswerCard
              key={r.aiId}
              aiId={r.aiId}
              name={r.aiName}
              status={r.status as AiStatus}
              text={r.answer}
              url={r.url}
              truncated={r.answer.length >= ANSWER_MAX_LEN}
            />
          ))}
        </div>
      ) : turn.answers && turn.answers.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {turn.answers.map((snap, i) => {
            const link =
              snap.url ??
              turn.aiUrls.find(
                (u) =>
                  (snap.aiId && u.id === snap.aiId) || u.name === snap.name,
              )?.url;
            return (
              <AiAnswerCard
                key={`${snap.aiId ?? snap.name}-${i}`}
                aiId={snap.aiId}
                name={snap.name}
                status={snap.status === 'error' ? 'error' : 'done'}
                text={
                  snap.status === 'error'
                    ? '【AskAll】未能自动发送，请在平台手动发送。'
                    : snap.text
                }
                url={link}
                truncated={isTruncated(snap.text)}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {turn.aiUrls.map((link, i) => (
            <button
              key={`${link.name}-${i}`}
              type="button"
              onClick={() => openSource(link.url)}
              className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent"
            >
              <ExternalLink className="h-3 w-3" />
              {link.name}
            </button>
          ))}
          {turn.aiUrls.length > 0 && (
            <span className="self-center text-[11px] text-muted-foreground/70">
              早期记录未保存回答内容，点击跳转会话页查看
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatView({ convKey }: { convKey: string }) {
  const history = useAskStore((s) => s.history);
  const liveTasks = useAskStore((s) => s.liveTasks);
  const taskHistory = useAskStore((s) => s.taskHistory);

  const turns = useMemo(
    () => buildTurns({ history, liveTasks, taskHistory }, convKey),
    [history, liveTasks, taskHistory, convKey],
  );

  // 进行中统计（仅统计实时轮次）
  const liveTurn = turns.find((t) => t.live);
  const liveResults = liveTurn?.liveResults
    ? Object.values(liveTurn.liveResults)
    : [];
  const doneCount = liveResults.filter(
    (r) => r.status === 'done' || r.status === 'error',
  ).length;

  // 有实时轮次时自动滚动到底部
  const bottomRef = useRef<HTMLDivElement>(null);
  const liveSignature = liveResults.map((r) => `${r.status}:${r.answer.length}`).join('|');
  useEffect(() => {
    if (liveTurn) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSignature]);

  if (turns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>该会话暂无内容</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 时间线 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {turns.map((turn, i) => (
            <TurnBlock key={turn.historyId ?? turn.taskId ?? i} turn={turn} index={i} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* 进行中汇总条 */}
      {liveTurn && liveResults.length > 0 && (
        <div className="border-t bg-muted/40 px-4 py-1.5 text-center text-xs text-muted-foreground">
          {doneCount}/{liveResults.length} 已完成
          {doneCount < liveResults.length && ' · 正在等待其余 AI 返回…'}
        </div>
      )}

      {/* 追问输入 */}
      <div className="shrink-0 border-t px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <Composer placeholder="继续追问，将发送至所选 AI 的当前会话…" />
        </div>
      </div>
    </div>
  );
}
