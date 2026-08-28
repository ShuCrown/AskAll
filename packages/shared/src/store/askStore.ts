/**
 * askStore —— 工作台状态中枢（zustand）。
 *
 * v1.1 新增。核心原则（见设计方案第四/十一章）：
 *   1. 历史存储（local:history）是会话列表的唯一数据源；
 *      实时流按 taskId 存入 liveTasks，渲染时按轮次合并。
 *   2. AI_REPLY 消息在两端均为「全量文本」（非增量），合并时用替换而非追加。
 *   3. 历史写入按平台分流：扩展端由 background 写；桌面端由本 store 写。
 *      组件层永远不直接写历史。
 *   4. 挂载即 hydrate：popup 失焦销毁后重开、桌面冷启动，都从
 *      getTask() + history 重建视图，不依赖内存残留。
 */
import { create } from 'zustand';
import { getPlatform, type ReplyMessage } from '../lib/platform';
import {
  addHistory,
  getHistory,
  groupConversations,
  isFallbackNotice,
  mergeAnswer,
  updateHistoryUrl,
  type Conversation,
  type HistoryItem,
} from '../utils/history';
import { mergeConfigs, type AiConfig } from '../utils/aiConfig';
import {
  getLastSelectedAis,
  getPinnedConversations,
  setLastSelectedAis,
  setPinnedConversations,
} from '../utils/prefs';
import type { AiResult, AskTask } from '../utils/task';

const AI_CONFIGS_KEY = 'local:aiConfigs';

/** 判断任务是否已到达终态（所有 AI 均 done/error） */
export function isTaskFinished(task: AskTask): boolean {
  const results = Object.values(task.results);
  if (results.length === 0) return false;
  return results.every((r) => r.status === 'done' || r.status === 'error');
}

/** 时间线轮次视图：一条历史记录（可叠加进行中的实时任务状态） */
export interface TurnView {
  /** 历史记录 id；未落盘的实时轮次为空 */
  historyId?: string;
  question: string;
  timestamp: number;
  /** 关联的实时任务 id（进行中或最近一次） */
  taskId?: string;
  /** 该轮是否仍有 AI 未完成 */
  live: boolean;
  /** 各 AI 的会话链接（历史侧） */
  aiUrls: { id?: string; name: string; url: string }[];
  /** 历史侧已落盘的回答快照 */
  answers?: HistoryItem['answers'];
  /** 实时侧的各 AI 状态与文本（优先于快照展示） */
  liveResults?: Record<string, AiResult>;
}

export interface AskStoreState {
  hydrated: boolean;
  /** 全量历史（最新在前），会话列表由此派生 */
  history: HistoryItem[];
  /** 当前打开的会话 key（conversationId）；null = 新提问空态 */
  activeConvId: string | null;
  /** taskId -> 实时任务（进行中 + 最近任务） */
  liveTasks: Record<string, AskTask>;
  /** taskId -> historyId 映射（桌面端落盘回答快照用） */
  taskHistory: Record<string, string>;
  /** AI 配置（已合并默认项） */
  configs: AiConfig[];
  /** 本次选中的厂商 id（持久化 local:lastSelectedAis） */
  selected: string[];
  sending: boolean;
  /** 外部提问注入（OS 级划词/右键菜单），由 Composer 消费 */
  pendingQuestion: string | null;
  /** 置顶会话 key 列表（顺序即置顶顺序，最新在前；持久化 local:pinnedConversations） */
  pinned: string[];

  hydrate: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  refreshConfigs: () => Promise<void>;
  ask: (text: string) => Promise<void>;
  followUp: (text: string) => Promise<void>;
  applyReply: (msg: ReplyMessage) => void;
  openConversation: (key: string) => void;
  newConversation: () => void;
  toggleVendor: (id: string) => void;
  togglePin: (key: string) => void;
  setPendingQuestion: (text: string | null) => void;
}

