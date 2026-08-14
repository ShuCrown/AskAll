import { useState, useEffect } from 'react';
import { MessageSquare, Settings, History, X } from 'lucide-react';
import AiConfigPanel from './AiConfigPanel';
import AskPanel from './AskPanel';
import HistoryPanel from './HistoryPanel';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { getPlatform } from '../lib/platform';

type AppTab = 'ask' | 'config' | 'history';

interface AppProps {
  /** 弹窗场景（popup）下显示右上角关闭按钮 */
  showClose?: boolean;
  /** 初始展示的 Tab；桌面端默认「提问」，扩展端默认「AI 配置」 */
  defaultTab?: AppTab;
}

export default function App({ showClose, defaultTab = 'config' }: AppProps = {}) {
  const [activeTab, setActiveTab] = useState<AppTab>(defaultTab);
  const [openMode, setOpenMode] = useState<'embedded' | 'browser'>('embedded');
  const [version, setVersion] = useState('');

  useEffect(() => {
    setVersion(getPlatform().app.getVersion());
  }, []);

  useEffect(() => {
    getPlatform().storage.getItem<'embedded' | 'browser'>('local:openMode').then((data) => {
      if (data) setOpenMode(data);
    });
  }, []);

  // 监听平台派发的导航事件（桌面端 window.openSettings 会触发，
  // 切换到「AI 配置」Tab；扩展端不会派发，监听为空操作）。
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tab?: AppTab } | undefined;
      if (detail?.tab) setActiveTab(detail.tab);
    };
    window.addEventListener('askall-navigate', onNavigate);
    return () => window.removeEventListener('askall-navigate', onNavigate);
  }, []);

  const handleModeChange = async (mode: 'embedded' | 'browser') => {
    setOpenMode(mode);
    await getPlatform().storage.setItem('local:openMode', mode);
  };

  const handleClose = async () => {
    await getPlatform().window.close();
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 弹窗标题栏：仅 popup/options 场景显示，横跨整行，底部分隔线与内容区隔开 */}
      {showClose && (
        <div className="askall-titlebar flex shrink-0 items-center justify-between border-b bg-card px-3 py-2">
          <span className="flex items-center gap-2">
            <img
              src={getPlatform().assets.assetUrl('icon/128.png')}
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
              variant={activeTab === 'ask' ? 'secondary' : 'ghost'}
              size="sm"
              className={cn(
                'justify-start',
                activeTab === 'ask' && 'text-primary',
              )}
              onClick={() => setActiveTab('ask')}
            >
              <MessageSquare className="h-4 w-4" />
              提问
            </Button>
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
          {activeTab === 'ask' ? (
            <AskPanel />
          ) : activeTab === 'config' ? (
            <AiConfigPanel openMode={openMode} onModeChange={handleModeChange} />
          ) : (
            <HistoryPanel />
          )}
        </main>
      </div>
    </div>
  );
}
