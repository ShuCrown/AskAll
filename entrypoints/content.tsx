export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    let floatBtn: HTMLDivElement | null = null;

    document.addEventListener('mouseup', (event) => {
      const text = window.getSelection()?.toString().trim();
      if (text && text.length > 0) {
        showButton(event.clientX, event.clientY, text);
      } else {
        hideButton();
      }
    });

    function showButton(x: number, y: number, text: string) {
      if (!floatBtn) {
        floatBtn = document.createElement('div');
        floatBtn.className = 'multi-ai-float-btn';
        floatBtn.textContent = '🤖 多 AI 提问';
        floatBtn.style.cssText = `
          position: fixed;
          z-index: 2147483647;
          background: #2563eb;
          color: #fff;
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(0,0,0,.2);
          user-select: none;
        `;
        document.body.appendChild(floatBtn);
      }
      floatBtn.style.left = `${x}px`;
      floatBtn.style.top = `${y + 12}px`;
      floatBtn.dataset.text = text;

      floatBtn.onclick = () => {
        const t = floatBtn!.dataset.text!;
        navigator.clipboard?.writeText(t).catch(() => {});
        browser.runtime.sendMessage({ type: 'ASK_AI', text: t });
        hideButton();
      };
    }

    function hideButton() {
      if (floatBtn) {
        floatBtn.remove();
        floatBtn = null;
      }
    }

    document.addEventListener('mousedown', (e) => {
      if (floatBtn && !floatBtn.contains(e.target as Node)) {
        hideButton();
      }
    });
  },
});
