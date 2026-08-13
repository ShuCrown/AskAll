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

      const text = window.getSelection()?.toString().trim();
      if (text && text.length > 0) {
        if (container && lastText !== text) {
          hidePanel();
        }
        lastText = text;
        showPanel(event.clientX, event.clientY, text);
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
      const left = Math.max(8, Math.min(x, window.innerWidth - panelWidth - 8));
      const top = Math.max(
        8,
        Math.min(y + 16, window.innerHeight - panelHeight - 8),
      );

      root?.render(
        <div
          style={{
            position: 'absolute',
            left,
            top,
          }}
        >
          <FloatingPanel text={text} onClose={hidePanel} />
        </div>,
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
