import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { DEFAULT_AI_CONFIGS } from '../utils/aiConfig';
import type { AiConfig } from '../utils/aiConfig';
import { getPlatform } from '../lib/platform';
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

export default function AiConfigPanel() {
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [notifyOnDone, setNotifyOnDone] = useState(true);

  useEffect(() => {
    getPlatform().storage.getItem(AI_CONFIGS_KEY).then((data) => {
      const stored = data as AiConfig[] | null;
      if (!stored) {
        setAiConfigs(DEFAULT_AI_CONFIGS);
        return;
      }
      // 合并默认配置：确保内置项始终存在且标记为 isDefault
      const defaultIds = DEFAULT_AI_CONFIGS.map((d) => d.id);
      const userConfigs = stored.filter((c) => !defaultIds.includes(c.id));
      const merged = [
        ...DEFAULT_AI_CONFIGS.map((d) => {
          const existing = stored.find((c) => c.id === d.id);
          return existing ? { ...d, enabled: existing.enabled } : d;
        }),
        ...userConfigs,
      ];
      setAiConfigs(merged);
    });
    getPlatform().storage.getItem('local:notifyOnDone').then((v) => {
      if (typeof v === 'boolean') setNotifyOnDone(v);
    });
  }, []);

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
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">AI 名称</TableHead>
              <TableHead>地址</TableHead>
              <TableHead className="w-[56px] text-center">启用</TableHead>
              <TableHead className="w-[40px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {aiConfigs.map((ai) => (
              <TableRow key={ai.id}>
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
