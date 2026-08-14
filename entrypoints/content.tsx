import React from 'react';
import ReactDOM from 'react-dom/client';
import FloatingPanel from '@/components/FloatingPanel';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    let container: HTMLDivElement | null = null;
    let root: ReactDOM.Root | null = null;

    // 划词后是否自动弹出面板（默认关闭，可在设置中开启）
    storage.getItem('local:showOnSelect').then((v) => {
      if (v === true) {
        document.addEventListener('mouseup', onMouseUp);
      }
    });

    // 可配置快捷键（默认 Alt+Q，可在设置中修改）
    storage.getItem('local:shortcut').then((v) => {
      const shortcut = typeof v === 'string' && v.trim() ? v.trim() : 'Alt+Q';
      document.addEventListener('keydown', (e) => {
        // 输入框内不响应，避免干扰正常打字
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === 'INPUT' ||
            t.tagName === 'TEXTAREA' ||
            t.isContentEditable)
        ) {
          return;
        }
        if (matchesShortcut(e, shortcut)) {
          e.preventDefault();
          openPanelForSelection();
        }
      });
    });

    // 右键菜单/其他入口调用：显示面板
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'SHOW_PANEL') {
        openPanelForSelection(typeof msg.text === 'string' ? msg.text : undefined);
      }
    });

    // MAIN↔ISOLATED 桥接：autoSend 注入在 MAIN world 运行，页面无 chrome.runtime，
    // 它通过派发 askall:ai-reply 事件回传回复进度；本 content script（ISOLATED world）
    // 监听该事件并转发到后台，从而让结果面板能实时同步各 AI 的回答。
    window.addEventListener(
      'askall:ai-reply',
      ((e: CustomEvent<Record<string, unknown>>) => {
        const msg = e.detail;
        if (!msg || typeof msg.type !== 'string') return;
        browser.runtime.sendMessage(msg).catch(() => {});
      }) as EventListener,
    );

    function onMouseUp(event: MouseEvent) {
      const target = event.target as Node;
      if (container && container.contains(target)) return;
      openPanelForSelection();
    }

    /** 用当前选中文本（或显式传入的文本）打开面板，并紧贴选中文字定位 */
    function openPanelForSelection(explicitText?: string) {
      const selection = window.getSelection();
      const text = (explicitText ?? selection?.toString() ?? '').trim();
      if (!text) return;

      const rect =
        selection && selection.rangeCount > 0
          ? selection.getRangeAt(0).getBoundingClientRect()
          : null;
      // 以选中文字包围矩形的下边中点作为锚点
      const anchorX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const anchorY = rect ? rect.bottom : window.innerHeight / 2;
      showPanel(anchorX, anchorY, text);
    }

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
      const gap = 8;
      const left = Math.max(8, Math.min(x, window.innerWidth - panelWidth - 8));
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

    // 面板「固定 / 收起」状态（由 FloatingPanel 通过自定义事件同步）：
    // 固定或收起到右下角小浮窗时，点击面板外部不应自动关闭面板
    let panelState = { pinned: false, minimized: false };
    window.addEventListener(
      'askall-panel-state',
      ((
        e: CustomEvent<{ pinned: boolean; minimized: boolean }>,
      ) => {
        panelState = e.detail ?? panelState;
      }) as EventListener,
    );

    document.addEventListener('mousedown', (e) => {
      if (
        container &&
        !container.contains(e.target as Node) &&
        !panelState.pinned &&
        !panelState.minimized
      ) {
        hidePanel();
      }
    });
  },
});

/** 判断按键事件是否匹配配置的快捷键（如 "Alt+Q"、"Ctrl+Shift+K"） */
function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut
    .split('+')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const wantCtrl = mods.includes('ctrl');
  const wantAlt = mods.includes('alt');
  const wantShift = mods.includes('shift');
  const wantMeta = mods.includes('meta') || mods.includes('cmd');

  if (!!e.ctrlKey !== wantCtrl) return false;
  if (!!e.altKey !== wantAlt) return false;
  if (!!e.shiftKey !== wantShift) return false;
  if (!!e.metaKey !== wantMeta) return false;
  return e.key.toLowerCase() === key;
}
