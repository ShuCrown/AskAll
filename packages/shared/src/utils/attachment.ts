/**
 * 附件处理助手：文件 → dataUrl、大小/数量校验。
 *
 * 附件本体以 AttachmentPayload（dataUrl）形式只在内存链路流转
 * （Composer → ASK_AI 消息 → background → 引擎注入参数），
 * 历史存储只落 AttachmentInfo 元数据，避免撑爆 local:history。
 */
import type { AttachmentPayload } from '../automation/types';

/** 单文件上限 5MB */
export const PER_FILE_MAX = 5 * 1024 * 1024;
/** 单次提问总大小上限 10MB（保护 runtime 消息与 executeScript 注入参数） */
export const TOTAL_MAX = 10 * 1024 * 1024;
/** 单次提问最多附件个数 */
export const MAX_FILES = 5;
/** 文件选择器 accept 属性 */
export const ACCEPT = 'image/*,application/pdf,.txt,.md,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv';

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/** File → AttachmentPayload（dataUrl）；读取失败抛错由调用方提示 */
export function readFileAsPayload(file: File): Promise<AttachmentPayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: String(reader.result ?? ''),
      });
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

/**
 * 校验一批待添加文件。返回错误信息；通过时返回 null。
 * `existing` 为已选附件，用于累计大小/数量校验。
 */
export function validateFiles(
  files: File[],
  existing: AttachmentPayload[],
): string | null {
  if (existing.length + files.length > MAX_FILES) {
    return `最多 ${MAX_FILES} 个附件`;
  }
  let total = existing.reduce((sum, a) => sum + a.size, 0);
  for (const f of files) {
    if (f.size > PER_FILE_MAX) {
      return `${f.name} 超过单文件上限 ${formatSize(PER_FILE_MAX)}`;
    }
    total += f.size;
  }
  if (total > TOTAL_MAX) {
    return `附件总大小超过 ${formatSize(TOTAL_MAX)}`;
  }
  return null;
}
