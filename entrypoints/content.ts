import type { ChatConfig, GeneralSettings } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/default-settings';

export default defineContentScript({
  matches: ['<all_urls>'],
  // Don't run inside frames — selection happens in the top frame.
  allFrames: false,
  runAt: 'document_idle',
  async main(ctx) {
    // Avoid running on the extension's own pages and on PDF/spa shells that
    // have no useful selection.
    if (location.protocol === 'chrome-extension:') return;

    let chats: ChatConfig[] = [];
    let settings: GeneralSettings = DEFAULT_SETTINGS;

    async function refreshConfig() {
      try {
        const data = await browser.storage.local.get([
          'askall:chats',
          'askall:settings',
        ]);
        chats = (data['askall:chats'] as ChatConfig[] | undefined) ?? [];
        settings = { ...DEFAULT_SETTINGS, ...((data['askall:settings'] as Partial<GeneralSettings>) || {}) };
      } catch {
        /* ignore */
      }
    }
    await refreshConfig();
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes['askall:chats'] || changes['askall:settings']) void refreshConfig();
    });

    // ---- Shadow DOM host -------------------------------------------------
    const host = document.createElement('div');
    host.id = 'askall-fab-host';
    host.style.cssText =
      'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${FAB_CSS}</style>
      <div id="bar" class="askall-bar" hidden>
        <button id="askAll" class="askall-askall" title="Ask all enabled chats">
          <span class="askall-spark">✦</span>
          <span>Ask All</span>
        </button>
        <div id="chats" class="askall-chats"></div>
      </div>
      <div id="toast" class="askall-toast" hidden></div>
    `;
    document.documentElement.appendChild(host);

    const bar = shadow.getElementById('bar')!;
    const askAllBtn = shadow.getElementById('askAll') as HTMLButtonElement;
    const chatsRow = shadow.getElementById('chats')!;
    const toast = shadow.getElementById('toast') as HTMLDivElement;

    function renderChats() {
      const enabled = chats.filter((c) => c.enabled);
      chatsRow.innerHTML = '';
      if (enabled.length === 0) {
        bar.classList.add('no-chats');
        return;
      }
      bar.classList.remove('no-chats');
      for (const c of enabled) {
        const btn = document.createElement('button');
        btn.className = 'askall-chat';
        btn.title = `Ask ${c.name}`;
        btn.innerHTML = `<span class="askall-avatar" style="background:${c.color}">${escapeHtml(c.icon)}</span><span class="askall-name">${escapeHtml(c.name)}</span>`;
        btn.addEventListener('click', () => {
          const text = currentSelection();
          if (text) {
            void send({ type: 'ASK_ONE', chatId: c.id, text, sourceUrl: location.href, sourceTitle: document.title });
            hide();
            showToast(`Sent to ${c.name}`);
          }
        });
        chatsRow.appendChild(btn);
      }
    }

    function hide() {
      bar.hidden = true;
    }

    function showToast(msg: string) {
      toast.textContent = msg;
      toast.hidden = false;
      setTimeout(() => {
        toast.hidden = true;
      }, 2200);
    }

    function show(rect: DOMRect) {
      renderChats();
      const top = Math.min(rect.bottom + 8, window.innerHeight - 60);
      const left = Math.min(Math.max(rect.left, 8), window.innerWidth - 320);
      host.style.transform = `translate(${left + window.scrollX}px, ${top + window.scrollY}px)`;
      bar.hidden = false;
    }

    function currentSelection(): string {
      return (window.getSelection()?.toString() || '').trim();
    }

    // ---- Selection handling ---------------------------------------------
    let selectionTimer: number | undefined;
    document.addEventListener('mouseup', () => {
      window.clearTimeout(selectionTimer);
      selectionTimer = window.setTimeout(() => {
        if (settings.selectionTrigger === 'hotkey') return;
        const text = currentSelection();
        if (text.length >= settings.minSelectionLength) {
          const range = window.getSelection()!.getRangeAt(0);
          show(range.getBoundingClientRect());
        } else {
          hide();
        }
      }, 120);
    });

    document.addEventListener('mousedown', (e) => {
      if (e.target instanceof Node && host.contains(e.target)) return;
      hide();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
    });

    askAllBtn.addEventListener('click', () => {
      const text = currentSelection();
      if (text) {
        void send({
          type: 'ASK_ALL',
          text,
          sourceUrl: location.href,
          sourceTitle: document.title,
        });
        hide();
        showToast(`Asked ${chats.filter((c) => c.enabled).length} chats`);
      }
    });

    // ---- Hotkey path: background asks for the current selection ----------
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'GET_SELECTION') {
        sendResponse({ text: currentSelection() });
        return false;
      }
      return false;
    });
  },
});

async function send(msg: unknown) {
  try {
    await browser.runtime.sendMessage(msg);
  } catch (e) {
    console.warn('[AskAll] message failed', e);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;',
  );
}

const FAB_CSS = `
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
:host, * { pointer-events: auto; }
.askall-bar {
  position: absolute;
  top: 0; left: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  background: rgba(17, 24, 39, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  box-shadow: 0 12px 30px -8px rgba(0,0,0,0.45), 0 4px 10px rgba(0,0,0,0.25);
  color: #f8fafc;
  font-size: 13px;
  user-select: none;
  animation: askall-pop 120ms ease-out;
}
.askall-bar[hidden] { display: none; }
.askall-bar.no-chats .askall-chats { display: none; }
.askall-askall {
  display: inline-flex; align-items: center; gap: 6px;
  background: linear-gradient(135deg, #10b981, #059669);
  color: #fff; border: none; border-radius: 9px;
  padding: 6px 10px; font-weight: 600; cursor: pointer;
  font-size: 13px; line-height: 1;
  transition: transform 120ms ease, filter 120ms ease;
}
.askall-askall:hover { transform: translateY(-1px); filter: brightness(1.05); }
.askall-askall:active { transform: translateY(0); }
.askall-spark { font-size: 14px; }
.askall-chats { display: flex; align-items: center; gap: 4px; }
.askall-chat {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  color: #e5e7eb; border-radius: 8px;
  padding: 4px 8px 4px 4px; cursor: pointer;
  font-size: 12px; line-height: 1;
  transition: background 120ms ease, transform 120ms ease;
}
.askall-chat:hover { background: rgba(255,255,255,0.14); transform: translateY(-1px); }
.askall-avatar {
  width: 18px; height: 18px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; line-height: 1; color: #fff;
  background-size: cover;
}
.askall-name { max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.askall-toast {
  position: absolute; top: 0; left: 0;
  transform: translate(20px, 56px);
  background: #10b981; color: #fff;
  padding: 7px 12px; border-radius: 9px;
  font-size: 12px; font-weight: 600;
  box-shadow: 0 8px 20px -6px rgba(16,185,129,0.6);
  animation: askall-pop 120ms ease-out;
}
.askall-toast[hidden] { display: none; }
@keyframes askall-pop {
  from { opacity: 0; transform: translate(0, 6px) scale(0.96); }
  to { opacity: 1; transform: translate(0, 0) scale(1); }
}
`;
