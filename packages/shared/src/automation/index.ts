/**
 * 自动化内核：把「一次提问」固化为可配置、可降级、可自愈的流水线。
 *
 * 分层职责：
 * - types.ts    纯类型（编译期擦除，可被注入脚本安全引用）
 * - recipes.ts  Recipe 数据（内置配置，纯数据可热更）
 * - engine.ts   runAutomation：注入页面的自包含执行引擎，内含全部策略实现
 * - memory.ts   自愈记忆，运行在 background / 应用侧
 */
export type {
  StepId,
  StrategyKind,
  StrategyDef,
  StrategyParams,
  LocateParams,
  SubmitParams,
  ObserveParams,
  AttachParams,
  StepDef,
  Recipe,
  RunMeta,
  StepReport,
  DomSnapshot,
  AttachmentPayload,
} from './types';
export { runAutomation } from './engine';
export {
  DEFAULT_RECIPES,
  genericSteps,
  getRecipe,
  buildGenericRecipe,
  resolveRecipe,
} from './recipes';
export type {
  StrategyStat,
  StepMemory,
  RecipeMemory,
  AutomationMemory,
} from './memory';
export {
  loadMemory,
  recordStepResult,
  applyMemory,
  clearMemory,
} from './memory';
