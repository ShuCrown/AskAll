/**
 * Composer —— 统一输入组件（v1.1 新布局）。
 *
 * 「选 AI + 输入 + 发送」合并为单一组件：
 *   - 输入框下方是厂商标签行：已选厂商以标签展示（图标 + 名称 + ×移除），
 *     「＋」弹浮层添加其他厂商；选择持久化（local:lastSelectedAis）。
 *   - 外部注入的问题（pendingQuestion，OS 级划词等）自动预填并发送。
 * 支持受控/非受控两种文本模式，便于空态页与时间线底部复用。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, Plus, Send, X } from 'lucide-react';
import { getPlatform } from '../../lib/platform';
import { useAskStore } from '../../store/askStore';
import { Button } from '../ui/button';
import AiIcon from './AiIcon';

export default function Composer({
  placeholder = '输入问题，同时发送给所选 AI…（⌘/Ctrl+Enter 发送）',
  onSubmit,
  value,
  onValueChange,
  autoFocus,
}: {
  placeholder?: string;
  /** 提交回调；缺省时按是否有激活会话自动走 ask / followUp */
  onSubmit?: (text: string) => void;
  /** 受控文本（可选） */
  value?: string;
  onValueChange?: (v: string) => void;
  autoFocus?: boolean;
}) {
  const configs = useAskStore((s) => s.configs);
  const selected = useAskStore((s) => s.selected);
  const toggleVendor = useAskStore((s) => s.toggleVendor);
  const sending = useAskStore((s) => s.sending);
  const activeConvId = useAskStore((s) => s.activeConvId);
  const ask = useAskStore((s) => s.ask);
  const followUp = useAskStore((s) => s.followUp);
  const pendingQuestion = useAskStore((s) => s.pendingQuestion);
  const setPendingQuestion = useAskStore((s) => s.setPendingQuestion);

  const [inner, setInner] = useState('');
  const controlled = value !== undefined;
  const text = controlled ? value : inner;
  const setText = (v: string) => {
    if (controlled) onValueChange?.(v);
    else setInner(v);
  };

  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // 外部问题注入：预填并自动发送（与旧 AskPanel 的 externalQuestion 行为一致）
  const injectedRef = useRef(false);
  useEffect(() => {
    if (!pendingQuestion || injectedRef.current) return;
    injectedRef.current = true;
    const q = pendingQuestion;
    setText(q);
    setPendingQuestion(null);
    requestAnimationFrame(() => {
      submit(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion]);

  // 点击浮层外部关闭
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  const submit = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || sending || selected.length === 0) return;
    setText('');
    if (onSubmit) onSubmit(t);
    else if (activeConvId) void followUp(t);
    else void ask(t);
  };

  const selectedConfigs = configs.filter((c) => selected.includes(c.id));
  const unselectedConfigs = configs.filter((c) => !selected.includes(c.id));

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-2.5 shadow-sm">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={3}
        autoFocus={autoFocus}
        className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />

      {/* 厂商标签行 + 发送 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {selectedConfigs.map((c) => (
          <span
            key={c.id}
            className="flex items-center gap-1 rounded-full border bg-secondary py-0.5 pl-1.5 pr-1 text-xs text-secondary-foreground"
          >
            <AiIcon aiId={c.id} name={c.name} size={14} />
            {c.name}
            <button
              type="button"
              title={`移除 ${c.name}`}
              onClick={() => toggleVendor(c.id)}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {/* 添加厂商 */}
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={unselectedConfigs.length === 0}
            title="添加 AI 厂商"
            className="flex items-center gap-0.5 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
            添加
            <ChevronDown className="h-3 w-3" />
          </button>
          {pickerOpen && (
            <div className="absolute bottom-full left-0 z-20 mb-1 flex min-w-[160px] flex-col gap-0.5 rounded-md border bg-popover p-1 shadow-md">
              {unselectedConfigs.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    toggleVendor(c.id);
                    setPickerOpen(false);
                  }}
                  className="flex items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
                >
                  <AiIcon aiId={c.id} name={c.name} size={16} />
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="ml-auto mr-1 text-[11px] text-muted-foreground">
          已选 {selectedConfigs.length} 个
        </span>
        <Button
          size="sm"
          onClick={() => submit()}
          disabled={sending || !text.trim() || selectedConfigs.length === 0}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          发送
        </Button>
      </div>
    </div>
  );
}
