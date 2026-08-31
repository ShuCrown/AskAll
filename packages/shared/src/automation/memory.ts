import { getPlatform } from '../lib/platform';
import type { Recipe, StepId, StepReport } from './types';

/**
 * 自愈记忆：记录「每个站点的每一步，哪个策略真的成功了」。
 *
 * 站点改版后可能出现这种情况：配置选择器失效，但通用策略（几何定位、键盘提交）
 * 仍然有效。记忆层会把这次的成功记下来，下次直接把生效的策略提到链首，
 * 不必每次都从失效的选择器开始逐级试错。
 *
 * 本模块运行在 background / 应用侧，通过 PlatformStorage 持久化，
 * 不参与页面注入。
 */

const MEMORY_KEY = 'local:automationMemory';

/** 单个策略的成功失败计数 */
export interface StrategyStat {
  ok: number;
  fail: number;
  lastOkAt?: number;
}

/** 某一步下各策略的统计 */
export type StepMemory = Record<string, StrategyStat>;

/** 某个站点各步骤的统计 */
export interface RecipeMemory {
  steps: Partial<Record<StepId, StepMemory>>;
}

export interface AutomationMemory {
  recipes: Record<string, RecipeMemory>;
}

const emptyMemory = (): AutomationMemory => ({ recipes: {} });

export async function loadMemory(): Promise<AutomationMemory> {
  try {
    const m = await getPlatform().storage.getItem<AutomationMemory>(MEMORY_KEY);
    return m && typeof m === 'object' && m.recipes ? m : emptyMemory();
  } catch {
    return emptyMemory();
  }
}

async function saveMemory(m: AutomationMemory): Promise<void> {
  try {
    await getPlatform().storage.setItem(MEMORY_KEY, m);
  } catch (e) {
    console.warn('[askall] 自愈记忆写入失败:', e);
  }
}

/**
 * 记录一次策略执行结果。
 */
export async function recordStepResult(report: StepReport): Promise<void> {
  if (!report?.recipeId || !report?.stepId || !report?.kind) return;
  const m = await loadMemory();
  const recipe = (m.recipes[report.recipeId] ??= { steps: {} });
  const step = (recipe.steps[report.stepId] ??= {});
  const stat = (step[report.kind] ??= { ok: 0, fail: 0 });
  if (report.ok) {
    stat.ok += 1;
    stat.lastOkAt = Date.now();
  } else {
    stat.fail += 1;
  }
  await saveMemory(m);
}

/** 净成功分：样本太少时视为 0，避免偶然一次失败就改变既有顺序 */
function scoreOf(s: StrategyStat | undefined): number {
  if (!s) return 0;
  if (s.ok + s.fail < 2) return 0;
  return s.ok - s.fail;
}

/** 记忆键带版本：Recipe 升版（修正策略链/判定逻辑）后旧统计自动作废，
 *  避免按旧逻辑记录的成败（如曾经的假成功）继续主导新链的排序 */
function memoryKey(recipeId: string, version: number): string {
  return `${recipeId}@v${version}`;
}

/**
 * 把记忆应用到 Recipe：按历史表现为每步的策略重新排序。
 *
 * 排序是稳定的，因此未记录或同为 0 分的策略保持配置里的原始顺序，
 * 配置里「先具体后通用」的降级语义不会被打乱。
 */
export function applyMemory(recipe: Recipe, memory: AutomationMemory): Recipe {
  const rm = memory.recipes[memoryKey(recipe.id, recipe.version)];
  if (!rm?.steps) return recipe;

  const steps = recipe.steps.map((step) => {
    const sm = rm.steps[step.id];
    if (!sm) return step;
    const strategies = step.strategies
      .map((s, i) => ({ s, i, score: scoreOf(sm[s.kind]) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.s);
    return { ...step, strategies };
  });

  return { ...recipe, steps };
}

/** 清空全部自愈记忆（设置面板「重置自愈记忆」用） */
export async function clearMemory(): Promise<void> {
  await saveMemory(emptyMemory());
}
