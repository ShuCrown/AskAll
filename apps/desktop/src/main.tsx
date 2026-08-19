import React from 'react';
import ReactDOM from 'react-dom/client';
import { Workspace, SettingsApp } from '@askall/shared';
import { initTauriPlatform } from './platform-tauri';
import './style.css';

/**
 * v1.1 入口分流（同一份 SPA 产物支撑两个窗口）：
 *   - 主窗口（无 hash）     → Workspace：左历史栏 + 右时间线工作区
 *   - 设置窗口（#settings） → SettingsApp：独立设置窗口内容
 */
const isSettings = window.location.hash.includes('settings');

// 先注入 Tauri 平台适配器（含同步缓存版本号），再渲染共享 UI。
initTauriPlatform()
  .then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>{isSettings ? <SettingsApp /> : <Workspace />}</React.StrictMode>,
    );
  })
  .catch((e) => {
    console.error('[askall-desktop] 初始化平台失败:', e);
    // 即使平台初始化失败也尝试渲染，便于在纯浏览器中预览样式
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>{isSettings ? <SettingsApp /> : <Workspace />}</React.StrictMode>,
    );
  });
