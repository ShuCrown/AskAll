/**
 * ChatTabs —— 主窗口顶部「会话内 chat 标签页」（仅桌面端）。
 *
 * 默认停留在「问答」页：提问后不再弹出 AI 子窗口，回答的实际内容统一
 * 展示在当前问答面板（时间线）；需要查看某个 AI 的原始问答页时，
 * 点击对应 chat tab 唤起/复用该 AI 的子窗口（弹窗显示）。
 * 标签列表 = 当前会话参与过的 AI（历史记录 + 实时任务合并，实时优先）。
 */
import { useEffect, useMemo, useState } from 'react';
import { MessagesSquare } from 'lucide-react';
import { getPlatform } from '../../lib/platform';
import { useAskStore } from '../../store/askStore';
import { cn } from '../../lib/utils';
import AiIcon from './AiIcon';

/** 会话内单个 AI 的 chat 标签（id 可能缺失：极旧的历史数据只有 name/url） */
interface ChatTabItem {
  id?: string;
  name: string;
  url: string;
}

const QA_TAB = '__qa__';

function tabCls(active: boolean): string {
  return cn(
    'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
    active
      ? 'bg-secondary font-medium text-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
  );
}

export default function ChatTabs() {
  const activeConvId = useAskStore((s) => s.activeConvId);
  const history = useAskStore((s) => s.history);
  const liveTasks = useAskStore((s) => s.liveTasks);
  const [activeTab, setActiveTab] = useState<string>(QA_TAB);

  // 切换会话时回到默认「问答」页（面板内展示）
  useEffect(() => {
    setActiveTab(QA_TAB);
  }, [activeConvId]);

  // 当前会话参与过的 AI：历史侧先入表（旧轮次打底），实时任务后入表覆盖（URL 最新）
  const ais = useMemo<ChatTabItem[]>(() => {
    if (!activeConvId) return [];
    const map = new Map<string, ChatTabItem>();
    // history 最新在前 → 逆序遍历，较早轮次先入表、较新的覆盖 URL（保留最新地址）
    for (const h of [...history].reverse()) {
      if ((h.conversationId || h.id) !== activeConvId) continue;
      for (const u of h.aiUrls ?? []) {
        if (!u.url) continue;
        map.set(u.id ?? u.name, { id: u.id, name: u.name, url: u.url });
      }
    }
    for (const task of Object.values(liveTasks)) {
      if (task.conversationId !== activeConvId) continue;
      for (const r of Object.values(task.results)) {
        const prev = map.get(r.aiId);
        map.set(r.aiId, {
          id: r.aiId,
          name: r.aiName,
          url: r.url || prev?.url || '',
        });
      }
    }
    // 无 URL 的项无法唤起问答页，不展示
    return [...map.values()].filter((a) => a.url);
  }, [activeConvId, history, liveTasks]);

  if (getPlatform().kind !== 'tauri' || ais.length === 0) return null;

  /** 切换到某个 AI 的问答页：唤起/复用其子窗口（弹窗显示） */
  const openChat = (ai: ChatTabItem) => {
    const key = ai.id ?? ai.name;
    setActiveTab(key);
    if (!ai.url) return;
    void getPlatform()
      .ask.openAiTab(ai.url, ai.id, ai.name)
      .catch(() => {});
  };

  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 pb-2 pt-1">
      <button
        type="button"
        onClick={() => setActiveTab(QA_TAB)}
        title="在问答面板内查看全部回复"
        className={tabCls(activeTab === QA_TAB)}
      >
        <MessagesSquare className="h-3.5 w-3.5" />
        问答
      </button>
      {ais.map((ai) => {
        const key = ai.id ?? ai.name;
        const active = activeTab === key;
        return (
          <button
            type="button"
            key={key}
            onClick={() => openChat(ai)}
            title={`在窗口中查看 ${ai.name} 的问答页`}
            className={tabCls(active)}
          >
            <AiIcon aiId={ai.id} name={ai.name} size={14} />
            <span className="max-w-[120px] truncate">{ai.name}</span>
          </button>
        );
      })}
    </div>
  );
}
