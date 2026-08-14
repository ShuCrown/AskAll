import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@askall/shared';
import { initTauriPlatform } from './platform-tauri';
import './style.css';

// 先注入 Tauri 平台适配器（含同步缓存版本号），再渲染共享 UI。
// initTauriPlatform 内部会调用 getVersion() 异步获取版本并缓存为同步值。
initTauriPlatform()
  .then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        {/*
          桌面端默认落在「提问」Tab；不传 showClose —— 窗口装饰由 OS 提供，
          避免与系统标题栏重复。
        */}
        <App defaultTab="ask" />
      </React.StrictMode>,
    );
  })
  .catch((e) => {
    console.error('[askall-desktop] 初始化平台失败:', e);
    // 即使平台初始化失败也尝试渲染，便于在纯浏览器中预览样式
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App defaultTab="ask" />
      </React.StrictMode>,
    );
  });
