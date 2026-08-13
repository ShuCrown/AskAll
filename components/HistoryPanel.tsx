import { useEffect, useState } from 'react';
import { getHistory, clearHistory } from '@/utils/history';
import type { HistoryItem } from '@/utils/history';

export default function HistoryPanel() {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    getHistory().then(setHistory);
  }, []);

  const handleClear = async () => {
    await clearHistory();
    setHistory([]);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>历史记录</h2>
        <button className="clear-btn" onClick={handleClear}>
          清空
        </button>
      </div>
      <div className="history-list">
        {history.length === 0 ? (
          <p className="empty">暂无历史记录</p>
        ) : (
          history.map((item) => (
            <div className="history-card" key={item.id}>
              <p className="question">{item.question}</p>
              <p className="meta">
                {new Date(item.timestamp).toLocaleString()} ·{' '}
                {item.aiNames.join(', ')}
              </p>
              <div className="ai-links">
                {item.aiUrls?.map((link) => (
                  <a
                    key={link.name}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="ai-link"
                  >
                    {link.name}
                  </a>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
