import { useState, useEffect } from 'react';
import AiConfigPanel from './AiConfigPanel';
import HistoryPanel from './HistoryPanel';

export default function App() {
  const [activeTab, setActiveTab] = useState<'config' | 'history'>('config');
  const [openMode, setOpenMode] = useState<'tabs' | 'windows'>('tabs');

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
    <div className="app-container">
      <aside className="sidebar">
        <h1 className="logo">🤖 Multi AI Ask</h1>
        <nav>
          <button
            className={`nav-item ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => setActiveTab('config')}
          >
            ⚙️ AI 配置
          </button>
          <button
            className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            📚 历史记录
          </button>
        </nav>
      </aside>
      <main className="content">
        {activeTab === 'config' ? (
          <AiConfigPanel openMode={openMode} onModeChange={handleModeChange} />
        ) : (
          <HistoryPanel />
        )}
      </main>
    </div>
  );
}
