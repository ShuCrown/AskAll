//! AskAll 桌面端 Tauri 后端。
//!
//! 与前端 `apps/desktop/src/platform-tauri.ts` 的契约一一对应：
//!   - ask_ai(text, configs, mode)          新会话提问
//!   - ask_ai_followup(text, configs, mode) 追问（复用已打开的 AI 聊天页）
//!   - get_task() -> AskTask | null         当前任务
//!   - open_ai_webview(url)                 手动打开 AI 站点（独立子窗口）
//!   - show_ai_chat(aiId, url, name)        聚焦/展示某个 AI 的聊天页
//!   - layout_ai_grid(cells)                将各 AI 聊天页以网格布局到主窗口（田字格）
//!   - open_settings_window()               打开/聚焦独立设置窗口（#settings 路由）
//!   - emit_ai_reply(type, aiId, aiName, taskId, text, url)  聊天页回传回复（IPC），
//!     url 为回复发生时的页面地址（真实会话页 chat/xxx）
//!
//! 「ask 编排器」：
//!   - mode = "browser"  → opener 在系统浏览器打开（无法自动发送，回传提示）
//!   - mode = "embedded" → 把 AI 聊天页以 Webview attach 到主窗口（不弹独立窗口），
//!     由主窗口前端按「田字格」布局（layout_ai_grid），点击可放大单个 chat 铺满整窗、
//!     可还原回网格；注入 auto_send::build_payload 产出的 JS（@askall/shared 的
//!     runAutomation 引擎 + 各 AI 的 Recipe，自动填充+发送+回复观察），
//!     JS 通过 __TAURI_INTERNALS__.invoke 回调 emit_ai_reply，再由本端
//!     emit('ai-reply', payload) 推给主窗口，用于状态汇总与历史会话地址回写。

mod auto_send;
mod os_ask;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::webview::WebviewBuilder;
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
    WebviewWindowBuilder,
};
use tokio::sync::Mutex;

// ---------- 数据模型（与前端 utils/task.ts、utils/aiConfig.ts 对齐） ----------

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub auto_send: bool,
    #[serde(default)]
    pub selectors: Option<auto_send::AiSelectors>,
    #[serde(default)]
    pub is_default: Option<bool>,
    /// 自动化 Recipe（JSON，由前端 @askall/shared 的 resolveRecipe / genericSteps 构建，
    /// 与扩展端同一份数据）。注入引擎时使用；为空时回退到 Rust 内置通用 Recipe。
    #[serde(default)]
    pub recipe: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResult {
    pub ai_id: String,
    pub ai_name: String,
    pub status: String,
    pub answer: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskTask {
    pub id: String,
    pub question: String,
    pub created_at: f64,
    pub conversation_id: String,
    pub results: HashMap<String, AiResult>,
}

/// 主窗口田字格中单个 AI 聊天页的布局单元（与前端 AskGridCell 一致）。
/// 坐标/尺寸为逻辑像素，相对主窗口内容区；width/height 为 0 表示隐藏该页。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridCell {
    pub ai_id: String,
    pub url: String,
    pub name: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// 推给主窗口的回复进度载荷（与前端 ReplyMessage 一致）。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReplyPayload {
    #[serde(rename = "type")]
    pub kind: String,
    pub ai_id: String,
    pub ai_name: String,
    pub task_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// 回复发生时的页面地址（真实会话页 chat/xxx），用于跳转对应会话与历史回写。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

// ---------- 应用状态 ----------

struct AppState {
    current_task: Mutex<Option<AskTask>>,
    /// aiId -> 该 AI 子窗口当前已知 URL。
    /// 提问时记为配置首页；捕获到回复时更新为真实会话地址（chat/xxx）。
    /// `show_ai_chat` 据此做「差异导航」：请求地址与当前一致时只显示不跳转，
    /// 避免重复 reload 打断进行中的流式回复。
    ai_current_urls: Mutex<HashMap<String, String>>,
    /// 已回传 AI_REPLY_DONE 的 (taskId, aiId)。
    /// 保活心跳据此判断该聊天页已结束、可停止周期性 eval（见 run_one_ai）。
    done_replies: Mutex<HashSet<(String, String)>>,
}

// ---------- 工具函数 ----------

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

fn gen_id() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let c = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("{:x}-{:x}", ms, c)
}

