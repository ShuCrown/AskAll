/**
 * SettingsApp —— 独立设置载体（v1.1）。
 *
 * 桌面端：独立设置窗口（#settings 路由渲染本组件）；
 * 扩展端：options 页渲染本组件。
 * 内容与原「AI 配置」Tab 一致（AiConfigPanel），openMode 状态自持。
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import AiConfigPanel from '../AiConfigPanel';
import { getPlatform } from '../../lib/platform';
import type { OpenMode } from '../../lib/platform';
import { isMacTauri } from './SessionSidebar';

const OPEN_MODE_KEY = 'local:openMode';

export default function SettingsApp() {
  const [openMode, setOpenMode] = useState<OpenMode>('embedded');
  const [version, setVersion] = useState('');

  useEffect(() => {
    setVersion(getPlatform().app.getVersion());
    getPlatform()
      .storage.getItem<OpenMode>(OPEN_MODE_KEY)
      .then((mode) => {
        if (mode === 'browser' || mode === 'embedded') setOpenMode(mode);
      });
  }, []);

  const handleModeChange = async (mode: OpenMode) => {
    setOpenMode(mode);
    await getPlatform().storage.setItem(OPEN_MODE_KEY, mode);
  };

  const handleClose = () => {
    getPlatform().window.close().catch(() => {});
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div
        data-tauri-drag-region
        className={`flex shrink-0 items-center justify-between border-b bg-card py-4 ${
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
        <button
          type="button"
          onClick={handleClose}
          aria-label="关闭"
          title="关闭"
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <AiConfigPanel openMode={openMode} onModeChange={handleModeChange} />
      </div>
    </div>
  );
}