export const useAskStore = create<AskStoreState>()((set, get) => {
  /**
   * 发起提问（ask / followUp）后的统一同步流程：
   *   1. getTask() 取回编排器创建的任务（含 taskId / conversationId）；
   *   2. 桌面端：由 store 写入历史（扩展端由 background 写，此处仅轮询等待）；
   *   3. 激活该会话，驱动右侧时间线展示实时进度。
   */
  async function syncAfterDispatch(kind: 'ask' | 'followup'): Promise<void> {
    const platform = getPlatform();
    const { task } = await platform.ask.getTask();
    if (!task) return;

    const convId = task.conversationId;
    set((s) => ({
      activeConvId: convId,
      liveTasks: { ...s.liveTasks, [task.id]: task },
    }));

    if (platform.kind === 'tauri') {
      // 桌面端历史由 store 写入（修复 v1.0 桌面历史缺失问题）
      const names = Object.values(task.results).map((r) => r.aiName);
      const urls = Object.values(task.results).map((r) => ({
        id: r.aiId,
        name: r.aiName,
        url: r.url ?? '',
      }));
      const item = await addHistory(task.question, names, urls, convId);
      set((s) => ({
        taskHistory: { ...s.taskHistory, [task.id]: item.id },
      }));
      await get().refreshHistory();
    } else {
      // 扩展端：background 异步写历史，轮询等待其落盘（最多 ~2s），
      // 期间右侧时间线仍可凭 liveTasks 展示实时进度。
      const deadline = Date.now() + 2000;
      for (;;) {
        const items = await getHistory();
        const found = items.some((h) => h.conversationId === convId);
        set({ history: items });
        if (found || Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    void kind; // 预留：两种发起目前同步流程一致
  }

  return {
    hydrated: false,
    history: [],
    activeConvId: null,
    liveTasks: {},
    taskHistory: {},
    configs: [],
    selected: [],
    sending: false,
    pendingQuestion: null,
    pinned: [],

    hydrate: async () => {
      const platform = getPlatform();
      const [history, storedConfigs, lastSel, pinned] = await Promise.all([
        getHistory(),
        platform.storage.getItem<AiConfig[]>(AI_CONFIGS_KEY),
        getLastSelectedAis(),
        getPinnedConversations(),
      ]);
      const configs = mergeConfigs(storedConfigs ?? null);
      const enabledIds = new Set(
        configs.filter((c) => c.enabled).map((c) => c.id),
      );
      // 新话题默认选择 = 设置中「启用」勾选的 AI；持久化选择同样过滤停用项
      const selected =
        lastSel && lastSel.some((id) => enabledIds.has(id))
          ? lastSel.filter((id) => enabledIds.has(id))
          : [...enabledIds];

      // 恢复进行中的任务（popup 重开 / 冷启动均可续看进度）
      const liveTasks: Record<string, AskTask> = {};
      try {
        const { task } = await platform.ask.getTask();
        if (task) liveTasks[task.id] = task;
      } catch {
        /* 取不到任务时按空处理 */
      }

      set({
        hydrated: true,
        history,
        configs,
        selected,
        liveTasks,
        pinned,
      });
    },

    refreshHistory: async () => {
      set({ history: await getHistory() });
    },

    refreshConfigs: async () => {
      const platform = getPlatform();
      const stored = await platform.storage.getItem<AiConfig[]>(
        AI_CONFIGS_KEY,
      );
      const configs = mergeConfigs(stored ?? null);
      set((s) => {
        const enabledIds = new Set(
          configs.filter((c) => c.enabled).map((c) => c.id),
        );
        // 跟随「启用」勾选：停用的 AI 从当前选择中移除；为空时默认全选启用项
        let selected = s.selected.filter((id) => enabledIds.has(id));
        if (selected.length === 0) {
          selected = [...enabledIds];
        }
        return { configs, selected };
      });
    },

    ask: async (text) => {
      const { selected, sending } = get();
      const t = text.trim();
      if (!t || sending || selected.length === 0) return;
      set({ sending: true });
      try {
        await getPlatform().ask.ask(t, selected);
        await syncAfterDispatch('ask');
      } finally {
        set({ sending: false });
      }
    },

    followUp: async (text) => {
      const { selected, sending } = get();
      const t = text.trim();
      if (!t || sending || selected.length === 0) return;
      set({ sending: true });
      try {
        await getPlatform().ask.followUp(t, selected);
        await syncAfterDispatch('followup');
      } finally {
        set({ sending: false });
      }
    },

    applyReply: (msg) => {
      set((s) => {
        const cur =
          s.liveTasks[msg.taskId] ??
          ({
            id: msg.taskId,
            question: '',
            createdAt: Date.now(),
            conversationId: s.activeConvId ?? '',
            results: {},
          } satisfies AskTask);
        const result: AiResult = cur.results[msg.aiId] ?? {
          aiId: msg.aiId,
          aiName: msg.aiName,
          status: 'opening',
          answer: '',
        };
        // 两端 AI_REPLY/AI_REPLY_DONE 均为全量文本：替换而非追加；
        // 携带 url 时同步更新真实会话地址（chat/xxx），供 chat tabs 跳转
        const next: AiResult =
          msg.type === 'AI_SENDING'
            ? { ...result, status: 'sending' }
            : msg.type === 'AI_REPLY'
              ? {
                  ...result,
                  status: 'streaming',
                  answer: msg.text,
                  ...(msg.url ? { url: msg.url } : {}),
                }
              : {
                  ...result,
                  status: 'done',
                  answer: msg.text,
                  ...(msg.url ? { url: msg.url } : {}),
                };
        return {
          liveTasks: {
            ...s.liveTasks,
            [msg.taskId]: {
              ...cur,
              results: { ...cur.results, [msg.aiId]: next },
            },
          },
        };
      });

      // 回答完成：桌面端由 store 落盘快照与真实会话 URL；随后统一刷新历史
      // （扩展端快照由 background 写入，这里只是把最新存储读回来）
      if (msg.type === 'AI_REPLY_DONE') {
        const s = get();
        const historyId = s.taskHistory[msg.taskId];
        if (getPlatform().kind === 'tauri' && historyId) {
          const writes = [mergeAnswer(historyId, msg.aiId, msg.aiName, msg.text)];
          // 真实会话地址（chat/xxx）回写历史：历史回放与 chat tabs 跳转据此直达会话页。
          // 兜底提示（自动发送失败）不算真实回答，不回写地址。
          if (msg.url && !isFallbackNotice(msg.text)) {
            writes.push(updateHistoryUrl(historyId, msg.aiId, msg.aiName, msg.url));
          }
          void Promise.all(writes).then(() => get().refreshHistory());
        } else {
          void get().refreshHistory();
        }
      }
    },

    openConversation: (key) => set({ activeConvId: key }),

    newConversation: () => set({ activeConvId: null, pendingQuestion: null }),

    toggleVendor: (id) => {
      set((s) => {
        const selected = s.selected.includes(id)
          ? s.selected.filter((x) => x !== id)
          : [...s.selected, id];
        void setLastSelectedAis(selected);
        return { selected };
      });
    },

    togglePin: (key) => {
      set((s) => {
        const pinned = s.pinned.includes(key)
          ? s.pinned.filter((x) => x !== key)
          : [key, ...s.pinned];
        void setPinnedConversations(pinned);
        return { pinned };
      });
    },

    setPendingQuestion: (text) => set({ pendingQuestion: text }),
  };
});

/** 派生：会话列表（最新在前） */
export function selectConversations(history: HistoryItem[]): Conversation[] {
  return groupConversations(history);
}

/**
 * 派生：某会话的时间线轮次（时间正序，便于从上到下阅读）。
 * 历史侧提供已落盘的问题/链接/快照；实时侧（liveTasks）叠加进行中状态。
 */
export function buildTurns(
  state: Pick<AskStoreState, 'history' | 'liveTasks' | 'taskHistory'>,
  convKey: string,
): TurnView[] {
  const items = state.history.filter(
    (h) => (h.conversationId || h.id) === convKey,
  );
  // history 最新在前 → 反转为时间正序
  const turns: TurnView[] = [...items].reverse().map((h) => ({
    historyId: h.id,
    question: h.question,
    timestamp: h.timestamp,
    live: false,
    aiUrls: h.aiUrls ?? [],
    answers: h.answers,
  }));

  // 关联实时任务：taskId -> historyId 映射；或会话内尚未落盘的实时任务
  const historyIdToTask = new Map<string, AskTask>();
  const orphanTasks: AskTask[] = [];
  for (const task of Object.values(state.liveTasks)) {
    if (task.conversationId !== convKey) continue;
    const hid = state.taskHistory[task.id];
    if (hid) historyIdToTask.set(hid, task);
    else orphanTasks.push(task);
  }

  for (const turn of turns) {
    const task = turn.historyId ? historyIdToTask.get(turn.historyId) : undefined;
    if (!task) continue;
    turn.taskId = task.id;
    turn.live = !isTaskFinished(task);
    turn.liveResults = task.results;
    if (!turn.question && task.question) turn.question = task.question;
  }

  // 尚未落盘的实时轮次（发起后、历史写入前的间隙）追加在末尾
  for (const task of orphanTasks.sort((a, b) => a.createdAt - b.createdAt)) {
    turns.push({
      question: task.question,
      timestamp: task.createdAt,
      taskId: task.id,
      live: !isTaskFinished(task),
      aiUrls: Object.values(task.results).map((r) => ({
        id: r.aiId,
        name: r.aiName,
        url: r.url ?? '',
      })),
      liveResults: task.results,
    });
  }

  return turns;
}