/// Chrome 兼容 UA：部分 AI 站点（如豆包）按 UA 识别到 WKWebView/WebView 的
/// Safari 类 UA 后不渲染聊天界面（白屏）；其它站点不受影响。统一用 Chrome UA，
/// 与扩展端（真实 Chrome 浏览器）行为保持一致。按平台给出对应 OS 的 UA。
fn chrome_user_agent() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    }
    #[cfg(target_os = "macos")]
    {
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    }
}

/// 创建或复用独立 AI 窗口（兜底路径：attach 到主窗口的聊天页不存在时，
/// 如重启后回看历史会话，show_ai_chat 用）。
fn get_or_create_ai_window(
    app: &tauri::AppHandle,
    label: &str,
    title: &str,
    url: &str,
    navigate: bool,
    show: bool,
) -> Result<tauri::WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(label) {
        if show {
            let _ = w.show();
            let _ = w.set_focus();
        }
        if navigate {
            let js = format!("window.location.replace({:?})", url);
            let _ = w.eval(&js);
        }
        return Ok(w);
    }
    let parsed = url
        .parse::<url::Url>()
        .map_err(|e: url::ParseError| format!("invalid url: {e}"))?;
    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::External(parsed))
        .user_agent(chrome_user_agent())
        .title(title)
        .inner_size(520.0, 720.0)
        .min_inner_size(360.0, 480.0)
        .visible(show)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(win)
}

/// 确保 `ai-{aiId}` 聊天页已作为 Webview attach 到主窗口，并定位到 (x,y,w,h)。
/// 幂等：已存在时仅更新位置/尺寸（保留当前聊天状态，不重新加载）。
/// 由两处调用：前端田字格布局（layout_ai_grid）与 ask 编排器（run_one_ai）。
fn ensure_embedded_webview(
    app: &tauri::AppHandle,
    cell: &GridCell,
) -> Result<tauri::Webview, String> {
    let label = format!("ai-{}", cell.ai_id);
    let pos = LogicalPosition::new(cell.x, cell.y);
    let size = LogicalSize::new(cell.width, cell.height);
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.set_position(Position::Logical(pos));
        let _ = wv.set_size(Size::Logical(size));
        let _ = wv.show();
        return Ok(wv);
    }
    let main = app.get_webview_window("main").ok_or("主窗口不存在")?;
    let parsed = cell
        .url
        .parse::<url::Url>()
        .map_err(|e: url::ParseError| format!("invalid url: {e}"))?;
    // attach 到主窗口：Window::add_child(WebviewBuilder::new(label, url), pos, size)。
    // 注意：不给内嵌子 webview 设置 user_agent —— 实测 add_child 的子 webview 设置
    // 自定义 UA 后不再渲染（单元格只剩 DOM 占位「聊天页加载中…」）。
    // 豆包等站点 UA 兼容问题另想办法，不再在此处注入 UA。
    let window = main.as_ref().window();
    let wv_builder = WebviewBuilder::new(label, WebviewUrl::External(parsed));
    let wv = window
        .add_child(
            wv_builder,
            LogicalPosition::new(cell.x, cell.y),
            LogicalSize::new(cell.width, cell.height),
        )
        .map_err(|e| e.to_string())?;
    let _ = wv.set_position(Position::Logical(pos));
    let _ = wv.set_size(Size::Logical(size));
    Ok(wv)
}

