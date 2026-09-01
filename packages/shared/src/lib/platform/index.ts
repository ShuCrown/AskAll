/**
 * 平台注册中心。
 *
 * 用法：
 *   1. App 启动时调用 `setPlatform(adapter)` 注入对应平台的实现。
 *   2. 共享 UI / 工具函数通过 `getPlatform()` 取用，不直接依赖任何平台 API。
 *
 * 选择「全局单例」而非 React Context：因为 storage / ask 等能力会被非组件
 * 代码（如 utils/history.ts）调用，Context 无法覆盖。全局单例最简单可靠。
 */
import type { PlatformApi } from './types';
import { PlatformNotSetError } from './types';

let current: PlatformApi | null = null;

export function setPlatform(api: PlatformApi): void {
  current = api;
}

export function getPlatform(): PlatformApi {
  if (!current) {
    throw new PlatformNotSetError();
  }
  return current;
}

/** 是否已注入平台（用于条件初始化）。 */
export function hasPlatform(): boolean {
  return current !== null;
}

/** macOS + Tauri：overlay 标题栏下需为红绿灯预留左侧空间 */
export function isMacTauri(): boolean {
  return (
    getPlatform().kind === 'tauri' &&
    typeof navigator !== 'undefined' &&
    /Mac/i.test(navigator.platform)
  );
}

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
} from './types';
export { PlatformNotSetError } from './types';
