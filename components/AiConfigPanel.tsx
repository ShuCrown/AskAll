import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { DEFAULT_AI_CONFIGS } from '@/utils/aiConfig';
import type { AiConfig } from '@/utils/aiConfig';
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
  openMode: 'tabs' | 'windows';
  onModeChange: (mode: 'tabs' | 'windows') => void;
}) {
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);
  const [notifyOnDone, setNotifyOnDone] = useState(true);
  const [showResultAfterSend, setShowResultAfterSend] = useState(true);
  const [selectAllByDefault, setSelectAllByDefault] = useState(true);
  const [defaultPanel, setDefaultPanel] = useState<'select' | 'result'>('select');

  useEffect(() => {
    storage.getItem(AI_CONFIGS_KEY).then((data) => {
      setAiConfigs((data as AiConfig[]) ?? DEFAULT_AI_CONFIGS);
    });
    storage.getItem('local:notifyOnDone').then((v) => {
      if (typeof v === 'boolean') setNotifyOnDone(v);
    });
    storage.getItem('local:showResultAfterSend').then((v) => {
      if (typeof v === 'boolean') setShowResultAfterSend(v);
    });
    storage.getItem('local:selectAllByDefault').then((v) => {
      if (typeof v === 'boolean') setSelectAllByDefault(v);
    });
    storage.getItem('local:defaultFloatingPanel').then((v) => {
      if (v === 'select' || v === 'result') setDefaultPanel(v);
    });
  }, []);

  const updateConfig = async (id: string, updates: Partial<AiConfig>) => {
    const updated = aiConfigs.map((ai) =>
      ai.id === id ? { ...ai, ...updates } : ai,
    );
    setAiConfigs(updated);
    await storage.setItem(AI_CONFIGS_KEY, updated);
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
    storage.setItem(AI_CONFIGS_KEY, updated);
  };

  const removeAi = (id: string) => {
    const updated = aiConfigs.filter((ai) => ai.id !== id);
    setAiConfigs(updated);
    storage.setItem(AI_CONFIGS_KEY, updated);
  };

  const toggleNotify = async (checked: boolean) => {
    setNotifyOnDone(checked);
    await storage.setItem('local:notifyOnDone', checked);
  };

  const toggleShowResult = async (checked: boolean) => {
    setShowResultAfterSend(checked);
    await storage.setItem('local:showResultAfterSend', checked);
  };

  const toggleSelectAll = async (checked: boolean) => {
    setSelectAllByDefault(checked);
    await storage.setItem('local:selectAllByDefault', checked);
  };

  const changeDefaultPanel = async (panel: 'select' | 'result') => {
    setDefaultPanel(panel);
    await storage.setItem('local:defaultFloatingPanel', panel);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold tracking-tight">AI 配置</h2>

        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
          <Label className="text-sm text-muted-foreground">打开方式</Label>
          <Select
            value={openMode}
            onValueChange={(v) => onModeChange(v as 'tabs' | 'windows')}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tabs">标签页</SelectItem>
              <SelectItem value="windows">独立窗口</SelectItem>
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
          <Label className="text-sm text-muted-foreground">默认全选 AI</Label>
          <Switch checked={selectAllByDefault} onCheckedChange={toggleSelectAll} />
        </div>

        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
          <Label className="text-sm text-muted-foreground">默认浮动面板</Label>
          <Select
            value={defaultPanel}
            onValueChange={(v) => changeDefaultPanel(v as 'select' | 'result')}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="select">选择模型</SelectItem>
              <SelectItem value="result">结果面板</SelectItem>
            </SelectContent>
          </Select>
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
                    onChange={(e) =>
                      updateConfig(ai.id, { url: e.target.value })
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={ai.autoSend}
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
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAi(ai.id)}
                    aria-label="删除"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
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
