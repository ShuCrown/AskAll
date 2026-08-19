/**
 * prefs.ts —— 工作台 UI 偏好：快捷提问提示词、上次选中的 AI 厂商。
 *
 * v1.1 新增。均通过 PlatformApi.storage 持久化，两端共享同一套读写逻辑。
 */
import { getPlatform } from '../lib/platform';

/** 快捷提问提示词（空态页 chips，点击填入输入框） */
export interface AiHint {
  id: string;
  text: string;
  /** 内置默认提示词（用户管理界面在 P5 提供） */
  isDefault?: boolean;
}

const HINTS_KEY = 'local:aiHints';
const LAST_SELECTED_KEY = 'local:lastSelectedAis';

/** 内置默认提示词：面向「多 AI 对比提问」场景的通用模板 */
export const DEFAULT_AI_HINTS: AiHint[] = [
  {
    id: 'hint-summarize',
    text: '总结这段内容的核心要点，并列出 3 个值得深入追问的问题',
    isDefault: true,
  },
  {
    id: 'hint-explain',
    text: '用通俗易懂的方式解释这个概念，并举一个贴切的例子',
    isDefault: true,
  },
  {
    id: 'hint-compare',
    text: '对比几种方案的优缺点，给出选型建议',
    isDefault: true,
  },
  {
    id: 'hint-translate',
    text: '翻译成中文（或英文），保留技术术语与原格式',
    isDefault: true,
  },
  {
    id: 'hint-review',
    text: '指出这段方案/代码的潜在问题，并给出改进建议',
    isDefault: true,
  },
];

/** 读取提示词列表；未自定义时返回内置默认 */
export async function getAiHints(): Promise<AiHint[]> {
  const stored = await getPlatform().storage.getItem<AiHint[]>(HINTS_KEY);
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_AI_HINTS;
  return stored;
}

/** 保存（整体覆盖）提示词列表 */
export async function saveAiHints(hints: AiHint[]): Promise<void> {
  await getPlatform().storage.setItem(HINTS_KEY, hints);
}

/** 读取上次选中的 AI 厂商 id 列表；从未保存过返回 null */
export async function getLastSelectedAis(): Promise<string[] | null> {
  const stored =
    await getPlatform().storage.getItem<string[]>(LAST_SELECTED_KEY);
  return Array.isArray(stored) ? stored : null;
}

/** 持久化当前选中的 AI 厂商 id 列表 */
export async function setLastSelectedAis(ids: string[]): Promise<void> {
  await getPlatform().storage.setItem(LAST_SELECTED_KEY, ids);
}
