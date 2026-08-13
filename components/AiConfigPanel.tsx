import { useEffect, useState } from 'react';
import { DEFAULT_AI_CONFIGS } from '@/utils/aiConfig';
import type { AiConfig } from '@/utils/aiConfig';
import ToggleSwitch from './ToggleSwitch';

const AI_CONFIGS_KEY = 'local:aiConfigs';

export default function AiConfigPanel({
  openMode,
  onModeChange,
}: {
  openMode: 'tabs' | 'windows';
  onModeChange: (mode: 'tabs' | 'windows') => void;
}) {
  const [aiConfigs, setAiConfigs] = useState<AiConfig[]>([]);

  useEffect(() => {
    storage.getItem(AI_CONFIGS_KEY).then((data) => {
      setAiConfigs((data as AiConfig[]) ?? DEFAULT_AI_CONFIGS);
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

  return (
    <div className="panel">
      <h2>AI 配置</h2>
      <div className="setting-row">
        <span>打开方式</span>
        <select
          value={openMode}
          onChange={(e) => onModeChange(e.target.value as 'tabs' | 'windows')}
        >
          <option value="tabs">标签页</option>
          <option value="windows">独立窗口</option>
        </select>
      </div>
      <div className="ai-list">
        {aiConfigs.map((ai) => (
          <div className="ai-card" key={ai.id}>
            <div className="ai-card-header">
              <input
                className="ai-name"
                value={ai.name}
                onChange={(e) => updateConfig(ai.id, { name: e.target.value })}
              />
              <ToggleSwitch
                checked={ai.enabled}
                onChange={(checked) => updateConfig(ai.id, { enabled: checked })}
              />
              <button className="delete-btn" onClick={() => removeAi(ai.id)}>
                ✕
              </button>
            </div>
            <input
              className="ai-url"
              placeholder="https://example.com/?q={query}"
              value={ai.url}
              onChange={(e) => updateConfig(ai.id, { url: e.target.value })}
            />
            <label className="auto-send-label">
              <input
                type="checkbox"
                checked={ai.autoSend}
                onChange={(e) =>
                  updateConfig(ai.id, { autoSend: e.target.checked })
                }
              />
              自动发送
            </label>
          </div>
        ))}
      </div>
      <button className="add-btn" onClick={addAi}>
        + 添加 AI
      </button>
    </div>
  );
}
