//! 注入到 AI 子 webview 的自动发送 + 回复捕获脚本。
//!
//! 与扩展端 `packages/shared/src/utils/autoSend.ts` 等价的「纯页面上下文」实现，
//! 但回传通道由 `chrome.runtime.sendMessage` 改为 Tauri IPC：
//!   `window.__TAURI_INTERNALS__.invoke('emit_ai_reply', { type, aiId, aiName, taskId, text })`
//! 由 lib.rs 的 `emit_ai_reply` 命令接收并转发为 'ai-reply' 事件给主窗口。
//!
//! 脚本以 IIFE 形式运行，不引用任何外部变量，所有参数通过占位符注入。

/// 由 Rust 在构建脚本时填充的占位符：
/// __TEXT__ / __AI_ID__ / __AI_NAME__ / __TASK_ID__
/// __INPUT_CANDS__ / __SEND_CANDS__ / __REPLY_CANDS__
/// 均为 JSON 字面量（serde_json::to_string 产出），可直接嵌入 JS。
const JS_TEMPLATE: &str = r#"
(function () {
  var TEXT = __TEXT__;
  var AI_ID = __AI_ID__;
  var AI_NAME = __AI_NAME__;
  var TASK_ID = __TASK_ID__;
  var INPUT_CANDS = __INPUT_CANDS__;
  var SEND_CANDS = __SEND_CANDS__;
  var REPLY_CANDS = __REPLY_CANDS__;

  function emit(type, text) {
    try {
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        window.__TAURI_INTERNALS__.invoke('emit_ai_reply', {
          type: type,
          aiId: AI_ID,
          aiName: AI_NAME,
          taskId: TASK_ID,
          text: text == null ? null : String(text)
        });
      }
    } catch (e) { /* 忽略 IPC 不可用 */ }
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function visible(el) {
    var s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function editable(el) {
    return el.isContentEditable === true || el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' &&
        ['button', 'submit', 'hidden', 'checkbox', 'radio', 'file'].indexOf(el.type) === -1);
  }
  function findInput() {
    var cands = (INPUT_CANDS && INPUT_CANDS.length) ? INPUT_CANDS : [];
    for (var i = 0; i < cands.length; i++) {
      var ns = document.querySelectorAll(cands[i]);
      for (var j = 0; j < ns.length; j++) {
        if (visible(ns[j]) && editable(ns[j])) return ns[j];
      }
    }
    var pool = [].concat(
      [].slice.call(document.querySelectorAll('textarea')),
      [].slice.call(document.querySelectorAll('input')),
      [].slice.call(document.querySelectorAll('[contenteditable="true"]')),
      [].slice.call(document.querySelectorAll('[role="textbox"]'))
    );
    var best = null, bs = -1;
    pool.forEach(function (el) {
      if (!editable(el)) return;
      var s = 0;
      if (el.isContentEditable) s += 40;
      if (el.getAttribute('role') === 'textbox') s += 30;
      if (el.tagName === 'TEXTAREA') s += 25;
      if (visible(el)) s += 20;
      if (s > bs) { best = el; bs = s; }
    });
    return best;
  }
  function fillInput(input, text) {
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      var proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set) d.set.call(input, text); else input.value = text;
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      input.focus();
      var r = document.createRange();
      r.selectNodeContents(input);
      var sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      if (!(input.textContent || '').indexOf(text) >= 0) {
        try { document.execCommand('insertText', false, text); } catch (e) {}
      }
    }
  }
  function disabled(btn) {
    return btn.disabled === true || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
  }
  function click(btn) {
    var r = btn.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, detail: 1, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    btn.dispatchEvent(new PointerEvent('pointerdown', o));
    btn.dispatchEvent(new MouseEvent('mousedown', o));
    btn.dispatchEvent(new PointerEvent('pointerup', o));
    btn.dispatchEvent(new MouseEvent('mouseup', o));
    btn.dispatchEvent(new MouseEvent('click', o));
  }
  function findSendBtn() {
    var cands = (SEND_CANDS && SEND_CANDS.length) ? SEND_CANDS : [];
    for (var i = 0; i < cands.length; i++) {
      var b = document.querySelector(cands[i]);
      if (b && !disabled(b)) return b;
    }
    return null;
  }
  function inputCleared(input) {
    if (!input || !input.isConnected) return true;
    var v = (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') ? input.value : (input.textContent || '');
    return v.trim().length === 0;
  }

  function run() {
    return new Promise(function (resolve) {
      var input = null;
      var start = Date.now();
      function probe() {
        input = findInput();
        if (input) return true;
        if (Date.now() - start > 20000) return false;
        return null;
      }
      function afterInput() {
        if (!input) { emit('AI_REPLY_DONE', '【AskAll】未能在页面中找到输入框，请在平台手动发送。'); resolve(); return; }
        emit('AI_SENDING', null);
        input.focus();
        wait(150).then(function () {
          fillInput(input, TEXT);
          wait(200).then(function () { trySend(0); });
        });
      }
      function trySend(attempt) {
        if (attempt > 25) {
          input.focus();
          var ke = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
          input.dispatchEvent(new KeyboardEvent('keydown', ke));
          input.dispatchEvent(new KeyboardEvent('keypress', ke));
          input.dispatchEvent(new KeyboardEvent('keyup', ke));
          waitClear(2500, function (ok) {
            if (ok) startWatch();
            else { emit('AI_REPLY_DONE', '【AskAll】未能自动发送，请在平台手动发送。'); resolve(); }
          });
          return;
        }
        var b = findSendBtn();
        if (b) {
          click(b);
          waitClear(2500, function (ok) {
            if (ok) startWatch();
            else trySend(attempt + 1);
          });
        } else {
          wait(120).then(function () { trySend(attempt + 1); });
        }
      }
      function waitClear(ms, cb) {
        var t = Date.now();
        (function loop() {
          wait(150).then(function () {
            if (inputCleared(input)) cb(true);
            else if (Date.now() - t < ms) loop();
            else cb(false);
          });
        })();
      }
      function startWatch() {
        var last = '';
        var stable = Date.now();
        var begun = Date.now();
        function extract() {
          var cs = (REPLY_CANDS && REPLY_CANDS.length) ? REPLY_CANDS : ['[class*="markdown"]', '[class*="answer"]', '[class*="response"]'];
          for (var i = 0; i < cs.length; i++) {
            var ns = document.querySelectorAll(cs[i]);
            if (ns.length) return (ns[ns.length - 1].textContent || '').trim();
          }
          return '';
        }
        function check() {
          if (Date.now() - begun > 120000) { clearInterval(timer); try { obs && obs.disconnect(); } catch (e) {} resolve(); return; }
          var tx = extract();
          if (tx.length) {
            if (tx !== last) { last = tx; stable = Date.now(); emit('AI_REPLY', tx.slice(0, 4000)); }
            else if (Date.now() - stable > 2500) { emit('AI_REPLY_DONE', tx.slice(0, 4000)); clearInterval(timer); try { obs && obs.disconnect(); } catch (e) {} resolve(); }
          } else { last = ''; stable = Date.now(); }
        }
        var obs = null;
        try { obs = new MutationObserver(check); obs.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (e) {}
        var timer = setInterval(check, 700);
      }
      // kick off
      (function waitInput() {
        var r = probe();
        if (r === true) afterInput();
        else if (r === false) afterInput();
        else setTimeout(waitInput, 150);
      })();
    });
  }
  try { run(); } catch (e) { emit('AI_REPLY_DONE', '【AskAll】注入异常: ' + (e && e.message ? e.message : String(e))); }
})();
"#;

