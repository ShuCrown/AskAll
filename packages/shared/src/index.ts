/**
 * @askall/shared —— 浏览器扩展 + Tauri 桌面端共用的 UI 与逻辑。
 *
 * 任何平台特定能力都通过 `lib/platform` 的 PlatformApi 抽象访问，
 * 由各 App 在启动时注入具体实现。
 */
export * from './utils';
export * from './components';
export {
  useAskStore,
  selectConversations,
  buildTurns,
  isTaskFinished,
} from './store/askStore';
export type { AskStoreState, TurnView } from './store/askStore';
export { getPlatform, setPlatform, hasPlatform } from './lib/platform';
export type {
  PlatformApi,
  PlatformApp,
  PlatformAssets,
  PlatformStorage,
  PlatformWindow,
  PlatformAsk,
  AskGridCell,
  ReplyMessage,
  OpenMode,
} from './lib/platform';
export { PlatformNotSetError } from './lib/platform';
export { cn } from './lib/utils';
