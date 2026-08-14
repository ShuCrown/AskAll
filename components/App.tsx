import { useState, useEffect } from 'react';
import { Settings, History } from 'lucide-react';
import AiConfigPanel from './AiConfigPanel';
import HistoryPanel from './HistoryPanel';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

export default function App() {
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

  return (
    <div className="app-container relative">
      <span className="absolute bottom-1 left-2 select-none text-[10px] leading-none text-muted-foreground/60">
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
  );
}
