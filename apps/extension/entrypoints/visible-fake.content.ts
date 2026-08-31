/**
 * 后台标签页可见性伪装（MAIN world，document_start）。
 *
 * 背景：AskAll 在后台标签页里打开各 AI 站点并发送问题，但豆包/千问/文心
 * 等站点会检查 `document.hidden`，为后台标签页走「懒初始化」分支——
 * 编辑器组件不挂载（千问/文心直接定位不到输入框）或发送按钮不渲染
 * （豆包填入成功却找不到发送按钮）。
 *
 * 引擎里也有同款覆写（automation/engine.ts），但那是 executeScript 注入后
 * 才执行——总是晚于站点 bundle 的初始化判断，覆不回来。这里在 document_start
 * 以 MAIN world 抢在站点代码之前定义 getter，让站点从一开始就认为页面可见。
 *
 * 副作用评估：后台标签页的视频自动播放/动画照常执行，对 AI 聊天站点无害。
 */
export default defineContentScript({
  matches: [
    '*://*.deepseek.com/*',
    '*://*.doubao.com/*',
    '*://*.qianwen.com/*',
    '*://*.yiyan.baidu.com/*',
    '*://*.wenxin.baidu.com/*',
    '*://*.tongyi.aliyun.com/*',
    '*://*.kimi.moonshot.cn/*',
    '*://*.moonshot.cn/*',
  ],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    try {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => false,
      });
      // 部分站点（字节系常见）用 hasFocus 而非 visibilityState 判断
      // 「用户是否在看」，后台标签页两者都是否，一并伪装。
      document.hasFocus = () => true;
    } catch {
      /* 不可覆写则维持原行为，引擎内的兜底覆写继续生效 */
    }

    // 后台标签页下 Chrome 会完全暂停 requestAnimationFrame，依赖 rAF 渲染的
    // 站点（流式/打字机文本）在后台不再更新 DOM，引擎观察不到回答增长
    // （表现为「一直正在发送，切回标签页才出内容」）。用 MessageChannel
    // 时钟以 ~16ms 周期派发 rAF 回调，让流式渲染在后台继续推进。
    // document_start 抢在站点代码之前补丁，站点持有的 rAF 引用即为新版。
    try {
      const fastClock = (() => {
        const queue: Array<() => void> = [];
        let armed = false;
        const drain = () => {
          // 快照式消费：自转任务（interval 的 step 反复把自己入队）若被 while
          // 内联消费会在同一次 drain 里同步自旋，卡死页面主线程（AI 页无法加载）。
          // 只处理本条消息已入队的任务，新入队者交给下一条消息执行。
          const batch = queue.splice(0);
          armed = false;
          for (const fn of batch) {
            if (fn) {
              try {
                fn();
              } catch {
                /* ignore */
              }
            }
          }
        };
        try {
          const chan = new MessageChannel();
          chan.port1.onmessage = drain;
          return (fn: () => void) => {
            queue.push(fn);
            if (!armed) {
              armed = true;
              chan.port2.postMessage(0);
            }
          };
        } catch {
          return (fn: () => void) => setTimeout(fn, 0);
        }
      })();

      const rafQueue = new Map<number, FrameRequestCallback>();
      let rafId = 0;
      let stopRaf: (() => void) | null = null;
      const pump = () => {
        if (rafQueue.size === 0) return;
        const now = performance.now();
        const entries = Array.from(rafQueue.entries());
        rafQueue.clear();
        for (const [, cb] of entries) {
          try {
            cb(now);
          } catch {
            /* ignore */
          }
        }
      };
      const rafInterval = (fn: () => void, ms: number): (() => void) => {
        let cancelled = false;
        const tick = () => {
          if (cancelled) return;
          const start = Date.now();
          try {
            fn();
          } catch {
            /* ignore */
          }
          const step = () => {
            if (cancelled) return;
            if (Date.now() - start >= ms) tick();
            else fastClock(step);
          };
          fastClock(step);
        };
        fastClock(tick);
        return () => {
          cancelled = true;
        };
      };
      const w = window as unknown as {
        requestAnimationFrame: (cb: FrameRequestCallback) => number;
        cancelAnimationFrame: (id: number) => void;
      };
      w.requestAnimationFrame = (cb) => {
        rafQueue.set(++rafId, cb);
        if (!stopRaf) stopRaf = rafInterval(pump, 16);
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
      /* 不可覆写则维持原行为 */
    }
  },
});
