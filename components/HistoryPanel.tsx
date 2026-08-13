import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { getHistory, clearHistory } from '@/utils/history';
import type { HistoryItem } from '@/utils/history';
import { Button } from './ui/button';

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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-tight">历史记录</h2>
        <Button variant="outline" size="sm" onClick={handleClear}>
          清空
        </Button>
      </div>

      {history.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          暂无历史记录
        </p>
      ) : (
        history.map((item) => (
          <div key={item.id} className="rounded-lg border bg-card p-3">
            <p className="text-sm font-medium leading-snug">{item.question}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(item.timestamp).toLocaleString()} ·{' '}
              {item.aiNames.join(', ')}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.aiUrls?.map((link, i) => (
                <a
                  key={`${link.name}-${i}`}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent"
                >
                  <ExternalLink className="h-3 w-3" />
                  {link.name}
                </a>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
