import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@askall/shared';
import { initExtensionPlatform } from '../../src/platform';
import './style.css';

initExtensionPlatform();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App showClose />
  </React.StrictMode>,
);
