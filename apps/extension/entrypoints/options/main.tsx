import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsApp } from '@askall/shared';
import { initExtensionPlatform } from '../../src/platform';
import './style.css';

initExtensionPlatform();

// v1.1：options 页定位不变，仍是设置页——渲染独立设置载体 SettingsApp，
// 与桌面端「独立设置窗口」一一对应。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>,
);
