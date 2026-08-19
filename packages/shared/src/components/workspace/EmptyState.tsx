/**
 * EmptyState —— 无激活会话时的新提问页。
 * 大输入框 + 快捷提问提示词 chips（local:aiHints）。
 */
import { useEffect, useState } from 'react';
import { getPlatform } from '../../lib/platform';
import { getAiHints, type AiHint } from '../../utils/prefs';
import { useAskStore } from '../../store/askStore';
import Composer from './Composer';

export default function EmptyState() {
  const [hints, setHints] = useState<AiHint[]>([]);
  const [draft, setDraft] = useState('');
  const ask = useAskStore((s) => s.ask);
  const version = getPlatform().app.getVersion();

  useEffect(() => {
    getAiHints().then(setHints).catch(() => {});
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-2">
        <img
          src={getPlatform().assets.assetUrl('icon/128.png')}
          alt="AskAll 齐问"
          className="h-12 w-12 rounded-xl"
        />
        <h1 className="text-lg font-semibold tracking-tight">AskAll 齐问</h1>
        <p className="text-sm text-muted-foreground">
          一个问题，同时问多个 AI。输入问题或点击下方提示词开始。
        </p>
      </div>

      <div className="w-full max-w-2xl">
        <Composer
          value={draft}
          onValueChange={setDraft}
          onSubmit={(t) => void ask(t)}
          autoFocus
        />
      </div>

      <div className="flex max-w-2xl flex-wrap justify-center gap-2">
        {hints.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => setDraft(h.text)}
            className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {h.text}
          </button>
        ))}
      </div>

      <span className="text-[10px] text-muted-foreground/60">v{version}</span>
    </div>
  );
}
