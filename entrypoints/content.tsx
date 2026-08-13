import React from 'react';
import ReactDOM from 'react-dom/client';
import FloatingPanel from '@/components/FloatingPanel';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    let container: HTMLDivElement | null = null;
    let root: ReactDOM.Root | null = null;
    let lastText = '';

    document.addEventListener('mouseup', (event) => {
      const target = event.target as Node;
      if (container && container.contains(target)) return;

      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (text && text.length > 0 && selection && selection.rangeCount > 0) {
        if (container && lastText !== text) {
          hidePanel();
        }
        lastText = text;
        // 以划词的包围矩形为锚点，让弹窗紧贴选中文字
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const anchorX =
          rect.left + rect.width / 2 || (event.clientX ?? 0);
        const anchorY = rect.bottom || (event.clientY ?? 0);
        showPanel(anchorX, anchorY, text);
      } else {
        hidePanel();
      }
    });

    function showPanel(x: number, y: number, text: string) {
      if (!container) {
        container = document.createElement('div');
        container.id = 'askall-floating-panel-host';
        container.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 0;
          height: 0;
          z-index: 2147483647;
        `;
        document.body.appendChild(container);
        root = ReactDOM.createRoot(container);
      }

      const panelWidth = 280;
      const panelHeight = 380;
      const gap = 16;
      const left = Math.max(8, Math.min(x, window.innerWidth - panelWidth - 8));
      // 优先在鼠标下方展开，空间不足时自动移到上方
      const spaceBelow = window.innerHeight - (y + gap) - 8;
      const top =
        spaceBelow >= panelHeight
          ? y + gap
          : Math.max(8, y - panelHeight - gap);

      root?.render(
        <FloatingPanel
          text={text}
          onClose={hidePanel}
          position={{ left, top }}
        />,
      );
    }

    function hidePanel() {
      if (container) {
        root?.unmount();
        container.remove();
        container = null;
        root = null;
      }
    }

    document.addEventListener('mousedown', (e) => {
      if (container && !container.contains(e.target as Node)) {
        hidePanel();
      }
    });
  },
});
