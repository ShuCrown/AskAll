/**
 * SettingsApp —— 独立设置载体（v1.1）。
 *
 * 扩展端：options 页渲染本组件，浏览器标签页由用户自行关闭（脚本无法关闭普通标签页）。
 * 内容为 AiConfigPanel。
 */
import { useEffect, useState } from 'react';
import AiConfigPanel from '../AiConfigPanel';
import { getPlatform } from '../../lib/platform';

export default function SettingsApp() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    setVersion(getPlatform().app.getVersion());
  }, []);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center border-b bg-card px-2 py-4">
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
