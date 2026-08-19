/**
 * AiAnswerCard —— 单个 AI 的回答卡片（通道 A：文本快照视图）。
 *
 * 展示状态流水线（准备中 → 发送中 → 回复中 → 已完成/失败）+ 回答文本。
 * 两类特殊态：
 *   - fallback（自动发送失败）：警示样式 + 引导去源页面手动发送；
 *   - truncated（快照截断）：提示完整内容需到会话页查看。
 * 常驻操作：打开源会话 ↗、复制文本。
 */
import { useState } from 'react';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import type { AiStatus } from '../../utils/task';
import { isFallbackNotice } from '../../utils/history';
import { getPlatform } from '../../lib/platform';
import AiIcon from './AiIcon';

const STATUS_MAP: Record<AiStatus, { text: string; cls: string }> = {
  opening: { text: '准备中', cls: 'bg-muted text-muted-foreground' },
  sending: { text: '发送中', cls: 'bg-blue-100 text-blue-700' },
  streaming: { text: '回复中', cls: 'bg-amber-100 text-amber-700' },
  done: { text: '已完成', cls: 'bg-green-100 text-green-700' },
  error: { text: '失败', cls: 'bg-red-100 text-red-700' },
};

/** 默认折叠行数，超过则显示「展开」 */
const COLLAPSE_LINES = 8;

export default function AiAnswerCard({
  aiId,
  name,
  status,
  text,
  url,
  truncated,
}: {
  aiId?: string;
  name: string;
  status: AiStatus;
  text: string;
  url?: string;
  truncated?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const fallback = isFallbackNotice(text);
  const badge = STATUS_MAP[status] ?? STATUS_MAP.opening;

  const openSource = () => {
    if (!url) return;
    // 携带 aiId/name：桌面端复用该 AI 的 ai-{aiId} 子窗口（保留当前聊天状态）
    getPlatform()
      .ask.openAiTab(url, aiId, name)
      .catch(() => {});
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  const lines = text.split('\n').length;
  const needCollapse = lines > COLLAPSE_LINES || text.length > 480;
  const bodyCls =
    !expanded && needCollapse ? 'line-clamp-[8] overflow-hidden' : '';

  return (
    <div className="flex flex-col rounded-md border bg-card">
      {/* 头部：图标 + 名称 + 状态徽章 + 操作 */}
      <div className="flex items-center justify-between gap-2 border-b px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <AiIcon aiId={aiId} name={name} size={16} />
          <span className="truncate text-sm font-medium">{name}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>
            {fallback ? '需手动发送' : badge.text}
          </span>
          {text && !fallback && (
            <button
              type="button"
              title="复制回答"
              onClick={copy}
              className="text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          {url && (
            <button
              type="button"
              title="打开源会话"
              onClick={openSource}
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>

      {/* 正文 */}
      <div className="px-2.5 py-2">
        {fallback ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs leading-relaxed text-amber-700">
              未能自动发送。请打开该平台页面手动粘贴发送，回答完成后仍可在此查看。
            </p>
            {url && (
              <button
                type="button"
                onClick={openSource}
                className="self-start rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground hover:bg-accent"
              >
                去平台手动发送 ↗
              </button>
            )}
          </div>
        ) : text ? (
          <>
            <p
              className={`whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90 ${bodyCls}`}
            >
              {text}
            </p>
            {needCollapse && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-[11px] text-primary hover:underline"
              >
                {expanded ? '收起' : '展开全文'}
              </button>
            )}
            {truncated && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                内容已截断
                {url && (
                  <button
                    type="button"
                    onClick={openSource}
                    className="ml-1 text-primary hover:underline"
                  >
                    查看完整回答 ↗
                  </button>
                )}
              </p>
            )}
          </>
        ) : status === 'done' || status === 'error' ? (
          <p className="text-xs text-muted-foreground/70">
            {status === 'error' ? '发送失败，未获取到回答' : '未捕获到回答内容'}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
            {status === 'sending' && (
              <Loader2 className="h-3 w-3 animate-spin" />
            )}
            {status === 'sending' ? '正在自动填充发送…' : '等待回复…'}
          </p>
        )}
      </div>
    </div>
  );
}
