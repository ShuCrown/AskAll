//! 注入到 AI 子 webview 的自动化脚本（桌面端移植版）。
//!
//! 与扩展端完全一致：注入 @askall/shared 的 runAutomation 引擎
//! （由 apps/desktop/scripts/build-engine.mjs 打包为 src-tauri/assets/engine.js，
//! 以全局名 AskAllEngine 暴露），并按各 AI 的 Recipe 执行
//! 「定位输入框 → 填入问题 → 提交发送 → 观察回答」的完整流程。
//! 引擎内置语义评分 / 状态翻转 / DOM 增量快照等抗改版策略，替代旧的固定选择器。
//!
//! 回传通道：引擎派发 `askall:ai-reply` CustomEvent（与扩展端一致），
//! 本文件包装层监听该事件 → `window.__TAURI_INTERNALS__.invoke('emit_ai_reply', {...})`
//! 回传 Rust；由 lib.rs 的 `emit_ai_reply` 命令接收并转发为 'ai-reply' 事件给主窗口。
//! url 为回复发生时的页面地址（真实会话页 chat/xxx），用于跳转与历史回写。
//!
//! 参数（text / recipe / meta）以 JSON 字面量注入，不引用任何外部变量。

/// 由 `pnpm build:engine`（esbuild）生成的引擎单文件。
/// 缺失时 `cargo build` 会直接编译失败，需先运行
/// `pnpm --filter @askall/desktop build:engine` 重新生成。
const ENGINE_JS: &str = include_str!("../assets/engine.js");

/// 选择器集合（与前端 `AiSelectors` 一致，Rust 端镜像定义）。
/// 新引擎以 Recipe 为主，选择器仅作配置透传保留，供自定义平台注入通用策略链。
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, Default)]
pub struct AiSelectors {
    pub input: String,
    pub input_candidates: Option<Vec<String>>,
    pub send_button: Option<String>,
    pub send_button_candidates: Option<Vec<String>>,
    pub reply_candidates: Option<Vec<String>>,
}

/// 把参数注入引擎包装层，产出可直接 `Webview::eval` 的 JS。
pub fn build_payload(
    text: &str,
    ai_id: &str,
    ai_name: &str,
    task_id: &str,
    recipe: &serde_json::Value,
) -> String {
    let text_json = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string());
    let recipe_json = serde_json::to_string(recipe).unwrap_or_else(|_| "null".to_string());
    let meta_json = serde_json::json!({
        "aiName": ai_name,
        "aiId": ai_id,
        "taskId": task_id,
    })
    .to_string();

    format!(
        r#"{ENGINE_JS}
;(function () {{
  var TEXT = {text_json};
  var RECIPE = {recipe_json};
  var META = {meta_json};

  // 引擎内置回传是 CustomEvent('askall:ai-reply')；本层监听并桥接到 Tauri IPC。
  // 自愈记忆（ASKALL_STEP_RESULT）暂未接入桌面端，仅打印调试日志。
  function forward(msg) {{
    try {{
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {{
        window.__TAURI_INTERNALS__.invoke('emit_ai_reply', {{
          type: msg.type,
          aiId: msg.aiId,
          aiName: msg.aiName,
          taskId: msg.taskId,
          text: msg.text == null ? null : String(msg.text),
          url: msg.url == null ? null : String(msg.url)
        }});
      }}
    }} catch (e) {{ /* 忽略 IPC 不可用 */ }}
  }}

  window.addEventListener('askall:ai-reply', function (e) {{
    var d = e && e.detail;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'ASKALL_STEP_RESULT') {{
      console.warn('[askall-engine] step result:', d.stepId, d.kind, d.ok, d.reason || '');
      return;
    }}
    forward(d);
  }});

  function fail(text) {{
    forward({{ type: 'AI_REPLY_DONE', aiId: META.aiId, aiName: META.aiName, taskId: META.taskId, text: text, url: null }});
  }}

  try {{
    if (typeof AskAllEngine === 'undefined' || !AskAllEngine.runAutomation) {{
      fail('【AskAll】自动化引擎未就绪（engine.js 注入失败），请在平台手动发送。');
      return;
    }}
    AskAllEngine.runAutomation(TEXT, RECIPE, META).catch(function (err) {{
      fail('【AskAll】引擎执行异常: ' + (err && err.message ? err.message : String(err)));
    }});
  }} catch (e) {{
    fail('【AskAll】注入异常: ' + (e && e.message ? e.message : String(e)));
  }}
}})();
"#
    )
}

/// 回退用的通用 Recipe（与 shared recipes.ts 的 `genericSteps()` 无选择器版本等价）。
/// 前端总会带上内置/通用 Recipe（platform-tauri.ts 的 recipeForConfig），
/// 此函数仅在 config 里缺 recipe 字段（旧前端/直接构造）时兜底。
pub fn generic_recipe(ai_id: &str, name: &str, url: &str) -> serde_json::Value {
    serde_json::json!({
        "id": ai_id,
        "name": name,
        "version": 0,
        "url": url,
        "steps": [
            {
                "id": "locate",
                "timeoutMs": 20000,
                "strategies": [
                    { "kind": "locate:editable-bottom" },
                    { "kind": "locate:focused" }
                ]
            },
            {
                "id": "fill",
                "timeoutMs": 12000,
                "strategies": [
                    { "kind": "fill:auto" },
                    { "kind": "fill:paste" },
                    { "kind": "fill:insert-text" },
                    { "kind": "fill:value-setter" }
                ]
            },
            {
                "id": "submit",
                "timeoutMs": 60000,
                "strategies": [
                    { "kind": "submit:enter" },
                    { "kind": "submit:enabled-flip" },
                    { "kind": "submit:proximate" }
                ]
            },
            {
                "id": "confirm",
                "timeoutMs": 8000,
                "optional": true,
                "strategies": [ { "kind": "confirm:any" } ]
            },
            {
                "id": "observe",
                "timeoutMs": 130000,
                "strategies": [
                    { "kind": "observe:diff" },
                    { "kind": "observe:text" }
                ]
            }
        ]
    })
}
