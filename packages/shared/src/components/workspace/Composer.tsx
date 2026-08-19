/**
 * Composer —— 统一输入组件（v1.1 新布局）。
 *
 * 极简形态：单个输入框 + 底部操作条。
 * 底部左侧是「AI 选择」按钮区（悬浮/点击弹出面板）：
 *   - 面板内每个厂商一行：左侧图标 + 名称，右侧勾选状态；
 *   - 点击行切换勾选，默认全勾选（enabled 项），选择持久化 local:lastSelectedAis。
 * 右侧为发送按钮；快捷键 ⌘/Ctrl+Enter 发送。
 * 外部注入的问题（pendingQuestion，OS 级划词等）自动预填并发送。
 * 支持受控/非受控两种文本模式，便于空态页与时间线底部复用。
 */
import { useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Loader2, Send } from 'lucide-react';
import { useAskStore } from '../../store/askStore';
import { cn } from '../../lib/utils';
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

  // AI 选择面板：悬浮/点击展开
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    },
    [],
  );
  const hoverEnter = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    openTimer.current = window.setTimeout(() => setPickerOpen(true), 150);
  };
  const hoverLeave = () => {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    closeTimer.current = window.setTimeout(() => setPickerOpen(false), 200);
  };

  // 点击面板外部关闭
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
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

  const selectedCount = configs.filter((c) => selected.includes(c.id)).length;

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

      {/* 底部操作条：AI 选择按钮区 + 发送（与输入区同一外框、无分隔线，输入内容不会与操作条重叠） */}
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5">
        <div
          className="relative"
          ref={pickerRef}
          onMouseEnter={hoverEnter}
          onMouseLeave={hoverLeave}
        >
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            title="选择发送给哪些 AI"
            className="flex items-center gap-1.5 rounded-md border bg-secondary/60 px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent"
          >
            <Bot className="h-3.5 w-3.5" />
            已选 {selectedCount} 个 AI
            <ChevronDown
              className={cn(
                'h-3 w-3 transition-transform',
                pickerOpen && 'rotate-180',
              )}
            />
          </button>

          {pickerOpen && (
            <div className="absolute bottom-full left-0 z-20 mb-1 flex min-w-[200px] flex-col gap-0.5 rounded-md border bg-popover p-1 shadow-md">
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

        <span className="ml-auto mr-1 text-[11px] text-muted-foreground">
          ⌘/Ctrl+Enter 发送
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
