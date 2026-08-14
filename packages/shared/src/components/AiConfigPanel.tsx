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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from './ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from './ui/table';

const AI_CONFIGS_KEY = 'local:aiConfigs';

export default function AiConfigPanel({
  openMode,
  onModeChange,
}: {
  openMode: 'embedded' | 'browser';
  onModeChange: (mode: 'embedded' | 'browser') => void;
}) {
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [notifyOnDone, setNotifyOnDone] = useState(true);
  const [showResultAfterSend, setShowResultAfterSend] = useState(true);
  const [selectAllByDefault, setSelectAllByDefault] = useState(true);
  const [autoSend, setAutoSend] = useState(false);
  const [showOnSelect, setShowOnSelect] = useState(false);
  const [shortcut, setShortcut] = useState('Alt+Q');

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
    getPlatform().storage.getItem('local:showResultAfterSend').then((v) => {
      if (typeof v === 'boolean') setShowResultAfterSend(v);
    });
    getPlatform().storage.getItem('local:selectAllByDefault').then((v) => {
      if (typeof v === 'boolean') setSelectAllByDefault(v);
    });
    getPlatform().storage.getItem('local:autoSend').then((v) => {
      if (typeof v === 'boolean') setAutoSend(v);
    });
    getPlatform().storage.getItem('local:showOnSelect').then((v) => {
      if (typeof v === 'boolean') setShowOnSelect(v);
    });
    getPlatform().storage.getItem('local:shortcut').then((v) => {
      if (typeof v === 'string' && v.trim()) setShortcut(v);
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

  const toggleShowResult = async (checked: boolean) => {
    setShowResultAfterSend(checked);
    await getPlatform().storage.setItem('local:showResultAfterSend', checked);
  };

  const toggleSelectAll = async (checked: boolean) => {
    setSelectAllByDefault(checked);
    await getPlatform().storage.setItem('local:selectAllByDefault', checked);
  };

  const toggleAutoSend = async (checked: boolean) => {
    setAutoSend(checked);
    await getPlatform().storage.setItem('local:autoSend', checked);
  };

  const toggleShowOnSelect = async (checked: boolean) => {
    setShowOnSelect(checked);
    await getPlatform().storage.setItem('local:showOnSelect', checked);
  };

  const saveShortcut = async (value: string) => {
    const v = value.trim();
    setShortcut(v);
    await getPlatform().storage.setItem('local:shortcut', v || 'Alt+Q');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold tracking-tight">AI 配置</h2>

        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
          <Label className="text-sm text-muted-foreground">打开方式</Label>
          <Select
            value={openMode}
            onValueChange={(v) => onModeChange(v as 'embedded' | 'browser')}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="embedded">应用内嵌窗口</SelectItem>
              <SelectItem value="browser">系统浏览器</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
          <Label className="text-sm text-muted-foreground">回答完成提醒</Label>
          <Switch checked={notifyOnDone} onCheckedChange={toggleNotify} />
        </div>

        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
          <Label className="text-sm text-muted-foreground">发送后显示结果面板</Label>
          <Switch checked={showResultAfterSend} onCheckedChange={toggleShowResult} />
        </div>

        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
          <Label className="text-sm text-muted-foreground">划词自动发送</Label>
          <Switch checked={autoSend} onCheckedChange={toggleAutoSend} />
        </div>

        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
          <Label className="text-sm text-muted-foreground">划词自动弹出面板</Label>
          <Switch checked={showOnSelect} onCheckedChange={toggleShowOnSelect} />
        </div>

        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
          <Label className="text-sm text-muted-foreground">快捷键</Label>
          <Input
            className="h-7 w-[130px] px-2 text-sm"
            placeholder="Alt+Q"
            value={shortcut}
            onChange={(e) => saveShortcut(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
          <Label className="text-sm text-muted-foreground">默认全选 AI</Label>
          <Switch checked={selectAllByDefault} onCheckedChange={toggleSelectAll} />
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">AI 名称</TableHead>
              <TableHead>地址</TableHead>
              <TableHead className="w-[76px] text-center">自动发送</TableHead>
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
                    checked={ai.autoSend}
                    disabled={ai.isDefault}
                    onCheckedChange={(v) =>
                      updateConfig(ai.id, { autoSend: v === true })
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={ai.enabled}
                    onCheckedChange={(checked) =>
                      updateConfig(ai.id, { enabled: checked })
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
