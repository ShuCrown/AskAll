"use strict";
var AskAllEngine = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../../packages/shared/src/automation/engine.ts
  var engine_exports = {};
  __export(engine_exports, {
    runAutomation: () => runAutomation
  });
  async function runAutomation(text, recipe, meta, attachments = []) {
    const files = Array.isArray(attachments) ? attachments : [];
    const fastClock = (() => {
      const queue = [];
      let armed = false;
      const drain = () => {
        const batch = queue.splice(0);
        armed = false;
        for (const fn of batch) {
          if (fn) {
            try {
              fn();
            } catch {
            }
          }
        }
      };
      try {
        const chan = new MessageChannel();
        chan.port1.onmessage = drain;
        return {
          post(fn) {
            queue.push(fn);
            if (!armed) {
              armed = true;
              chan.port2.postMessage(0);
            }
          }
        };
      } catch {
        return {
          post(fn) {
            setTimeout(fn, 0);
          }
        };
      }
    })();
    const sleep = (ms) => new Promise((r) => {
      const start = Date.now();
      const step = () => {
        if (Date.now() - start >= ms) r();
        else fastClock.post(step);
      };
      fastClock.post(step);
    });
    const timeout = (fn, ms) => {
      let cleared = false;
      const start = Date.now();
      const step = () => {
        if (cleared) return;
        if (Date.now() - start >= ms) fn();
        else fastClock.post(step);
      };
      fastClock.post(step);
      return () => {
        cleared = true;
      };
    };
    const interval = (fn, ms) => {
      let stopped = false;
      const loop = () => {
        if (stopped) return;
        const start = Date.now();
        try {
          fn();
        } catch {
        }
        const step = () => {
          if (stopped) return;
          if (Date.now() - start >= ms) loop();
          else fastClock.post(step);
        };
        fastClock.post(step);
      };
      fastClock.post(loop);
      return () => {
        stopped = true;
      };
    };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden";
    };
    const editable = (el) => el.isContentEditable === true || el.tagName === "TEXTAREA" || el.tagName === "INPUT" && !["button", "submit", "hidden", "checkbox", "radio", "file"].includes(
      el.type
    );
    const boxy = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const textOf = (el) => (el.textContent || "").trim();
    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible"
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false
      });
      document.dispatchEvent(new Event("visibilitychange"));
    } catch {
    }
    try {
      const rafQueue = /* @__PURE__ */ new Map();
      let rafId = 0;
      let stopRaf = null;
      const pumpRaf = () => {
        const now = performance.now();
        const entries = Array.from(rafQueue.entries());
        rafQueue.clear();
        for (const [, cb] of entries) {
          try {
            cb(now);
          } catch {
          }
        }
      };
      const w = window;
      w.requestAnimationFrame = (cb) => {
        rafQueue.set(++rafId, cb);
        if (!stopRaf) stopRaf = interval(pumpRaf, 16);
        return rafId;
      };
      w.cancelAnimationFrame = (id) => {
        rafQueue.delete(id);
        if (rafQueue.size === 0 && stopRaf) {
          stopRaf();
          stopRaf = null;
        }
      };
    } catch {
    }
    const send = (msg) => {
      try {
        window.dispatchEvent(
          new CustomEvent("askall:ai-reply", {
            detail: { ...msg, aiName: meta.aiName, aiId: meta.aiId, taskId: meta.taskId }
          })
        );
      } catch {
      }
    };
    const report = (stepId, kind, ok, reason, snapshot) => {
      send({
        type: "ASKALL_STEP_RESULT",
        // 记忆键带版本（与 memory.ts 的 memoryKey 一致）：Recipe 升版后
        // 旧统计自动作废，避免曾经的假成功主导新策略链的排序
        recipeId: `${recipe.id}@v${recipe.version}`,
        stepId,
        kind,
        ok,
        reason,
        snapshot
      });
    };
    const ctx = {
      input: null,
      disabledBaseline: null,
      blockBaseline: null,
      // 占位值：locate 成功后会以 contentTextLen()（排除侧栏）重采
      pageTextBaseline: 0,
      initialHref: location.href
    };
    const question = text;
    const currentValue = () => {
      const el = ctx.input;
      if (!el) return "";
      return el.tagName === "TEXTAREA" || el.tagName === "INPUT" ? el.value : el.textContent || "";
    };
    const norm = (s) => s.replace(/\s+/g, "");
    const filled = () => {
      const probe = norm(question.trim()).slice(0, 40);
      if (!probe) return norm(currentValue()).length > 0;
      return norm(currentValue()).includes(probe);
    };
    const collectEditable = () => {
      const seen = /* @__PURE__ */ new Set();
      const sels = [
        "textarea",
        "input",
        '[contenteditable="true"]',
        '[contenteditable="plaintext-only"]',
        '[role="textbox"]'
      ];
      for (const s of sels) {
        let nodes;
        try {
          nodes = document.querySelectorAll(s);
        } catch {
          continue;
        }
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (n) seen.add(n);
        }
      }
      const out = [];
      seen.forEach((el) => {
        if (editable(el) && visible(el)) out.push(el);
      });
      return out;
    };
    const inHeaderArea = (el) => {
      let p = el;
      for (let i = 0; i < 6 && p; i++) {
        const tag = p.tagName.toLowerCase();
        const role = (p.getAttribute("role") || "").toLowerCase();
        if (tag === "header" || tag === "nav") return true;
        if (role === "banner" || role === "search" || role === "navigation") return true;
        p = p.parentElement;
      }
      return false;
    };
    const inSideArea = (el) => {
      let p = el;
      for (let i = 0; i < 8 && p; i++) {
        const tag = p.tagName.toLowerCase();
        if (tag === "aside" || tag === "nav" || tag === "header") return true;
        const role = (p.getAttribute("role") || "").toLowerCase();
        if (role === "navigation" || role === "banner" || role === "complementary") {
          return true;
        }
        p = p.parentElement;
      }
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right <= window.innerWidth * 0.33) return true;
      return false;
    };
    const qsSafe = (sel) => {
      try {
        return document.querySelector(sel);
      } catch {
        return null;
      }
    };
    const qsaSafe = (sel) => {
      try {
        return Array.from(document.querySelectorAll(sel));
      } catch {
        return [];
      }
    };
    const collectButtons = () => Array.from(
      document.querySelectorAll('button, [role="button"]')
    );
    const btnDisabled = (el) => {
      if (el.disabled === true || el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true" || el.getAttribute("data-disabled") === "true" || el.getAttribute("data-loading") === "true" || el.classList.contains("disabled") || el.classList.contains("is-disabled")) {
        return true;
      }
      try {
        if (getComputedStyle(el).pointerEvents === "none") return true;
      } catch {
      }
      return false;
    };
    const snapshotDisabled = () => {
      const m = /* @__PURE__ */ new Map();
      for (const b of collectButtons()) m.set(b, btnDisabled(b));
      return m;
    };
    const depthOf = (el) => {
      let d = 0;
      let p = el;
      while (p && p !== document.body) {
        d++;
        p = p.parentElement;
      }
      return d;
    };
    const locateEditableBottom = async () => {
      const els = collectEditable().filter((el) => !inHeaderArea(el));
      if (els.length === 0) return false;
      if (els.length === 1) {
        const only = els[0];
        if (!only) return false;
        ctx.input = only;
        return true;
      }
      let best = null;
      let bestScore = -Infinity;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        let s = r.bottom * 0.5;
        if (r.width >= 200) s += 40;
        if (r.height >= 40) s += 20;
        if (r.bottom > window.innerHeight * 0.5) s += 30;
        if (r.top < window.innerHeight * 0.15) s -= 50;
        const ph = (el.getAttribute("placeholder") || "").toLowerCase();
        if (/提问|输入|发送|消息|问问|ask|message|type|send/.test(ph)) s += 30;
        if (/搜索|search/.test(ph)) s -= 80;
        if (textOf(el).length === 0) s += 25;
        if (document.activeElement === el) s += 20;
        if (s > bestScore) {
          bestScore = s;
          best = el;
        }
      }
      if (!best) return false;
      ctx.input = best;
      return true;
    };
    const locateSelector = async (p) => {
      const sels = p.inputSelectors || [];
      for (const sel of sels) {
        for (const el of qsaSafe(sel)) {
          if (visible(el) && editable(el)) {
            ctx.input = el;
            return true;
          }
        }
      }
      return false;
    };
    const locateFocused = async () => {
      const el = document.activeElement;
      if (el && editable(el) && visible(el)) {
        ctx.input = el;
        return true;
      }
      return false;
    };
    const fillPaste = async () => {
      const el = ctx.input;
      if (!el) return false;
      el.focus();
      await sleep(80);
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", question);
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: dt
          })
        );
      } catch {
        return false;
      }
      await sleep(250);
      return filled();
    };
    const fillInsertText = async () => {
      const el = ctx.input;
      if (!el) return false;
      el.focus();
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
      }
      el.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: question
        })
      );
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: question
        })
      );
      await sleep(150);
      if (filled()) return true;
      try {
        document.execCommand("insertText", false, question);
      } catch {
      }
      await sleep(150);
      return filled();
    };
    const fillValueSetter = async () => {
      const el = ctx.input;
      if (!el) return false;
      if (el.tagName !== "TEXTAREA" && el.tagName !== "INPUT") return false;
      el.focus();
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, question);
      else el.value = question;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: question
        })
      );
      el.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(150);
      return filled();
    };
    const fillDom = async () => {
      const el = ctx.input;
      if (!el) return false;
      el.focus();
      el.textContent = question;
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
      }
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: question
        })
      );
      await sleep(200);
      return filled();
    };
    const fillAuto = async () => {
      const el = ctx.input;
      if (!el) return false;
      if (el.isContentEditable || el.getAttribute("role") === "textbox") {
        return await fillPaste() || await fillInsertText() || await fillDom();
      }
      return await fillValueSetter() || await fillInsertText() || await fillPaste();
    };
    const ATTACH_INDICATOR_SEL = [
      "img",
      '[class*="preview" i]',
      '[class*="file" i]',
      '[class*="attach" i]',
      '[class*="upload" i]',
      '[class*="thumb" i]',
      '[class*="chip" i]'
    ].join(",");
    const fileCache = /* @__PURE__ */ new Map();
    const fileFromPayload = (a) => {
      const key = `${a.name}::${a.size}`;
      const hit = fileCache.get(key);
      if (hit) return hit;
      try {
        const comma = a.dataUrl.indexOf(",");
        const b64 = comma >= 0 ? a.dataUrl.slice(comma + 1) : a.dataUrl;
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const f = new File([bytes], a.name, { type: a.mime });
        fileCache.set(key, f);
        return f;
      } catch {
        return null;
      }
    };
    const filesFor = (list) => {
      const out = [];
      for (const a of list) {
        const f = fileFromPayload(a);
        if (f) out.push(f);
      }
      return out;
    };
    const buildDt = (list) => {
      try {
        const fs = filesFor(list);
        if (!fs.length) return null;
        const dt = new DataTransfer();
        for (const f of fs) dt.items.add(f);
        return dt;
      } catch {
        return null;
      }
    };
    const attachZone = () => {
      let node = ctx.input ? ctx.input.parentElement : document.body;
      for (let i = 0; i < 4 && node && node !== document.body; i++) {
        const r = node.getBoundingClientRect();
        if (r.height >= 160 && r.width >= 240) break;
        node = node.parentElement;
      }
      return node ?? document.body;
    };
    const composerRoot = () => {
      const input = ctx.input;
      if (!input || !input.isConnected) return null;
      const ir = input.getBoundingClientRect();
      let node = input.parentElement;
      let fallback = null;
      for (let i = 0; i < 8 && node && node !== document.body; i++) {
        const r = node.getBoundingClientRect();
        if (r.top < ir.top - 350) break;
        fallback = node;
        if (r.height >= 120 && r.width >= 200) return node;
        node = node.parentElement;
      }
      return fallback;
    };
    const foundFileNames = (zone) => {
      const found = /* @__PURE__ */ new Set();
      if (!files.length) return found;
      const input = ctx.input;
      let nodes;
      try {
        nodes = zone.querySelectorAll("div, span, p, li, a, figure");
      } catch {
        return found;
      }
      const cap = Math.min(nodes.length, 800);
      for (let i = 0; i < cap; i++) {
        const n = nodes[i];
        if (!n || !n.isConnected || !visible(n)) continue;
        if (input && (n === input || input.contains(n) || n.contains(input))) {
          continue;
        }
        if (n.children.length > 4) continue;
        const raw = (n.textContent || "").trim().toLowerCase();
        if (!raw || raw.length > 300) continue;
        for (const f of files) {
          const nm = (f.name || "").toLowerCase();
          if (!nm || found.has(nm)) continue;
          if (raw.includes(nm) || nm.length >= 12 && raw.includes(nm.slice(0, 10))) {
            found.add(nm);
          }
        }
      }
      return found;
    };
    const collectAttachSignals = () => {
      const zone = composerRoot() ?? attachZone();
      const ir = ctx.input ? ctx.input.getBoundingClientRect() : null;
      const els = [];
      try {
        zone.querySelectorAll(ATTACH_INDICATOR_SEL).forEach((n) => {
          if (!n.isConnected || !visible(n)) return;
          if (n.tagName === "IMG") {
            const src = n.getAttribute("src") || "";
            if (!/^(blob:|data:)/i.test(src)) return;
          } else {
            if (n.closest('button, [role="button"]') === n && !n.querySelector("img")) {
              return;
            }
            if (ir) {
              const r = n.getBoundingClientRect();
              if (r.top > ir.top + 60 || r.bottom < ir.top - 320) return;
            }
          }
          els.push(n);
        });
      } catch {
      }
      return { els, names: foundFileNames(zone) };
    };
    const takeAttachBaseline = () => {
      const s = collectAttachSignals();
      return { els: new Set(s.els), names: s.names };
    };
    const pendingPayloads = () => {
      if (!files.length) return [];
      const found = collectAttachSignals().names;
      if (found.size === 0) return files;
      const pend = files.filter(
        (f) => !f.name || !found.has(f.name.toLowerCase())
      );
      return pend;
    };
    const waitForAttachFeedback = (before, waitMs) => new Promise((resolve) => {
      const deadline = Date.now() + waitMs;
      const timer = interval(() => {
        if (Date.now() > deadline) {
          timer();
          resolve(false);
          return;
        }
        const cur = collectAttachSignals();
        const grew = Array.from(cur.names).some((n) => !before.names.has(n)) || cur.els.some((el) => !before.els.has(el));
        if (grew) {
          timer();
          resolve(true);
        }
      }, 300);
    });
    const waitForUploadSettle = async (maxMs) => {
      const busy = () => {
        const zone = attachZone();
        let hit = false;
        try {
          zone.querySelectorAll(
            '[class*="uploading" i], [class*="loading" i], [class*="progress" i], [class*="pending" i]'
          ).forEach((n) => {
            if (hit || !visible(n)) return;
            const cls = typeof n.className === "string" ? n.className : "";
            if (/uploading|loading|pending/i.test(cls)) {
              hit = true;
              return;
            }
            if (/\d{1,3}\s*%/.test(textOf(n))) hit = true;
          });
        } catch {
        }
        return hit;
      };
      const start = Date.now();
      let stable = 0;
      while (Date.now() - start < maxMs) {
        await sleep(500);
        if (busy()) stable = 0;
        else if (++stable >= 2) return;
      }
    };
    const attachPaste = async (p) => {
      const el = ctx.input;
      if (!el) return false;
      const pending = pendingPayloads();
      if (!pending.length) return true;
      const dt = buildDt(pending);
      if (!dt) return false;
      const before = takeAttachBaseline();
      el.focus();
      await sleep(60);
      try {
        el.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: dt
          })
        );
      } catch {
        return false;
      }
      return waitForAttachFeedback(before, Math.min(p.attachWaitMs ?? 4e3, 4e3));
    };
    const attachTriggerFileInput = async () => {
      if (!ctx.input) return false;
      const pending = pendingPayloads();
      if (!pending.length) return true;
      const fs = filesFor(pending);
      if (!fs.length) return false;
      const ir = ctx.input.getBoundingClientRect();
      const kw = /上传|附件|附上|文件|图片|attach|upload|clip|paperclip/i;
      const bad = /发送|send|停止|stop|语音|voice|mic|搜索|search|提问|清空/i;
      const seen = /* @__PURE__ */ new Set();
      const cands = [];
      const consider = (el) => {
        if (seen.has(el) || !boxy(el)) return;
        seen.add(el);
        const label = (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || "") + " " + (el.id || "") + " " + (typeof el.className === "string" ? el.className : "") + " " + textOf(el);
        if (!kw.test(label) || bad.test(label)) return;
        const r = el.getBoundingClientRect();
        if (r.top > ir.bottom + 40 || r.bottom < ir.top - 220) return;
        const dx = r.left + r.width / 2 - (ir.left + ir.width / 2);
        const dy = r.top + r.height / 2 - (ir.top + ir.height / 2);
        cands.push({ el, dist: dx * dx + dy * dy });
      };
      collectButtons().forEach(consider);
      qsaSafe(
        '[class*="upload" i], [class*="attach" i], [class*="clip" i]'
      ).forEach(consider);
      if (!cands.length) return false;
      cands.sort((a, b) => a.dist - b.dist);
      const pressEscape = () => {
        try {
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              code: "Escape",
              bubbles: true,
              cancelable: true
            })
          );
        } catch {
        }
      };
      for (const { el: btn } of cands.slice(0, 3)) {
        const knownInputs = /* @__PURE__ */ new Set();
        document.querySelectorAll('input[type="file"]').forEach((i) => knownInputs.add(i));
        const knownBtns = /* @__PURE__ */ new Set();
        collectButtons().forEach((b) => knownBtns.add(b));
        clickBtn(btn);
        const deadline = Date.now() + 3500;
        let target = null;
        const clickedMenu = /* @__PURE__ */ new Set();
        while (Date.now() < deadline && !target) {
          await sleep(200);
          for (const inp of Array.from(
            document.querySelectorAll('input[type="file"]')
          )) {
            if (!knownInputs.has(inp)) {
              target = inp;
              break;
            }
          }
          if (target) break;
          for (const b of collectButtons()) {
            if (knownBtns.has(b) || clickedMenu.has(b) || b === btn) continue;
            const label = (b.getAttribute("aria-label") || "") + " " + textOf(b);
            if (!kw.test(label) || bad.test(label)) continue;
            clickedMenu.add(b);
            clickBtn(b);
            break;
          }
        }
        if (target) {
          try {
            const before = takeAttachBaseline();
            const dt = new DataTransfer();
            for (const f of fs) dt.items.add(f);
            target.files = dt.files;
            target.dispatchEvent(new Event("input", { bubbles: true }));
            target.dispatchEvent(new Event("change", { bubbles: true }));
            if (await waitForAttachFeedback(before, 5e3)) return true;
          } catch {
          }
        } else {
          pressEscape();
          await sleep(250);
        }
      }
      return false;
    };
    const attachFileInput = async (p) => {
      const pending = pendingPayloads();
      if (!pending.length) return true;
      const fs = filesFor(pending);
      if (!fs.length) return false;
      const candidates = [];
      const push = (el) => {
        const input = el;
        if (input.type === "file" && !candidates.includes(input)) {
          candidates.push(input);
        }
      };
      for (const sel of p.attachSelectors || []) {
        for (const el of qsaSafe(sel)) push(el);
      }
      document.querySelectorAll('input[type="file"]').forEach(push);
      if (!candidates.length) return false;
      for (const input of candidates) {
        try {
          const before = takeAttachBaseline();
          const dt = new DataTransfer();
          for (const f of fs) dt.items.add(f);
          input.files = dt.files;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          if (await waitForAttachFeedback(before, 5e3)) {
            return true;
          }
        } catch {
        }
      }
      return false;
    };
    const attachDrop = async (p) => {
      const el = ctx.input ?? document.body;
      const pending = pendingPayloads();
      if (!pending.length) return true;
      const dt = buildDt(pending);
      if (!dt) return false;
      const before = takeAttachBaseline();
      try {
        const init = {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt
        };
        el.dispatchEvent(new DragEvent("dragenter", init));
        await sleep(150);
        el.dispatchEvent(new DragEvent("dragover", init));
        await sleep(150);
        el.dispatchEvent(new DragEvent("dragover", init));
        await sleep(150);
        el.dispatchEvent(new DragEvent("drop", init));
        el.dispatchEvent(new DragEvent("dragleave", init));
        document.dispatchEvent(new DragEvent("dragend", init));
      } catch {
        return false;
      }
      return waitForAttachFeedback(
        before,
        Math.min(p.attachWaitMs ?? 5e3, 6e3)
      );
    };
    const clickBtn = (btn) => {
      const r = btn.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        detail: 1,
        clientX: r.x + r.width / 2,
        clientY: r.y + r.height / 2
      };
      btn.dispatchEvent(new PointerEvent("pointerdown", opts));
      btn.dispatchEvent(new MouseEvent("mousedown", opts));
      btn.dispatchEvent(new PointerEvent("pointerup", opts));
      btn.dispatchEvent(new MouseEvent("mouseup", opts));
      btn.dispatchEvent(new MouseEvent("click", opts));
    };
    const inputCleared = () => {
      const el = ctx.input;
      if (!el || !el.isConnected) return false;
      return currentValue().trim().length === 0;
    };
    const pageTextGrew = () => contentTextLen() > ctx.pageTextBaseline + 20;
    const sentNow = () => inputCleared() || location.href !== ctx.initialHref || pageTextGrew();
    const settle = async (maxMs) => {
      const start = Date.now();
      let last = -1;
      let stable = 0;
      while (Date.now() - start < maxMs) {
        await sleep(400);
        const len = (document.body.innerText || "").length;
        if (len === last) {
          stable += 1;
          if (stable >= 2) return;
        } else {
          stable = 0;
          last = len;
        }
      }
    };
    const waitSent = async (waitMs) => {
      const start = Date.now();
      while (Date.now() - start < waitMs) {
        await sleep(150);
        if (sentNow()) return true;
      }
      return false;
    };
    const dispatchKey = (key, mods = {}) => {
      const el = ctx.input;
      if (!el) return;
      const keyCode = key === "Enter" ? 13 : 0;
      const init = {
        key,
        code: key === "Enter" ? "Enter" : key,
        bubbles: true,
        cancelable: true,
        ctrlKey: !!mods.ctrl,
        metaKey: !!mods.meta
      };
      const fire = (type) => {
        const ev = new KeyboardEvent(type, init);
        try {
          Object.defineProperty(ev, "keyCode", { get: () => keyCode });
          Object.defineProperty(ev, "which", { get: () => keyCode });
        } catch {
        }
        el.dispatchEvent(ev);
      };
      fire("keydown");
      fire("keypress");
      fire("keyup");
    };
    const submitEnter = async (p) => {
      const el = ctx.input;
      if (!el) return false;
      el.focus();
      await sleep(100);
      const primary = p.combo || "Enter";
      const attempts = primary === "Enter" ? ["Enter", "Ctrl+Enter", "Meta+Enter"] : [primary];
      for (const combo of attempts) {
        if (combo === "Ctrl+Enter") dispatchKey("Enter", { ctrl: true });
        else if (combo === "Meta+Enter") dispatchKey("Enter", { meta: true });
        else dispatchKey("Enter");
        if (await waitSent(2600)) return true;
      }
      return false;
    };
    const submitSelector = async (p) => {
      const sels = p.sendSelectors || [];
      if (sels.length === 0) return false;
      const deadline = Date.now() + 45e3;
      while (Date.now() < deadline) {
        for (const sel of sels) {
          const btn = qsSafe(sel);
          if (btn && !btnDisabled(btn) && boxy(btn)) {
            clickBtn(btn);
            if (await waitSent(2600)) return true;
          }
        }
        await sleep(400);
      }
      return false;
    };
    const findProximate = () => {
      const el = ctx.input;
      if (!el) return [];
      const ir = el.getBoundingClientRect();
      const seen = /* @__PURE__ */ new Set();
      const candidates = [];
      let scope = el.parentElement;
      for (let i = 0; i < 5 && scope; i++) {
        let nodes;
        try {
          nodes = scope.querySelectorAll('button, [role="button"]');
        } catch {
          break;
        }
        for (let k = 0; k < nodes.length; k++) {
          const btn = nodes[k];
          if (!btn || seen.has(btn)) continue;
          seen.add(btn);
          if (btnDisabled(btn) || !boxy(btn)) continue;
          const br = btn.getBoundingClientRect();
          const dx = br.left + br.width / 2 - (ir.left + ir.width / 2);
          const dy = br.top + br.height / 2 - (ir.top + ir.height / 2);
          if (dx < -20) continue;
          if (Math.abs(dy) > 160) continue;
          if (br.width > ir.width * 0.9) continue;
          const label = (btn.textContent || "") + " " + (btn.getAttribute("aria-label") || "") + " " + (btn.id || "");
          const like = /发送|send/i.test(label);
          candidates.push({ btn, dist: like ? -1 : dx * dx + dy * dy });
        }
        scope = scope.parentElement;
      }
      candidates.sort((a, b) => a.dist - b.dist);
      return candidates.slice(0, 3).map((c) => c.btn);
    };
    const submitProximate = async () => {
      const deadline = Date.now() + 2e4;
      while (Date.now() < deadline) {
        const targets = findProximate();
        for (const btn of targets) {
          clickBtn(btn);
          if (await waitSent(2600)) return true;
        }
        await sleep(400);
      }
      return false;
    };
    const submitEnabledFlip = async () => {
      const base = ctx.disabledBaseline;
      if (!base) return false;
      const deadline = Date.now() + 2e4;
      while (Date.now() < deadline) {
        const flipped = [];
        for (const btn of collectButtons()) {
          if (btnDisabled(btn)) continue;
          if (base.get(btn) === true) flipped.push(btn);
        }
        if (flipped.length > 0) {
          const first = flipped[0];
          if (first) {
            let target = first;
            if (flipped.length > 1 && ctx.input) {
              const ir = ctx.input.getBoundingClientRect();
              let bestDist = Infinity;
              for (const btn of flipped) {
                const br = btn.getBoundingClientRect();
                const dy = (br.top + br.bottom) / 2 - (ir.top + ir.bottom) / 2;
                const dx = (br.left + br.right) / 2 - (ir.left + ir.right) / 2;
                const dist = dx * dx + dy * dy;
                if (dist < bestDist) {
                  bestDist = dist;
                  target = btn;
                }
              }
            }
            clickBtn(target);
            if (await waitSent(2600)) return true;
          }
        }
        await sleep(400);
      }
      return false;
    };
    const confirmAny = async () => waitSent(3e3);
    const pingTargets = /* @__PURE__ */ new Set();
    const registerPing = (fn) => {
      pingTargets.add(fn);
      try {
        window.__askallObservePing = () => {
          for (const f of pingTargets) f();
        };
      } catch {
      }
    };
    const unregisterPing = (fn) => {
      pingTargets.delete(fn);
    };
    const addWakeListeners = (fn) => {
      const on = () => fn();
      window.addEventListener("focus", on);
      window.addEventListener("pointerdown", on);
      window.addEventListener("pageshow", on);
      window.addEventListener("visibilitychange", on);
      return () => {
        window.removeEventListener("focus", on);
        window.removeEventListener("pointerdown", on);
        window.removeEventListener("pageshow", on);
        window.removeEventListener("visibilitychange", on);
      };
    };
    const collectBlocks = () => {
      const out = [];
      let nodes;
      try {
        nodes = document.querySelectorAll("div, section, article, pre, li, p");
      } catch {
        return out;
      }
      const comp = composerRoot();
      const cap = Math.min(nodes.length, 3e3);
      for (let i = 0; i < cap; i++) {
        const el = nodes[i];
        if (!el || !boxy(el)) continue;
        if (ctx.input && (el === ctx.input || el.contains(ctx.input))) continue;
        if (comp && (el === comp || comp.contains(el))) continue;
        if (inSideArea(el)) continue;
        const len = (el.textContent || "").length;
        if (len > 0) out.push({ el, len });
      }
      return out;
    };
    const contentTextLen = () => {
      let total = 0;
      for (const b of collectBlocks()) total += b.len;
      return total;
    };
    const snapshotBlocks = () => {
      const m = /* @__PURE__ */ new Map();
      for (const b of collectBlocks()) m.set(b.el, b.len);
      return m;
    };
    const observeDiff = async (p) => {
      const base = ctx.blockBaseline;
      if (!base) return false;
      const stableMs = p.stableMs ?? 2500;
      const timeout2 = p.timeoutMs ?? 12e4;
      const startedAt = Date.now();
      const stallGiveUpMs = 8e3;
      let lastText = "";
      let stableSince = Date.now();
      let sawReply = false;
      let stalledSince = null;
      const q = question.trim();
      const isEcho = (t, growth) => q.length >= 2 && (t === q || t.startsWith(q) && growth <= q.length + 10);
      const pick = () => {
        const blocks = collectBlocks();
        let maxNew = 0;
        let maxOld = 0;
        for (const b of blocks) {
          const prev = base.get(b.el);
          const growth = prev === void 0 ? b.len : b.len - prev;
          if (prev === void 0) {
            if (growth > maxNew) maxNew = growth;
          } else if (growth > maxOld) {
            maxOld = growth;
          }
        }
        if (maxNew < 5 && maxOld < 5) return null;
        const pickFrom = (onlyNew, maxGrowth) => {
          let best = null;
          let bestDepth = Infinity;
          let bestGrowth = -1;
          for (const b of blocks) {
            const prev = base.get(b.el);
            if (onlyNew !== (prev === void 0)) continue;
            const growth = prev === void 0 ? b.len : b.len - prev;
            if (growth < maxGrowth * 0.8) continue;
            if (onlyNew && isEcho(textOf(b.el), growth)) continue;
            const d = depthOf(b.el);
            if (d < bestDepth || d === bestDepth && growth > bestGrowth) {
              best = b.el;
              bestDepth = d;
              bestGrowth = growth;
            }
          }
          return best;
        };
        return pickFrom(true, maxNew) ?? pickFrom(false, maxOld);
      };
      return new Promise((resolve) => {
        let detachWake = () => {
        };
        const finish = (ok) => {
          try {
            observer?.disconnect();
          } catch {
          }
          timer();
          unregisterPing(check);
          detachWake();
          resolve(ok);
        };
        const check = () => {
          if (Date.now() - startedAt > timeout2) {
            if (lastText) {
              send({
                type: "AI_REPLY_DONE",
                text: lastText,
                url: location.href
              });
            }
            finish(!!lastText);
            return;
          }
          const el = pick();
          if (!el) {
            if (sawReply && stalledSince === null) stalledSince = Date.now();
            if (stalledSince !== null && Date.now() - stalledSince > stallGiveUpMs) {
              finish(false);
              return;
            }
            lastText = "";
            stableSince = Date.now();
            return;
          }
          stalledSince = null;
          const cur = textOf(el);
          if (cur.length === 0) return;
          if (cur !== lastText) {
            sawReply = true;
            lastText = cur;
            stableSince = Date.now();
            send({
              type: "AI_REPLY",
              text: cur,
              url: location.href
            });
          } else if (Date.now() - stableSince > stableMs) {
            send({
              type: "AI_REPLY_DONE",
              text: cur,
              url: location.href
            });
            finish(true);
          }
        };
        let observer = null;
        try {
          observer = new MutationObserver(() => check());
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
          });
        } catch {
          observer = null;
        }
        const timer = interval(check, 1e3);
        registerPing(check);
        detachWake = addWakeListeners(check);
        check();
      });
    };
    const observeSelector = async (p) => {
      const sels = (p.replySelectors || []).length ? p.replySelectors : ['[class*="markdown"]', '[class*="answer"]', '[class*="response"]'];
      const stableMs = p.stableMs ?? 2500;
      const timeout2 = p.timeoutMs ?? 12e4;
      const startedAt = Date.now();
      const extract = () => {
        for (const sel of sels) {
          const nodes = qsaSafe(sel).filter((n) => !inSideArea(n));
          const last = nodes[nodes.length - 1];
          if (last) return textOf(last);
        }
        return "";
      };
      const base = extract();
      let lastText = base;
      let sawNew = false;
      let stableSince = Date.now();
      return new Promise((resolve) => {
        let detachWake = () => {
        };
        const finish = (ok) => {
          try {
            observer?.disconnect();
          } catch {
          }
          timer();
          unregisterPing(check);
          detachWake();
          resolve(ok);
        };
        const check = () => {
          if (Date.now() - startedAt > timeout2) {
            if (sawNew && lastText) {
              send({
                type: "AI_REPLY_DONE",
                text: lastText,
                url: location.href
              });
            }
            finish(sawNew);
            return;
          }
          const cur = extract();
          if (cur.length === 0) {
            lastText = "";
            stableSince = Date.now();
            return;
          }
          if (cur !== lastText) {
            lastText = cur;
            stableSince = Date.now();
            if (cur !== base) {
              sawNew = true;
              send({ type: "AI_REPLY", text: cur, url: location.href });
            }
          } else if (sawNew && Date.now() - stableSince > stableMs) {
            send({
              type: "AI_REPLY_DONE",
              text: cur,
              url: location.href
            });
            finish(true);
          }
        };
        let observer = null;
        try {
          observer = new MutationObserver(() => check());
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
          });
        } catch {
          observer = null;
        }
        const timer = interval(check, 1e3);
        registerPing(check);
        detachWake = addWakeListeners(check);
        check();
      });
    };
    const observeText = async (p) => {
      const stableMs = p.stableMs ?? 3e3;
      const timeout2 = p.timeoutMs ?? 12e4;
      const startedAt = Date.now();
      let lastText = "";
      let stableSince = Date.now();
      return new Promise((resolve) => {
        let detachWake = () => {
        };
        const check = () => {
          if (Date.now() - startedAt > timeout2) {
            timer();
            unregisterPing(check);
            detachWake();
            if (lastText) {
              send({
                type: "AI_REPLY_DONE",
                text: lastText,
                url: location.href
              });
            }
            resolve(!!lastText);
            return;
          }
          const len = contentTextLen();
          const cur = (document.body.innerText || "").trim();
          if (len > ctx.pageTextBaseline + 20 && cur !== lastText) {
            lastText = cur;
            stableSince = Date.now();
            send({ type: "AI_REPLY", text: cur, url: location.href });
          } else if (lastText && Date.now() - stableSince > stableMs) {
            timer();
            unregisterPing(check);
            detachWake();
            send({
              type: "AI_REPLY_DONE",
              text: lastText,
              url: location.href
            });
            resolve(true);
          }
        };
        const timer = interval(check, 1200);
        registerPing(check);
        detachWake = addWakeListeners(check);
        check();
      });
    };
    const registry = {
      "locate:editable-bottom": locateEditableBottom,
      "locate:selector": locateSelector,
      "locate:focused": locateFocused,
      "fill:auto": fillAuto,
      "fill:paste": fillPaste,
      "fill:insert-text": fillInsertText,
      "fill:value-setter": fillValueSetter,
      "attach:paste": attachPaste,
      "attach:trigger-file-input": attachTriggerFileInput,
      "attach:file-input": attachFileInput,
      "attach:drop": attachDrop,
      "submit:enter": submitEnter,
      "submit:enabled-flip": submitEnabledFlip,
      "submit:proximate": submitProximate,
      "submit:selector": submitSelector,
      "confirm:any": confirmAny,
      "observe:diff": observeDiff,
      "observe:selector": observeSelector,
      "observe:text": observeText
    };
    const snapshotDom = () => {
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return [
          Math.round(r.x),
          Math.round(r.y),
          Math.round(r.width),
          Math.round(r.height)
        ];
      };
      const editables = collectEditable().slice(0, 8).map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || void 0,
        cls: typeof el.className === "string" ? el.className.slice(0, 80) : void 0,
        placeholder: el.getAttribute("placeholder") || void 0,
        role: el.getAttribute("role") || void 0,
        rect: rect(el)
      }));
      const buttons = collectButtons().filter((b) => boxy(b)).slice(0, 12).map((b) => ({
        tag: b.tagName.toLowerCase(),
        id: b.id || void 0,
        cls: typeof b.className === "string" ? b.className.slice(0, 80) : void 0,
        ariaLabel: b.getAttribute("aria-label") || void 0,
        disabled: btnDisabled(b),
        rect: rect(b)
      }));
      return { href: location.href, editables, buttons };
    };
    const snapshotBrief = (s) => {
      const ir = ctx.input ? ctx.input.getBoundingClientRect() : null;
      let near = 0;
      if (ir) {
        near = s.buttons.filter((b) => {
          const w = b.rect[2];
          const h = b.rect[3];
          if (w <= 0 || h <= 0) return false;
          const dx = b.rect[0] + w / 2 - (ir.left + ir.width / 2);
          const dy = b.rect[1] + h / 2 - (ir.top + ir.height / 2);
          return dx > -20 && Math.abs(dy) <= 160;
        }).length;
      }
      return `\uFF08\u9875\u9762\u63A2\u6D4B\uFF1A\u53EF\u7F16\u8F91\u5143\u7D20 ${s.editables.length} \u4E2A\uFF0C\u53EF\u89C1\u6309\u94AE ${s.buttons.length} \u9897\uFF0C\u8F93\u5165\u6846\u90BB\u57DF ${near} \u9897\uFF09`;
    };
    const withTimeout = (fn, ms) => new Promise((resolve) => {
      let done = false;
      const clear = timeout(() => {
        if (done) return;
        done = true;
        resolve(false);
      }, ms);
      fn.then((v) => {
        if (done) return;
        done = true;
        clear();
        resolve(v);
      }).catch(() => {
        if (done) return;
        done = true;
        clear();
        resolve(false);
      });
    });
    send({ type: "AI_SENDING" });
    for (const step of recipe.steps) {
      if (step.id === "attach" && files.length === 0) continue;
      const stepTimeout = step.timeoutMs ?? 15e3;
      const stepStart = Date.now();
      let ok = false;
      let usedKind = "";
      const runChain = async (perTryTimeout) => {
        for (const sd of step.strategies) {
          const fn = registry[sd.kind];
          if (!fn) continue;
          let params = sd.params || {};
          if (step.id === "observe") {
            const remain = Math.max(
              5e3,
              (sd.timeoutMs ?? stepTimeout) - (Date.now() - stepStart)
            );
            params = {
              ...params,
              timeoutMs: Math.min(params.timeoutMs ?? remain, remain)
            };
          }
          try {
            if (await withTimeout(fn(params), Math.min(perTryTimeout, sd.timeoutMs ?? perTryTimeout))) {
              usedKind = sd.kind;
              return true;
            }
          } catch (e) {
          }
          usedKind = sd.kind;
        }
        return false;
      };
      ok = await runChain(stepTimeout);
      while (!ok && step.id === "locate" && Date.now() - stepStart < stepTimeout) {
        await sleep(500);
        ok = await runChain(Math.min(3e3, stepTimeout));
      }
      report(step.id, usedKind, ok, ok ? void 0 : "\u7B56\u7565\u672A\u751F\u6548");
      if (ok && step.id === "locate") {
        ctx.disabledBaseline = snapshotDisabled();
        ctx.blockBaseline = snapshotBlocks();
        ctx.pageTextBaseline = contentTextLen();
      }
      if (ok && step.id === "fill") {
        ctx.pageTextBaseline = contentTextLen();
      }
      if (ok && step.id === "attach") {
        ctx.input?.focus?.();
        await waitForUploadSettle(15e3);
        await sleep(1500);
        ctx.blockBaseline = snapshotBlocks();
        ctx.pageTextBaseline = contentTextLen();
      }
      if (ok && step.id === "submit") {
        await settle(4e3);
        ctx.blockBaseline = snapshotBlocks();
        ctx.pageTextBaseline = contentTextLen();
      }
      if (!ok) {
        if (step.id === "observe") {
          send({
            type: "AI_REPLY_DONE",
            text: `\u3010AskAll \xB7 ${recipe.name}\u3011\u5DF2\u63D0\u4EA4\u4F46\u672A\u80FD\u6293\u53D6\u5230\u56DE\u7B54\uFF0C\u82E5\u5E73\u53F0\u5DF2\u56DE\u7B54\u8BF7\u70B9\u300C\u67E5\u770B\u539F\u6587\u300D\u3002`,
            url: location.href
          });
        } else if (step.optional) {
          continue;
        } else {
          const stepName = step.id === "locate" ? "\u5B9A\u4F4D\u8F93\u5165\u6846" : step.id === "fill" ? "\u5199\u5165\u95EE\u9898" : step.id === "attach" ? "\u9644\u52A0\u6587\u4EF6" : "\u81EA\u52A8\u53D1\u9001";
          const tried = step.strategies.map((s) => s.kind).join("\u3001");
          const snap = snapshotDom();
          const reason = `\u3010AskAll \xB7 ${recipe.name}\u3011${stepName}\u5931\u8D25\uFF08\u5DF2\u8BD5\uFF1A${tried}\uFF09\uFF0C\u8BF7\u5728\u5E73\u53F0\u624B\u52A8\u53D1\u9001${snapshotBrief(snap)}`;
          report(step.id, usedKind, false, reason, snap);
          send({
            type: "AI_REPLY_DONE",
            text: reason,
            url: location.href
          });
          return;
        }
      }
    }
  }
  return __toCommonJS(engine_exports);
})();
