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
 * 外部注入的问题（pendingQuestion，OS 级划词等）自动预填，由用户确认后发送。
 * 支持受控/非受控两种文本模式，便于空态页与时间线底部复用。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  Check,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Send,
  X,
} from 'lucide-react';
import { useAskStore } from '../../store/askStore';
import { cn } from '../../lib/utils';
import type { AttachmentPayload } from '../../automation/types';
import {
  ACCEPT,
  formatSize,
  readFileAsPayload,
  validateFiles,
} from '../../utils/attachment';
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
  onSubmit?: (text: string, attachments?: AttachmentPayload[]) => void;
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

  // AI 选择下拉：点击展开（Select 形态），Esc / 点击外部（失焦）关闭
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      // 面板在 shadow DOM 里，document 层监听的 e.target 会被事件重定向为
      // 宿主元素，contains 判断永远 false——点击下拉内部的行也会被当成
      // 「点击外部」而关闭，多选/取消选中被打断。用 composedPath 取含
      // shadow 内实际元素的完整路径判断：点击行内不关闭，点击外部才关闭。
      const path = e.composedPath();
      if (!path.includes(pickerRef.current as unknown as EventTarget)) {
        setPickerOpen(false);
      }
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

  // 外部问题注入：仅预填，由用户点击「发送」确认（不自动直发）
  useEffect(() => {
    if (!pendingQuestion) return;
    setText(pendingQuestion);
    setPendingQuestion(null);
  }, [pendingQuestion]);

  const submit = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || sending || selected.length === 0) return;
    setText('');
    const files = attachments;
    setAttachments([]);
    setAttachError(null);
    if (onSubmit) onSubmit(t, files);
    else if (activeConvId) void followUp(t, files);
    else void ask(t, files);
  };

  // ---------- 附件 ----------
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<AttachmentPayload[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const err = validateFiles(incoming, attachments);
    if (err) {
      setAttachError(err);
      return;
    }
    try {
      const payloads = await Promise.all(incoming.map(readFileAsPayload));
      setAttachments((prev) => [...prev, ...payloads]);
      setAttachError(null);
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : '读取附件失败');
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
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
      {/* 附件 chips：textarea 与操作条之间，仅在有附件时渲染 */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          {attachments.map((a, idx) => (
            <span
              key={`${a.name}-${idx}`}
              className="flex max-w-[220px] items-center gap-1 rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] text-foreground/80"
              title={`${a.name}（${formatSize(a.size)}）`}
            >
              {a.mime.startsWith('image/') ? (
                <ImageIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{a.name}</span>
              <span className="shrink-0 text-muted-foreground/70">
                {formatSize(a.size)}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(idx)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={`移除附件 ${a.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 附件校验错误：一次性提示，修改选择后自动消除 */}
      {attachError && (
        <p className="px-3 pt-2 text-[11px] text-red-600">{attachError}</p>
      )}

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

      {/* 底部操作条：附件 + AI 选择下拉 + 发送（与输入区同一外框、无分隔线） */}
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files);
            // 重置 value：同一文件移除后可重新选择
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          aria-label="添加附件"
          title={`添加附件（图片 / PDF / 文档，单文件 ≤5MB，共 ≤10MB）`}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-input bg-secondary/60 text-secondary-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Paperclip className="h-3.5 w-3.5" />
        </button>
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            title="选择发送给哪些 AI（可多选）"
            className={cn(
              'flex h-7 items-center gap-1 rounded-md border px-1.5 text-xs transition-colors',
              pickerOpen
                ? 'border-primary/50 bg-accent text-accent-foreground'
                : 'border-input bg-secondary/60 text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {selectedCount > 0 ? (
              <span className="flex min-w-0 items-center">
                <span className="flex items-center -space-x-1">
                  {selectedAis.map((a) => (
                    <span
                      key={a.id}
                      className="rounded-full bg-background ring-1 ring-border"
                    >
                      <AiIcon aiId={a.id} name={a.name} size={14} />
                    </span>
                  ))}
                </span>
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
