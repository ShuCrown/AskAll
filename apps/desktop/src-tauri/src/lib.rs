//! AskAll 桌面端 Tauri 后端。
//!
//! 与前端 `apps/desktop/src/platform-tauri.ts` 的契约一一对应：
//!   - ask_ai(text, configs, mode)          新会话提问
//!   - ask_ai_followup(text, configs, mode) 追问（复用已打开的 AI 子窗口）
//!   - get_task() -> AskTask | null         当前任务
//!   - open_ai_webview(url)                 手动打开 AI 站点（内嵌子窗口）
//!   - show_ai_chat(aiId, url, name)        展示/复用 AI 问答页子窗口（chat tabs 入口）
//!   - open_settings_window()               打开/聚焦独立设置窗口（#settings 路由）
//!   - emit_ai_reply(type, aiId, aiName, taskId, text)  子窗口回传回复（IPC）
//!
//! 「ask 编排器」：
//!   - mode = "browser"  → opener 在系统浏览器打开（无法自动发送，回传提示）
//!   - mode = "embedded" → 创建/复用子 WebviewWindow（默认隐藏，不弹窗不抢焦点），
//!     注入 auto_send::build_payload 产出的 JS（自动填充+发送+回复轮询），
//!     JS 通过 __TAURI_INTERNALS__.invoke 回调 emit_ai_reply，再由本端
//!     emit('ai-reply', payload) 推给主窗口；回答内容统一在主窗口问答面板展示，
//!     需要查看 AI 原始问答页时经 show_ai_chat 唤起对应子窗口（弹窗显示）。

mod auto_send;
mod os_ask;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
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
}

// ---------- 应用状态 ----------

struct AppState {
    current_task: Mutex<Option<AskTask>>,
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

/// 创建或复用 AI 子窗口。
/// `navigate=true` 表示新会话，跳转到配置 URL；`false` 表示追问，保持当前页面。
/// `show=false` 表示后台模式：新窗口隐藏创建、已存在窗口不抢焦点——
/// 提问默认不再弹窗，回答内容统一回流主窗口问答面板，由 `show_ai_chat` 按需唤起。
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
        .title(title)
        .inner_size(520.0, 720.0)
        .min_inner_size(360.0, 480.0)
        .visible(show)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(win)
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
            },
        );
        return;
    }

    // embedded：创建/复用子窗口（后台模式，不弹窗）。追问时复用且不导航。
    let label = format!("ai-{}", cfg.id);
    let webview =
        match get_or_create_ai_window(&app, &label, &cfg.name, &cfg.url, !follow_up, false) {
            Ok(w) => w,
            Err(e) => {
                let _ = app.emit(
                    "ai-reply",
                    ReplyPayload {
                        kind: "AI_REPLY_DONE".into(),
                        ai_id: cfg.id.clone(),
                        ai_name: cfg.name.clone(),
                        task_id,
                        text: Some(format!("打开内嵌窗口失败：{e}")),
                    },
                );
                return;
            }
        };

    let _ = app.emit(
        "ai-reply",
        ReplyPayload {
            kind: "AI_SENDING".into(),
            ai_id: cfg.id.clone(),
            ai_name: cfg.name.clone(),
            task_id: task_id.clone(),
            text: None,
        },
    );

    let selectors = cfg.selectors.clone().unwrap_or_default();
    let js = auto_send::build_payload(&text, &cfg.id, &cfg.name, &task_id, &selectors);

    // 新会话：等页面加载稳定再注入；追问：页面已就绪，稍等即可。
    let delay = if follow_up { 1 } else { 2 };
    tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
    if let Err(e) = webview.eval(&js) {
        log::warn!("[askall] 注入脚本到 {} 失败: {}", cfg.id, e);
    }
}

/// ask / followup 的公共编排逻辑。
async fn dispatch_ask(
    app: tauri::AppHandle,
    state: &AppState,
    text: String,
    configs: Vec<AiConfig>,
    mode: String,
    follow_up: bool,
) -> Result<(), String> {
    if configs.is_empty() {
        return Err("未选择任何 AI".into());
    }

    // 会话归属：追问复用当前任务的 conversationId（延续同一话题）；
    // 新提问总是开启新会话（否则「新话题」会被追加进上一个话题）。
    let conversation_id = if follow_up {
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
    dispatch_ask(app, state.inner(), text, configs, mode, false).await
}

#[tauri::command]
async fn ask_ai_followup(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    text: String,
    configs: Vec<AiConfig>,
    mode: String,
) -> Result<(), String> {
    dispatch_ask(app, state.inner(), text, configs, mode, true).await
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
        .title("AskAll AI")
        .inner_size(520.0, 720.0)
        .min_inner_size(360.0, 480.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 展示某个 AI 的问答页窗口（顶部 chat tabs / 回答卡片「打开源会话」入口）。
/// 复用提问时创建的隐藏 `ai-{aiId}` 子窗口（保留当前聊天状态），
/// 不存在（如重启后回看历史会话）则以该会话 URL 新建可见窗口。
#[tauri::command]
async fn show_ai_chat(
    app: tauri::AppHandle,
    ai_id: String,
    url: String,
    name: Option<String>,
) -> Result<(), String> {
    let label = format!("ai-{}", ai_id);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let title = name.unwrap_or_else(|| "AskAll AI".into());
    get_or_create_ai_window(&app, &label, &title, &url, true, true).map(|_| ())
}

/// 子窗口通过 __TAURI_INTERNALS__.invoke 回传回复；本命令转发为主窗口事件。
#[tauri::command]
async fn emit_ai_reply(
    app: tauri::AppHandle,
    r#type: String,
    ai_id: String,
    ai_name: String,
    task_id: String,
    text: Option<String>,
) -> Result<(), String> {
    let payload = ReplyPayload {
        kind: r#type,
        ai_id,
        ai_name,
        task_id,
        text,
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
    let win = WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::App("index.html#settings".into()),
    )
    .title("AskAll 齐问 · 设置")
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .hidden_title(true)
    .traffic_light_position(tauri::LogicalPosition::new(16.0, 26.0))
    .inner_size(760.0, 640.0)
    .min_inner_size(560.0, 480.0)
    .build()
    .map_err(|e| e.to_string())?;
    let _ = win.set_focus();
    Ok(())
}

// ---------- 入口 ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new().build(),
        )
        .manage(AppState {
            current_task: Mutex::new(None),
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
            open_settings_window,
            emit_ai_reply,
            os_ask::request_accessibility_permission,
            os_ask::accessibility_permission_granted,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AskAll desktop");
}