/// 单个 AI 的发送流程（在独立 tokio task 中运行）。
async fn run_one_ai(
    app: tauri::AppHandle,
    cfg: AiConfig,
    text: String,
    task_id: String,
    mode: String,
    follow_up: bool,
) {
    if mode == "browser" {
        // 系统浏览器模式：无法跨域自动发送/捕获，仅打开并提示用户手动操作。
        let _ = tauri_plugin_opener::open_url(cfg.url.clone(), None::<&str>);
        let _ = app.emit(
            "ai-reply",
            ReplyPayload {
                kind: "AI_REPLY_DONE".into(),
                ai_id: cfg.id.clone(),
                ai_name: cfg.name.clone(),
                task_id,
                text: Some("已在系统浏览器打开，请在浏览器中手动发送 / 查看。".into()),
                url: None,
            },
        );
        return;
    }

    // embedded：把聊天页 attach 到主窗口（不弹独立窗口），由前端田字格统一布局。
    // 位置先给默认值，前端 layout_ai_grid 会立即重排到对应格子。
    // 追问时复用同一 Webview（不导航不重载，保留当前聊天上下文）。
    let boot_cell = GridCell {
        ai_id: cfg.id.clone(),
        url: cfg.url.clone(),
        name: Some(cfg.name.clone()),
        x: 0.0,
        y: 0.0,
        width: 520.0,
        height: 720.0,
    };
    let webview = match ensure_embedded_webview(&app, &boot_cell) {
        Ok(w) => w,
        Err(e) => {
            let _ = app.emit(
                "ai-reply",
                ReplyPayload {
                    kind: "AI_REPLY_DONE".into(),
                    ai_id: cfg.id.clone(),
                    ai_name: cfg.name.clone(),
                    task_id,
                    text: Some(format!("打开内嵌聊天页失败：{e}")),
                    url: None,
                },
            );
            return;
        }
    };

    // 记录该 AI 聊天页当前所在 URL（配置首页），供差异导航：
    // 请求地址与此一致（或页面已自行跳到会话页）时只聚焦不跳转，
    // 避免重复 reload 打断进行中的流式回复。
    app.state::<AppState>()
        .ai_current_urls
        .lock()
        .await
        .insert(cfg.id.clone(), cfg.url.clone());

    let _ = app.emit(
        "ai-reply",
        ReplyPayload {
            kind: "AI_SENDING".into(),
            ai_id: cfg.id.clone(),
            ai_name: cfg.name.clone(),
            task_id: task_id.clone(),
            text: None,
            url: None,
        },
    );

    // 用前端构建的 Recipe（@askall/shared 同一份数据）注入 runAutomation 引擎；
    // 缺 recipe 时回退到 Rust 内置通用 Recipe，保证任何配置都能跑通用策略链。
    let recipe = cfg
        .recipe
        .clone()
        .unwrap_or_else(|| auto_send::generic_recipe(&cfg.id, &cfg.name, &cfg.url));
    let js = auto_send::build_payload(&text, &cfg.id, &cfg.name, &task_id, &recipe);

    // 新会话：等页面加载稳定再注入；追问：页面已就绪，稍等即可。
    let delay = if follow_up { 1 } else { 2 };
    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
    if let Err(e) = webview.eval(&js) {
        log::warn!("[askall] 注入脚本到 {} 失败: {}", cfg.id, e);
    }

    // 保活心跳：macOS WKWebView 对失焦/后台的内嵌 webview 会节流 JS 定时器与
    // React 调度，表现为引擎的发送检测与观察停滞——面板一直停在「正在发送」，
    // 切回聊天页（webview 重新获得焦点）才回传回复。由 Rust 侧周期性 eval
    // 探活脚本强制唤起 webview 的 JS 事件循环，并触发引擎注册的
    // window.__askallObservePing() 立即补跑各观察策略的 check()。
    // 收到该任务 AI_REPLY_DONE 或超过观察上限后自动停止。
    {
        let app = app.clone();
        let wv = webview.clone();
        let ai_id = cfg.id.clone();
        let task_id = task_id.clone();
        tokio::spawn(async move {
            const PING_JS: &str =
                "try{window.__askallObservePing&&window.__askallObservePing()}catch(e){}";
            let max = std::time::Duration::from_secs(150);
            let started = std::time::Instant::now();
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(700)).await;
                if started.elapsed() > max {
                    break;
                }
                if app
                    .state::<AppState>()
                    .done_replies
                    .lock()
                    .await
                    .contains(&(task_id.clone(), ai_id.clone()))
                {
                    break;
                }
                let _ = wv.eval(PING_JS);
            }
        });
    }
}

