import React from 'react';
import ReactDOM from 'react-dom/client';
import { FloatingPanel } from '@askall/shared';
import { initExtensionPlatform } from '../src/platform';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // 注入扩展平台实现（FloatingPanel 内部通过 getPlatform() 访问能力）
    initExtensionPlatform();

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
          // 有划词时预填问题；无划词时打开空白新话题面板
          showPanel(window.getSelection()?.toString().trim() ?? '');
        }
      });
    });

    // 右键菜单/其他入口调用：显示面板（text 为空 = 空白新话题面板）
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'SHOW_PANEL') {
        showPanel(typeof msg.text === 'string' ? msg.text.trim() : '');
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
      // 划词自动弹出：仅在有选中文本时打开（预填问题），避免每次点击都弹空面板
      const text = window.getSelection()?.toString().trim();
      if (!text) return;
      showPanel(text);
    }

    function showPanel(text: string) {
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

      root?.render(
        <FloatingPanel initialText={text} onClose={hidePanel} />,
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
    // 面板默认钉在页面上（pinned 初始为 true），点击面板外部不自动关闭
    let panelState = { pinned: true, minimized: false };
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
