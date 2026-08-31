import React from 'react';
import ReactDOM from 'react-dom/client';
import { PageWorkspace } from '@askall/shared';
import { initExtensionPlatform } from '../src/platform';
// 工作台 tailwind 样式（编译后字符串），注入到 shadow root，避免污染宿主页面
import workspaceCss from '../src/workspace.css?inline';

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // 注入扩展平台实现（Workspace/PageWorkspace 内部通过 getPlatform() 访问能力）
    initExtensionPlatform();

    // 浮层宿主：页面上一个零尺寸固定元素，shadow root 内承载整个工作台面板
    let host: HTMLDivElement | null = null;
    let root: ReactDOM.Root | null = null;

    // 触发锚点：记录面板应贴近的页面位置（划词选区 / 右键菜单坐标）。
    // PageWorkspace 收到 position 后会把面板垂直锚定到该点附近（下方优先，放不下翻上方）。
    let anchorPos: { left: number; top: number } | undefined;
    // 右键菜单触发不携带坐标，这里记录最后一次右键位置作为锚点（面板内右键除外）
    document.addEventListener('contextmenu', (e) => {
      const target = e.target as Node;
      if (host && host.contains(target)) return;
      anchorPos = { left: e.clientX, top: e.clientY };
    });

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
          showPanel(
            window.getSelection()?.toString().trim() ?? '',
            selectionAnchor(),
          );
        }
      });
    });

    // 右键菜单/其他入口调用：显示面板（text 为空 = 空白新话题面板）
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'SHOW_PANEL') {
        showPanel(
          typeof msg.text === 'string' ? msg.text.trim() : '',
          // 有划词优先贴选区；否则退回到记录的最后一次右键位置
          selectionAnchor() ?? anchorPos,
        );
      }
    });

    // MAIN↔ISOLATED 桥接：autoSend 注入在 MAIN world 运行，页面无 chrome.runtime，
    // 它通过派发 askall:ai-reply 事件回传回复进度；本 content script（ISOLATED world）
    // 监听该事件并转发到后台，从而让结果面板能实时同步各 AI 的回答。
    // 置 ISOLATED world 全局标记：后台注入桥脚本（ensureReplyBridge）据此去重。
    (globalThis as Record<string, unknown>).__askallReplyBridge = true;
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
      if (host && host.contains(target)) return;
      // 划词自动弹出：仅在有选中文本时打开（预填问题），避免每次点击都弹空面板
      const text = window.getSelection()?.toString().trim();
      if (!text) return;
      showPanel(text, selectionAnchor() ?? anchorPos);
    }

    /** 取划词选区的锚点（选区水平中心 + 底部），无有效选区时返回 undefined */
    function selectionAnchor(): { left: number; top: number } | undefined {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return undefined;
      if (!sel.toString().trim()) return undefined;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return undefined;
      return { left: rect.left + rect.width / 2, top: rect.bottom };
    }

    function showPanel(text: string, anchor?: { left: number; top: number }) {
      if (!host) {
        host = document.createElement('div');
        // shadow root：注入工作台 tailwind 样式，与宿主页面双向隔离。
        // mount 铺满视口但 pointer-events:none，只让面板卡片（auto）可交互。
        host.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 0;
          height: 0;
          z-index: 2147483647;
        `;
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = workspaceCss;
        shadow.appendChild(style);
        const mount = document.createElement('div');
        mount.style.cssText = `
          position: fixed;
          inset: 0;
          pointer-events: none;
        `;
        shadow.appendChild(mount);
        document.body.appendChild(host);
        root = ReactDOM.createRoot(mount);
      }

      root?.render(
        <PageWorkspace initialText={text} onClose={hidePanel} position={anchor} />,
      );
    }

    function hidePanel() {
      if (host) {
        root?.unmount();
        host.remove();
        host = null;
        root = null;
      }
    }

    // 面板「固定 / 收起」状态（由 PageWorkspace 通过自定义事件同步）：
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
        host &&
        !host.contains(e.target as Node) &&
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
