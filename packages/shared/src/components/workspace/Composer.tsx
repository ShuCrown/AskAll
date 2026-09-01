/**
 * Composer —— 统一输入组件（v1.1 新布局）。
 *
 * 极简形态：单个输入框 + 底部操作条（两者同处一个外框内）。
 * 底部左侧是「AI 选择」下拉（Select 形态）：
 *   - trigger 展示已选 AI 图标（最多 3 个，超出显示 +N），未选时显示占位「选择 AI」；
 *   - 点击展开面板：每个厂商一行 = 左侧图标 + 名称，右侧勾选状态；
 *   - 点击行切换勾选、面板不关闭（多选）；Esc / 点击外部关闭；默认全勾选（enabled 项），
 *     选择持久化 local:lastSelectedAis。
 * 右侧为发送按钮；快捷键 ⌘/Ctrl+Enter 发送。
 * 外部注入的问题（pendingQuestion，OS 级划词等）自动预填并发送。
 * 支持受控/非受控两种文本模式，便于空态页与时间线底部复用。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Loader2, Send } from 'lucide-react';
import { useAskStore } from '../../store/askStore';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import AiIcon from './AiIcon';

export default function Composer({
  placeholder = '输入问题，同时发送给所选 AI…',
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

  // AI 选择下拉：点击展开（Select 形态），Esc / 点击外部关闭
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

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

  const submit = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || sending || selected.length === 0) return;
    setText('');
    if (onSubmit) onSubmit(t);
    else if (activeConvId) void followUp(t);
    else void ask(t);
  };

  const selectedAis = useMemo(
    () => configs.filter((c) => selected.includes(c.id)),
    [configs, selected],
  );
  const selectedCount = selectedAis.length;

  // 快捷键提示（发送按钮左侧）：macOS 用 ⌘，其余用 Ctrl；Enter 本身即换行
  const isMac = useMemo(
    () =>
      typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform),
    [],
  );
  const shortcutHint = isMac ? '⌘ ↵ 发送 · ↵ 换行' : 'Ctrl+↵ 发送 · ↵ 换行';

  return (
    <div className="flex flex-col rounded-lg border bg-card shadow-sm">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={3}
        autoFocus={autoFocus}
        className="w-full resize-none bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />

      {/* 底部操作条：AI 选择下拉 + 发送（与输入区同一外框、无分隔线） */}
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5">
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            title="选择发送给哪些 AI（可多选）"
            className={cn(
              'flex h-7 max-w-[200px] items-center gap-1 rounded-md border px-1.5 text-xs transition-colors',
              pickerOpen
                ? 'border-primary/50 bg-accent text-accent-foreground'
                : 'border-input bg-secondary/60 text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {selectedCount > 0 ? (
              <span className="flex min-w-0 items-center">
                <span className="flex items-center -space-x-1">
                  {selectedAis.slice(0, 3).map((a) => (
                    <span
                      key={a.id}
                      className="rounded-full bg-background ring-1 ring-border"
                    >
                      <AiIcon aiId={a.id} name={a.name} size={14} />
                    </span>
                  ))}
                </span>
                {selectedCount > 3 && (
                  <span className="ml-1 shrink-0 rounded bg-muted px-1 text-[10px] leading-4 text-muted-foreground">
                    +{selectedCount - 3}
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-1 px-0.5 text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                选择 AI
              </span>
            )}
            <ChevronDown
              className={cn(
                'h-3 w-3 shrink-0 transition-transform',
                pickerOpen && 'rotate-180',
              )}
            />
          </button>

          {pickerOpen && (
            <div className="absolute bottom-full left-0 z-20 mb-1 flex min-w-[200px] flex-col gap-0.5 rounded-md border bg-popover p-1 shadow-md">
              <p className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-muted-foreground">
                选择发送目标（可多选）
              </p>
              {configs.map((c) => {
                const on = selected.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleVendor(c.id)}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <AiIcon aiId={c.id} name={c.name} size={16} />
                    <span className="flex-1 truncate">{c.name}</span>
                    {on ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <span className="h-4 w-4 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 快捷键提示：紧贴发送按钮左侧，弱化展示 */}
        <span className="ml-auto select-none text-[11px] leading-none text-muted-foreground">
          {shortcutHint}
        </span>

        <Button
          size="sm"
          onClick={() => submit()}
          disabled={sending || !text.trim() || selectedCount === 0}
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
