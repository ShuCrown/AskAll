/**
 * 面板展开（最大化）状态共享。
 *
 * PageWorkspace 最大化时置 true，供内部视图（ChatView 等）感知并响应式
 * 延展内容区宽度（默认阅读宽度 max-w-3xl，最大化后铺满）。不包裹
 * Provider 的场景取默认值 false，行为不变。
 */
import { createContext } from 'react';

export const PanelExpandedContext = createContext(false);
