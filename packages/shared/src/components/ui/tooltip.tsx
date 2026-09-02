/**
 * Tooltip —— 轻量悬浮说明（浅色浮层）。
 *
 * 纯 CSS 实现：样式在组件内以 <style> 注入，触发用 CSS :hover（不依赖 React
 * 合成 mouseenter——浮层挂在 shadow root 且外层 pointer-events:none 时，
 * 合成事件在部分环境不触发，导致浮层不显示）。鼠标悬停触发元素时在下方弹出。
 */
import type { ReactNode } from 'react';

const tipStyle = `
.askall-tip{position:relative;display:inline-flex}
.askall-tip .askall-tip-bubble{
  position:absolute;left:50%;top:100%;z-index:50;margin-top:6px;
  transform:translateX(-50%);
  white-space:nowrap;
  padding:4px 8px;
  border-radius:6px;
  background:#ffffff;
  color:inherit;
  font-size:11px;
  line-height:1.4;
  box-shadow:0 4px 12px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);
  visibility:hidden;opacity:0;
  transition:opacity .15s ease;
  pointer-events:none;
}
.askall-tip:hover .askall-tip-bubble{visibility:visible;opacity:1}
`;

export default function Tooltip({
  content,
  children,
}: {
  content: string;
  children: ReactNode;
}) {
  return (
    <span className="askall-tip">
      <style>{tipStyle}</style>
      {children}
      <span className="askall-tip-bubble">{content}</span>
    </span>
  );
}
