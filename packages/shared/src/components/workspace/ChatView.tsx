/**
 * ChatView —— 会话时间线视图。
 *
 * 渲染某会话的全部轮次（时间正序）：每轮 = 问题 + 各 AI 回答卡片。
 * 数据来源双通道合并：
 *   - 实时侧：liveTasks（进行中/最近任务），优先展示；
 *   - 历史侧：history.answers 快照（已落盘的最终回答）。
 * 底部固定 Composer 用于追问。
 */
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, Copy, Paperclip } from 'lucide-react';
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
import Tooltip from '../ui/tooltip';
import { PanelExpandedContext } from '../panel-mode';

/** 判断快照文本是否被截断过（truncateAnswer 的尾部标记） */
function isTruncated(text: string): boolean {
  return text.includes('…[内容已截断');
}

function TurnBlock({
  turn,
  index,
  layout,
}: {
  turn: TurnView;
  index: number;
  layout: 'grid' | 'single';
}) {
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

  // 卡片顺序固定按配置列表顺序（默认四家 deepseek→豆包→文心→千问，自定义在后），
  // 不随完成先后 / 对象插入序变动
  const configs = useAskStore((s) => s.configs);
  const orderOf = (id?: string, name?: string): number => {
    if (id != null) {
      const i = configs.findIndex((c) => c.id === id);
      if (i >= 0) return i;
    }
    if (name != null) {
      const j = configs.findIndex((c) => c.name === name);
      if (j >= 0) return j;
    }
    return 999;
  };

  // 该轮的回答展示：实时结果 > 历史快照 > 仅链接（旧数据兼容）
  const liveResults = turn.liveResults
    ? Object.values(turn.liveResults).sort(
        (a, b) => orderOf(a.aiId, a.aiName) - orderOf(b.aiId, b.aiName),
      )
    : null;
  const answers = turn.answers
    ? [...turn.answers].sort(
        (a, b) => orderOf(a.aiId, a.name) - orderOf(b.aiId, b.name),
      )
    : null;

  return (
    <div className="group flex min-w-0 flex-col gap-2">
      {/* 问题气泡：右对齐，#eeeeee 背景，最大 70% 宽度 */}
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[70%] rounded-2xl bg-[#eeeeee] px-4 py-3">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {turn.question}
          </p>
          {turn.attachments && turn.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-end gap-1 border-t border-black/5 pt-2">
              {turn.attachments.map((a, i) => (
                <span
                  key={`${a.name}-${i}`}
                  className="flex max-w-[180px] items-center gap-1 rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] text-foreground/70"
                  title={`${a.name}（${Math.max(1, Math.round(a.size / 1024))}KB）`}
                >
                  <Paperclip className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{a.name}</span>
                </span>
              ))}
            </div>
          )}
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
          <Tooltip content={copied ? '已复制' : '复制问题'}>
            <button
              type="button"
              onClick={copyQuestion}
              className="text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-600" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 回答卡片（布局：田字格多列 / 单列；多列下奇数数量最后一张占满整行） */}
      {liveResults ? (
        <div
          className={
            layout === 'single'
              ? 'grid min-w-0 grid-cols-1 gap-2'
              : 'grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2'
          }
        >
          {liveResults.map((r, i) => {
            const oddFull =
              layout === 'grid' &&
              liveResults.length % 2 === 1 &&
              i === liveResults.length - 1;
            return (
              <div
                key={r.aiId}
                className={
                  oddFull ? 'h-full min-w-0 xl:col-span-2' : 'h-full min-w-0'
                }
              >
                <AiAnswerCard
                  aiId={r.aiId}
                  name={r.aiName}
                  status={r.status as AiStatus}
                  text={r.answer}
                  url={r.url}
                  truncated={r.answer.length >= ANSWER_MAX_LEN}
                  taskId={turn.taskId}
                />
              </div>
            );
          })}
        </div>
      ) : answers && answers.length > 0 ? (
        <div
          className={
            layout === 'single'
              ? 'grid min-w-0 grid-cols-1 gap-2'
              : 'grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2'
          }
        >
          {answers.map((snap, i) => {
            const link =
              snap.url ??
              turn.aiUrls.find(
                (u) =>
                  (snap.aiId && u.id === snap.aiId) || u.name === snap.name,
              )?.url;
            const oddFull =
              layout === 'grid' &&
              answers.length % 2 === 1 &&
              i === answers.length - 1;
            return (
              <div
                key={`${snap.aiId ?? snap.name}-${i}`}
                className={
                  oddFull ? 'h-full min-w-0 xl:col-span-2' : 'h-full min-w-0'
                }
              >
                <AiAnswerCard
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
              </div>
            );
          })}
        </div>
      ) : turn.aiUrls.length > 0 ? (
        // 早期记录未保存回答内容：按新 chat 卡片展示，内容占位「暂无返回内容」
        <div
          className={
            layout === 'single'
              ? 'grid min-w-0 grid-cols-1 gap-2'
              : 'grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2'
          }
        >
          {turn.aiUrls.map((link, i) => {
            const oddFull =
              layout === 'grid' &&
              turn.aiUrls.length % 2 === 1 &&
              i === turn.aiUrls.length - 1;
            return (
              <div
                key={`${link.name}-${i}`}
                className={
                  oddFull ? 'h-full min-w-0 xl:col-span-2' : 'h-full min-w-0'
                }
              >
                <AiAnswerCard
                  aiId={link.id}
                  name={link.name}
                  status="done"
                  text="暂无返回内容"
                  url={link.url}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function ChatView({ convKey }: { convKey: string }) {
  const history = useAskStore((s) => s.history);
  const liveTasks = useAskStore((s) => s.liveTasks);
  const taskHistory = useAskStore((s) => s.taskHistory);
  // 面板最大化时内容区铺满宽度（默认阅读宽度 max-w-3xl）
  const expanded = useContext(PanelExpandedContext);
  // 聊天卡片布局（田字格/单列）：设置页可配，focus 面板时刷新以同步设置改动
  const [chatLayout, setChatLayout] = useState<'grid' | 'single'>('grid');
  useEffect(() => {
    const read = () => {
      getPlatform()
        .storage.getItem('local:chatLayout')
        .then((v) => setChatLayout(v === 'single' ? 'single' : 'grid'));
    };
    read();
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, []);

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

  // 时间线自动滚动：贴底跟随流式更新，但用户上滑（离开底部）即暂停，滚回底部恢复；
  // 新增轮次时仅当贴底才跳底。直接设 scrollTop 而非 scrollIntoView：避免连带滚动宿主页面。
  const timelineRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const liveSignature = liveResults
    .map((r) => `${r.status}:${r.answer.length}`)
    .join('|');

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickRef.current = dist < 40;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // 流式更新跟随：用 useLayoutEffect（paint 前同步滚动）消除「先渲染增高再回拉」
  // 造成的抖动，并用 rAF 合并同一帧内的多次内容更新，避免高频 setScrollTop。
  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (!el || !stickRef.current) return;
    const raf = requestAnimationFrame(() => {
      const cur = timelineRef.current;
      if (cur && stickRef.current) cur.scrollTop = cur.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [liveSignature]);

  // 新增轮次时跳底：仅当用户本就贴底才跳底，并保持跟随；
  // 用户已上滚（stickRef=false）时不打断其阅读位置，也不强制重置跟随状态。
  useLayoutEffect(() => {
    const el = timelineRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [turns.length]);

  if (turns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>该会话暂无内容</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 时间线（始终展示所有 AI 的回答） */}
      <div
        ref={timelineRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3"
      >
        <div
          className={
            expanded
              ? 'flex min-w-0 flex-col gap-4'
              : 'mx-auto flex min-w-0 max-w-4xl flex-col gap-4'
          }
        >
          {turns.map((turn, i) => (
            <TurnBlock
              key={turn.historyId ?? turn.taskId ?? i}
              turn={turn}
              index={i}
              layout={chatLayout}
            />
          ))}
        </div>
      </div>

      {/* 进行中汇总条 */}
      {liveTurn && liveResults.length > 0 && (
        <div className="border-t bg-muted/40 px-4 py-1.5 text-center text-xs text-muted-foreground">
          {doneCount}/{liveResults.length} 已完成
          {doneCount < liveResults.length && ' · 正在等待其余 AI 返回…'}
        </div>
      )}

      {/* 追问输入（宽度与时间线内容一致：默认居中阅读宽，最大化铺满） */}
      <div className="shrink-0 border-t px-4 py-3">
        <div className={expanded ? 'min-w-0' : 'mx-auto min-w-0 max-w-4xl'}>
          <Composer placeholder="继续追问，将发送至所选 AI 的当前会话…" />
        </div>
      </div>
    </div>
  );
}
