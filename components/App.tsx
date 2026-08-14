import { useState, useEffect } from 'react';
import { Settings, History, X } from 'lucide-react';
import AiConfigPanel from './AiConfigPanel';
import HistoryPanel from './HistoryPanel';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface AppProps {
  /** 弹窗场景（popup）下显示右上角关闭按钮 */
  showClose?: boolean;
}

export default function App({ showClose }: AppProps = {}) {
  const [activeTab, setActiveTab] = useState<'config' | 'history'>('config');
  const [openMode, setOpenMode] = useState<'tabs' | 'windows'>('tabs');
  const [version, setVersion] = useState('');

  useEffect(() => {
    setVersion(browser.runtime.getManifest().version);
  }, []);

  useEffect(() => {
    storage.getItem('local:openMode').then((data) => {
      if (data) setOpenMode(data as 'tabs' | 'windows');
    });
  }, []);

  const handleModeChange = async (mode: 'tabs' | 'windows') => {
    setOpenMode(mode);
    await storage.setItem('local:openMode', mode);
  };

  const handleClose = async () => {
    // popup 弹窗：window.close() 有效
    try {
      window.close();
    } catch {
      /* 忽略 */
    }
    // options 标签页：window.close() 会被浏览器忽略，改用 tabs API 关闭当前标签页
    try {
      const current = await browser.tabs.getCurrent();
      if (current?.id != null) {
        await browser.tabs.remove(current.id);
      }
    } catch {
      /* 非扩展页面环境忽略 */
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 弹窗标题栏：仅 popup/options 场景显示，横跨整行，底部分隔线与内容区隔开 */}
      {showClose && (
        <div className="askall-titlebar flex shrink-0 items-center justify-between border-b bg-card px-3 py-2">
          <span className="flex items-center gap-2">
            <img
              src={(browser.runtime.getURL as (p: string) => string)(
                '/icon/128.png',
              )}
              alt="AskAll 齐问"
              className="h-4 w-4 rounded-[4px]"
            />
            <span className="text-sm font-semibold tracking-tight">
              AskAll 齐问
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
      )}
      <div className="app-container relative min-h-0 flex-1">
        <span className="absolute bottom-2 left-3 select-none text-[10px] leading-none text-muted-foreground/60">
          v{version}
        </span>
        <aside className="flex w-[180px] shrink-0 flex-col gap-1 overflow-y-auto border-r bg-card px-3 pb-12 pt-3">
          <nav className="flex flex-col gap-1">
            <Button
              variant={activeTab === 'config' ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'justify-start',
                activeTab === 'config' && 'text-primary',
              )}
              onClick={() => setActiveTab('config')}
            >
              <Settings className="h-4 w-4" />
              AI 配置
            </Button>
            <Button
              variant={activeTab === 'history' ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'justify-start',
                activeTab === 'history' && 'text-primary',
              )}
              onClick={() => setActiveTab('history')}
            >
              <History className="h-4 w-4" />
              历史记录
            </Button>
          </nav>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-10 pt-4">
          {activeTab === 'config' ? (
            <AiConfigPanel openMode={openMode} onModeChange={handleModeChange} />
          ) : (
            <HistoryPanel />
          )}
        </main>
      </div>
    </div>
  );
}
