/**
 * SettingsApp —— 独立设置载体（v1.1）。
 *
 * 桌面端：独立设置窗口（#settings 路由渲染本组件），右上角不设关闭按钮——
 * macOS 红绿灯 / Windows 窗口按钮即可关闭；
 * 扩展端：options 页渲染本组件，浏览器标签页由用户自行关闭（脚本无法关闭普通标签页）。
 * 内容为 AiConfigPanel。
 */
import { useEffect, useState } from 'react';
import AiConfigPanel from '../AiConfigPanel';
import { getPlatform } from '../../lib/platform';
import { isMacTauri } from './SessionSidebar';

export default function SettingsApp() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    setVersion(getPlatform().app.getVersion());
  }, []);

  return (
    <div className="flex h-full flex-col bg-background">
      <div
        data-tauri-drag-region
        className={`flex shrink-0 items-center border-b bg-card py-4 ${
          isMacTauri() ? 'pl-[74px] pr-2' : 'px-2'
        }`}
      >
        <span className="flex items-center gap-2">
          <img
            src={getPlatform().assets.assetUrl('icon/128.png')}
            alt="AskAll 齐问"
            className="h-4 w-4 rounded-[4px]"
          />
          <span className="text-sm font-semibold tracking-tight">
            AskAll 齐问 · 设置
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            v{version}
          </span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <AiConfigPanel />
      </div>
    </div>
  );
}
