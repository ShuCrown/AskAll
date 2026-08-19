/**
 * AiIcon —— AI 厂商图标（workspace 版，tailwind 样式）。
 * 与 FloatingPanel 的图标映射一致：优先 public/ai 官方图标，失败回退首字母徽标。
 */
import { useState } from 'react';
import { getPlatform } from '../../lib/platform';

const AI_ICON_FILES: Record<string, string> = {
  deepseek: 'deepseek.svg',
  doubao: 'doubao.svg',
  wenxin: 'wenxin.svg',
  qwen: 'qianwen.svg',
};

/** 无官方图标时的品牌色兜底（按 id 稳定取色） */
const FALLBACK_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-600',
];

export default function AiIcon({
  aiId,
  name,
  size = 18,
}: {
  aiId?: string;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const file = aiId ? AI_ICON_FILES[aiId] : undefined;

  if (file && !failed) {
    return (
      <img
        src={getPlatform().assets.assetUrl(`ai/${file}`)}
        alt={name}
        title={name}
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: 'contain' }}
        className="shrink-0 rounded-[4px]"
        onError={() => setFailed(true)}
      />
    );
  }

  const color =
    FALLBACK_COLORS[
      Math.abs(
        (aiId ?? name).split('').reduce((a, c) => a + c.charCodeAt(0), 0),
      ) % FALLBACK_COLORS.length
    ];
  return (
    <span
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      className={`flex shrink-0 items-center justify-center rounded-[4px] text-white ${color}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}