/// ask / followup 的公共编排逻辑。
/// `conversation_id` 仅追问时可由前端传入（延续指定会话，不依赖内存当前任务），
/// 避免应用重启后追问被当成新话题。
async fn dispatch_ask(
    app: tauri::AppHandle,
    state: &AppState,
    text: String,
    configs: Vec<AiConfig>,
    mode: String,
    follow_up: bool,
    conversation_id: Option<String>,
) -> Result<(), String> {
    if configs.is_empty() {
        return Err("未选择任何 AI".into());
    }

    // 新任务开始时清空上一轮的「已完成」记录：保活心跳只关心当前任务
    state.done_replies.lock().await.clear();

    // 会话归属：追问优先用前端传入的会话 id；否则复用当前任务的 conversationId
    // （延续同一话题）；新提问总是开启新会话（否则「新话题」会被追加进上一个话题）。
    let conversation_id = if let Some(id) = conversation_id {
        id
    } else if follow_up {
        let guard = state.current_task.lock().await;
        guard
            .as_ref()
            .map(|t| t.conversation_id.clone())
            .unwrap_or_else(gen_id)
    } else {
        gen_id()
    };
    let task_id = gen_id();

    let mut results = HashMap::new();
    for c in &configs {
        results.insert(
            c.id.clone(),
            AiResult {
                ai_id: c.id.clone(),
                ai_name: c.name.clone(),
                status: "opening".into(),
                answer: String::new(),
                url: Some(c.url.clone()),
                error: None,
            },
        );
    }
    let task = AskTask {
        id: task_id.clone(),
        question: text.clone(),
        created_at: now_ms(),
        conversation_id,
        results,
    };
    *state.current_task.lock().await = Some(task);

    for c in configs {
        let app2 = app.clone();
        let text2 = text.clone();
        let task_id2 = task_id.clone();
        let mode2 = mode.clone();
        tokio::spawn(async move {
            run_one_ai(app2, c, text2, task_id2, mode2, follow_up).await;
        });
    }
    Ok(())
}

// ---------- Tauri 命令 ----------

#[tauri::command]
async fn ask_ai(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    text: String,
    configs: Vec<AiConfig>,
    mode: String,
) -> Result<(), String> {
    dispatch_ask(app, state.inner(), text, configs, mode, false, None).await
}

#[tauri::command]
async fn ask_ai_followup(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    text: String,
    configs: Vec<AiConfig>,
    mode: String,
    conversation_id: Option<String>,
) -> Result<(), String> {
    dispatch_ask(app, state.inner(), text, configs, mode, true, conversation_id).await
}

#[tauri::command]
async fn get_task(state: tauri::State<'_, AppState>) -> Result<Option<AskTask>, String> {
    Ok(state.current_task.lock().await.clone())
}

