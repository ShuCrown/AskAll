/**
 * EmptyState —— 无激活会话时的新提问页。
 * 品牌区 + 单个输入框（Composer）。
 */
import { useState } from 'react';
import { getPlatform } from '../../lib/platform';
import { useAskStore } from '../../store/askStore';
import Composer from './Composer';

export default function EmptyState() {
  const [draft, setDraft] = useState('');
  const ask = useAskStore((s) => s.ask);

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
          一个问题，同时问多个 AI。
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
    </div>
  );
}
