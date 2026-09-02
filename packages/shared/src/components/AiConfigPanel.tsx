import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { mergeConfigs } from '../utils/aiConfig';
import type { AiConfig } from '../utils/aiConfig';
import { getPlatform } from '../lib/platform';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './ui/table';

const AI_CONFIGS_KEY = 'local:aiConfigs';
/** 聊天卡片布局：grid = 田字格（多列，奇数占满整行）；single = 单列（一个一行） */
const CHAT_LAYOUT_KEY = 'local:chatLayout';
export type ChatLayout = 'grid' | 'single';

export default function AiConfigPanel() {
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [notifyOnDone, setNotifyOnDone] = useState(true);
  const [chatLayout, setChatLayout] = useState<ChatLayout>('grid');

  useEffect(() => {
    getPlatform().storage.getItem(AI_CONFIGS_KEY).then((data) => {
      // 复用共享 mergeConfigs：内置项顺序按存储顺序（箭头调序生效），
      // 新出现的默认项补在末尾，自定义项跟在默认项之后
      setAiConfigs(mergeConfigs(data as AiConfig[] | null));
    });
    getPlatform().storage.getItem('local:notifyOnDone').then((v) => {
      if (typeof v === 'boolean') setNotifyOnDone(v);
    });
    getPlatform().storage.getItem(CHAT_LAYOUT_KEY).then((v) => {
      if (v === 'single' || v === 'grid') setChatLayout(v);
    });
  }, []);

  const changeChatLayout = async (v: ChatLayout) => {
    setChatLayout(v);
    await getPlatform().storage.setItem(CHAT_LAYOUT_KEY, v);
  };

  const updateConfig = async (id: string, updates: Partial<AiConfig>) => {
    const updated = aiConfigs.map((ai) =>
      ai.id === id ? { ...ai, ...updates } : ai,
    );
    setAiConfigs(updated);
    await getPlatform().storage.setItem(AI_CONFIGS_KEY, updated);
  };

  const addAi = () => {
    const newAi: AiConfig = {
      id: Date.now().toString(),
      name: '新 AI',
      url: '',
      enabled: true,
      autoSend: false,
      selectors: { input: 'textarea', inputCandidates: [] },
    };
    const updated = [...aiConfigs, newAi];
    setAiConfigs(updated);
    getPlatform().storage.setItem(AI_CONFIGS_KEY, updated);
  };

  const removeAi = (id: string) => {
    const updated = aiConfigs.filter((ai) => ai.id !== id);
    setAiConfigs(updated);
    getPlatform().storage.setItem(AI_CONFIGS_KEY, updated);
  };

  /** 箭头调整 AI 顺序（持久化；聊天卡片顺序跟随配置顺序） */
  const moveAi = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= aiConfigs.length) return;
    const updated = [...aiConfigs];
    [updated[index], updated[j]] = [updated[j], updated[index]];
    setAiConfigs(updated);
    getPlatform().storage.setItem(AI_CONFIGS_KEY, updated);
  };

  const toggleNotify = async (checked: boolean) => {
    setNotifyOnDone(checked);
    await getPlatform().storage.setItem('local:notifyOnDone', checked);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex h-12 items-center justify-between rounded-lg border bg-card px-3">
          <Label className="text-sm text-muted-foreground">回答完成提醒</Label>
          <Switch checked={notifyOnDone} onCheckedChange={toggleNotify} />
        </div>
        <div className="flex h-12 items-center justify-between rounded-lg border bg-card px-3">
          <Label className="text-sm text-muted-foreground">聊天卡片布局</Label>
          <div className="flex gap-1.5">
            {/* 田字格：2×2 网格示意 */}
            <button
              type="button"
              title="田字格（多列，奇数占满整行）"
              aria-label="田字格布局"
              onClick={() => changeChatLayout('grid')}
              className={cn(
                'rounded-md border p-1.5 transition-colors',
                chatLayout === 'grid'
                  ? 'border-primary bg-primary/5'
                  : 'border-input hover:bg-accent',
              )}
            >
              <span className="grid grid-cols-2 gap-0.5">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="h-3 w-3 rounded-[2px] bg-muted-foreground/40"
                  />
                ))}
              </span>
            </button>
            {/* 单列：纵向排列示意 */}
            <button
              type="button"
              title="单列（一个一行）"
              aria-label="单列布局"
              onClick={() => changeChatLayout('single')}
              className={cn(
                'rounded-md border p-1.5 transition-colors',
                chatLayout === 'single'
                  ? 'border-primary bg-primary/5'
                  : 'border-input hover:bg-accent',
              )}
            >
              <span className="flex flex-col gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-5 rounded-[1px] bg-muted-foreground/40"
                  />
                ))}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[64px] text-center">排序</TableHead>
              <TableHead className="w-[110px]">AI 名称</TableHead>
              <TableHead>地址</TableHead>
              <TableHead className="w-[56px] text-center">启用</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {aiConfigs.map((ai, index) => (
              <TableRow key={ai.id}>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => moveAi(index, -1)}
                      aria-label={`上移 ${ai.name}`}
                      className="h-6 w-6"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={index === aiConfigs.length - 1}
                      onClick={() => moveAi(index, 1)}
                      aria-label={`下移 ${ai.name}`}
                      className="h-6 w-6"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
                <TableCell>
                  <Input
                    className="h-7 px-2 text-sm"
                    value={ai.name}
                    disabled={ai.isDefault}
                    onChange={(e) =>
                      updateConfig(ai.id, { name: e.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    className="h-7 px-2 text-sm"
                    placeholder="https://example.com/?q={query}"
                    value={ai.url}
                    disabled={ai.isDefault}
                    onChange={(e) =>
                      updateConfig(ai.id, { url: e.target.value })
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={ai.enabled}
                    onCheckedChange={(v) =>
                      updateConfig(ai.id, { enabled: v === true })
                    }
                  />
                </TableCell>
                <TableCell>
                  {!ai.isDefault && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAi(ai.id)}
                      aria-label="删除"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Button size="sm" className="self-start" onClick={addAi}>
        <Plus className="h-4 w-4" />
        添加 AI
      </Button>
    </div>
  );
}
