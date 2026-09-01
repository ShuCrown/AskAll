import React from 'react';
import ReactDOM from 'react-dom/client';
import { Workspace } from '@askall/shared';
import { initExtensionPlatform } from '../../src/platform';
import './style.css';

initExtensionPlatform();

// 工作台：顶部搜索 + 新话题，历史经搜索弹窗找回。
// 800×600 为 Chrome popup 物理上限。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Workspace />
  </React.StrictMode>,
);
