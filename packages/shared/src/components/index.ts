export { default as AiConfigPanel } from './AiConfigPanel';
// 网页内浮层版工作台（扩展端右击/划词入口，与 popup/桌面共用同一 Workspace）
export { default as PageWorkspace } from './PageWorkspace';

// v1.1 工作台组件（左历史 + 右时间线；设置独立载体）
export { default as Workspace } from './workspace/Workspace';
export type { WorkspaceDensity } from './workspace/Workspace';
export { default as SessionSidebar } from './workspace/SessionSidebar';
export { default as GridChat } from './workspace/GridChat';
export { default as ChatView } from './workspace/ChatView';
export { default as AiAnswerCard } from './workspace/AiAnswerCard';
export { default as Composer } from './workspace/Composer';
export { default as EmptyState } from './workspace/EmptyState';
export { default as SettingsApp } from './workspace/SettingsApp';
export { default as AiIcon } from './workspace/AiIcon';

// shadcn-style UI 原子组件
export * from './ui/badge';
export * from './ui/button';
export * from './ui/checkbox';
export * from './ui/input';
export * from './ui/label';
export * from './ui/select';
export * from './ui/switch';
export * from './ui/table';