/// 选择器集合（与前端 `AiSelectors` 一致，Rust 端镜像定义）。
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, Default)]
pub struct AiSelectors {
    pub input: String,
    pub input_candidates: Option<Vec<String>>,
    pub send_button: Option<String>,
    pub send_button_candidates: Option<Vec<String>>,
    pub reply_candidates: Option<Vec<String>>,
}

/// 把参数注入模板，产出可直接 `Webview::eval` 的 JS。
pub fn build_payload(
    text: &str,
    ai_id: &str,
    ai_name: &str,
    task_id: &str,
    selectors: &AiSelectors,
) -> String {
    let j = |v: &str| serde_json::to_string(v).unwrap_or_else(|_| "\"\"".to_string());
    let arr = |v: &[String]| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string());

    let input_cands = selectors
        .input_candidates
        .clone()
        .unwrap_or_else(|| if selectors.input.is_empty() { vec![] } else { vec![selectors.input.clone()] });
    let send_cands = selectors
        .send_button_candidates
        .clone()
        .or_else(|| selectors.send_button.clone().map(|s| vec![s]))
        .unwrap_or_default();
    let reply_cands = selectors.reply_candidates.clone().unwrap_or_default();

    JS_TEMPLATE
        .replace("__TEXT__", &j(text))
        .replace("__AI_ID__", &j(ai_id))
        .replace("__AI_NAME__", &j(ai_name))
        .replace("__TASK_ID__", &j(task_id))
        .replace("__INPUT_CANDS__", &arr(&input_cands))
        .replace("__SEND_CANDS__", &arr(&send_cands))
        .replace("__REPLY_CANDS__", &arr(&reply_cands))
}
