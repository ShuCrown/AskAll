/**
 * AiAnswerCard —— 单个 AI 的回答卡片（通道 A：文本快照视图）。
 *
 * 展示状态流水线（准备中 → 发送中 → 回复中 → 已完成/失败）+ 回答文本。
 * 两类特殊态：
 *   - fallback（自动发送失败）：警示样式 + 引导去源页面手动发送；
 *   - truncated（快照截断）：提示完整内容需到会话页查看。
 * 常驻操作：打开源会话 ↗。
 */
import { useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import type { AiStatus } from '../../utils/task';
import { isFallbackNotice } from '../../utils/history';
import { getPlatform } from '../../lib/platform';
import AiIcon from './AiIcon';
import Markdown from './Markdown';
import Tooltip from '../ui/tooltip';

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
  taskId,
}: {
  aiId?: string;
  name: string;
  status: AiStatus;
  text: string;
  url?: string;
  truncated?: boolean;
  /** 实时任务 id：提供时才显示「同步」按钮（历史快照卡片不传） */
  taskId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const fallback = isFallbackNotice(text);
  const badge = STATUS_MAP[status] ?? STATUS_MAP.opening;

  const openSource = () => {
    if (!url) return;
    // 携带 aiId/name：优先复用该 AI 已有的聊天页（保留当前聊天状态）
    getPlatform()
      .ask.openAiTab(url, aiId, name)
      .catch(() => {});
  };

  // 手动同步：注入探针重新读取该 AI 标签页的当前回答（仅进行中的实时卡片显示）
  const inProgress = status !== 'done' && status !== 'error';
  const sync = () => {
    if (!taskId || !aiId || syncing) return;
    setSyncing(true);
    getPlatform()
      .ask.syncAi?.(aiId, name, taskId)
      .catch(() => {})
      .finally(() => setSyncing(false));
  };

  const lines = text.split('\n').length;
  const needCollapse = lines > COLLAPSE_LINES || text.length > 480;

  return (
    // h-full：田字格同行卡片以最高者为准等高占满（外层 wrapper 已随 grid 行高拉伸）
    <div className="flex h-full min-w-0 flex-col rounded-md border bg-card">
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
          {inProgress && taskId && (
            <Tooltip content={syncing ? '同步中…' : '同步该 AI 回答'}>
              <button
                type="button"
                onClick={sync}
                disabled={syncing}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`}
                />
              </button>
            </Tooltip>
          )}
          {url && (
            <Tooltip content="打开源会话">
              <button
                type="button"
                onClick={openSource}
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </span>
      </div>

      {/* 正文（flex-1：填满卡片剩余高度，配合 h-full 等高） */}
      <div className="flex-1 px-2.5 py-2">
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
          <div className="flex h-full flex-col">
            {/* 文本区：Markdown 渲染贴近 AI 原站点；占满剩余空间，让底部操作固定贴底 */}
            <div className="min-h-0 flex-1">
              <Markdown
                text={text}
                clamped={!expanded && needCollapse}
              />
            </div>
            {/* 底部固定操作：展开全文 / 内容截断提示（卡片等高拉伸时贴底） */}
            {(needCollapse || truncated) && (
              <div className="mt-2 flex items-center gap-3 border-t border-black/5 pt-1.5">
                {needCollapse && (
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="text-[11px] text-primary hover:underline"
                  >
                    {expanded ? '收起' : '展开全文'}
                  </button>
                )}
                {truncated && (
                  <span className="text-[11px] text-muted-foreground">
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
                  </span>
                )}
              </div>
            )}
          </div>
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