#[tauri::command]
async fn open_ai_webview(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let label = format!("ai-manual-{}", gen_id());
    let parsed = url
        .parse::<url::Url>()
        .map_err(|e: url::ParseError| e.to_string())?;
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .user_agent(chrome_user_agent())
        .title("AskAll AI")
        .inner_size(520.0, 720.0)
        .min_inner_size(360.0, 480.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 展示某个 AI 的聊天页（「打开源会话」入口）。
/// 优先聚焦已 attach 到主窗口的 `ai-{aiId}` 聊天页（保留当前聊天状态）；
/// 「差异导航」：仅当请求地址（如历史会话 chat/xxx）与当前已知地址不同时
/// 才跳转，避免重复 reload 打断进行中的流式回复。
/// 不存在（如重启后回看历史会话）则以该会话 URL 新建可见独立窗口兜底。
#[tauri::command]
async fn show_ai_chat(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    ai_id: String,
    url: String,
    name: Option<String>,
) -> Result<(), String> {
    let label = format!("ai-{}", ai_id);
    let known = state.ai_current_urls.lock().await.get(&ai_id).cloned();
    if let Some(w) = app.get_webview(&label) {
        let _ = w.set_focus();
        // 差异导航：请求地址与当前已知地址一致时仅聚焦，不重新加载页面
        if !url.is_empty() && known.as_deref() != Some(url.as_str()) {
            let js = format!("window.location.replace({:?})", url);
            let _ = w.eval(&js);
            state.ai_current_urls.lock().await.insert(ai_id, url);
        }
        return Ok(());
    }
    let title = name.unwrap_or_else(|| "AskAll AI".into());
    get_or_create_ai_window(&app, &label, &title, &url, true, true).map(|_| ())?;
    state.ai_current_urls.lock().await.insert(ai_id, url);
    Ok(())
}

/// 把多个 AI 聊天页按给定「田字格」布局放置到主窗口。
/// 每个 cell 独立定位；width/height 为 0 的 cell 表示隐藏（放大单个 chat 时其余归零）。
/// 「精确可见」：仅当前 cells 列表中的 ai-* 聊天页显示并定位，
/// 其余（如切换会话/新话题后残留的旧 chat）一律隐藏，避免旧窗口仍显示。
#[tauri::command]
async fn layout_ai_grid(app: tauri::AppHandle, cells: Vec<GridCell>) -> Result<(), String> {
    let want: HashSet<String> = cells.iter().map(|c| c.ai_id.clone()).collect();
    for (label, wv) in app.webviews() {
        if let Some(id) = label.strip_prefix("ai-") {
            if !want.contains(id) {
                let _ = wv.hide();
            }
        }
    }
    for c in cells {
        ensure_embedded_webview(&app, &c)?;
    }
    Ok(())
}

/// AI 聊天页通过 __TAURI_INTERNALS__.invoke 回传回复；本命令转发为主窗口事件。
/// 携带 `url`（回复发生时的页面地址）时，同时更新任务结果与 URL 记录（chat/xxx），
/// 供前端「跳转对应会话」与历史回写使用。
#[tauri::command]
async fn emit_ai_reply(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    r#type: String,
    ai_id: String,
    ai_name: String,
    task_id: String,
    text: Option<String>,
    url: Option<String>,
) -> Result<(), String> {
    if let Some(url) = url.as_deref().filter(|u| !u.is_empty()) {
        // 窗口已自行跳转到真实会话页（chat/xxx）：更新已知地址 + 任务结果
        state
            .ai_current_urls
            .lock()
            .await
            .insert(ai_id.clone(), url.to_string());
        let mut guard = state.current_task.lock().await;
        if let Some(task) = guard.as_mut() {
            if task.id == task_id {
                if let Some(r) = task.results.get_mut(&ai_id) {
                    r.url = Some(url.to_string());
                }
            }
        }
    }
    // 标记该 AI 已完成，保活心跳据此停止周期性 eval
    if r#type == "AI_REPLY_DONE" {
        state
            .done_replies
            .lock()
            .await
            .insert((task_id.clone(), ai_id.clone()));
    }
    let payload = ReplyPayload {
        kind: r#type,
        ai_id,
        ai_name,
        task_id,
        text,
        url,
    };
    let _ = app.emit("ai-reply", &payload);
    Ok(())
}

/// 打开/聚焦独立设置窗口。
/// 与主窗口共用同一份 SPA 产物，通过 `#settings` 路由渲染 SettingsApp。
#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    const LABEL: &str = "settings";
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.set_focus();
        return Ok(());
    }
    let builder =
        WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html#settings".into()))
            .title("AskAll 齐问 · 设置")
            .inner_size(760.0, 640.0)
            .min_inner_size(560.0, 480.0);
    // 标题栏样式仅 macOS 支持（Overlay 无边框），其它平台走默认标题栏
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 26.0));
    let win = builder.build().map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok(())
}

// ---------- 入口 ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            current_task: Mutex::new(None),
            ai_current_urls: Mutex::new(HashMap::new()),
            done_replies: Mutex::new(HashSet::new()),
        })
        .setup(|app| {
            // 注册系统级「划词提问」全局快捷键（失败不阻断启动，仅告警）。
            if let Err(e) = os_ask::setup(app.handle()) {
                log::warn!("[askall] 注册全局划词快捷键失败：{e}");
            }
            // macOS：注册系统右键「服务」菜单（best-effort，非 macOS 为空操作）。
            os_ask::setup_os_services(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ask_ai,
            ask_ai_followup,
            get_task,
            open_ai_webview,
            show_ai_chat,
            layout_ai_grid,
            open_settings_window,
            emit_ai_reply,
            os_ask::request_accessibility_permission,
            os_ask::accessibility_permission_granted,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AskAll desktop");
}
