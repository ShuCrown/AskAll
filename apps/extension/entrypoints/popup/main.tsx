import React from 'react';
import ReactDOM from 'react-dom/client';
import { Workspace } from '@askall/shared';
import { initExtensionPlatform } from '../../src/platform';
import './style.css';

initExtensionPlatform();

// v1.1：popup 承载 compact 工作台（单栏时间线 + 底部输入 + 历史抽屉）。
// 800×600 为 Chrome popup 物理上限，双栏放不下，故显式指定 compact。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Workspace density="compact" />
  </React.StrictMode>,
);
