//! 系统级「划词提问」：全局快捷键 + 选中文字捕获 + 剪贴板兜底 +（macOS）系统右键「服务」。
//!
//! 用户在任意 App（如 WPS 桌面版）中选中文字后，按下全局快捷键（macOS 默认
//! `Cmd+Opt+Q`，其它平台 `Ctrl+Alt+Q`），即把选中文字发给桌面端自动提问。
//!
//! macOS 上还注册了系统 Services（任意 App 选中文字 → 右键「服务 → 在 AskAll 中提问」），
//! 与全局快捷键共用同一套「捕获 → 聚焦主窗口 → emit 事件」流程。
//!
//! 捕获策略：
//!   1. 优先读取当前选中文字（macOS 走 Accessibility AXSelectedText，Windows
//!      走模拟 Ctrl+C 后读剪贴板）——见 `get-selected-text` crate；
//!   2. 若为空，回退读取系统剪贴板最近内容；
//!   3. 聚焦主窗口并 emit `askall-external-ask` 事件，由前端预填问题并发送。

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

/// 推给主窗口的「外部提问」载荷（与前端契约一致）。
#[derive(Clone, serde::Serialize)]
pub struct ExternalAskPayload {
    pub text: String,
    /// 来源：`selection`（选中文字）/ `clipboard`（剪贴板兜底）/ `none`（无内容）
    pub source: String,
}

/// 捕获当前内容：优先选中文字，失败回退剪贴板。
fn capture_selected_text() -> (String, String) {
    // 1) 选中文字
    match get_selected_text::get_selected_text() {
        Ok(t) if !t.trim().is_empty() => (t, "selection".into()),
        _ => {
            // 2) 剪贴板兜底
            let cb = arboard::Clipboard::new()
                .and_then(|mut c| c.get_text())
                .unwrap_or_default();
            if !cb.trim().is_empty() {
                (cb, "clipboard".into())
            } else {
                (String::new(), "none".into())
            }
        }
    }
}

/// 把主窗口拉到前台并 emit「外部提问」事件（全局快捷键与 macOS 服务共用）。
fn deliver(app: &AppHandle, text: String, source: &str) {
    // 把主窗口拉到前台，便于用户看到预填的问题与回答进度。
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.emit(
        "askall-external-ask",
        ExternalAskPayload {
            text,
            source: source.into(),
        },
    );
}

fn handle_shortcut(app: &AppHandle) {
    let (text, source) = capture_selected_text();
    deliver(app, text, &source);
}

/// 注册全局快捷键 + 事件 handler。在 `setup` 中调用。
pub fn setup(app: &AppHandle) -> Result<(), String> {
    let shortcut = {
        // macOS 用 Cmd+Opt+Q；其它平台用 Ctrl+Alt+Q，避免与系统快捷键冲突。
        // 注意：Ctrl+Shift+Q 是 macOS 的「注销」快捷键，需避开。
        #[cfg(target_os = "macos")]
        {
            Shortcut::new(Some(Modifiers::META | Modifiers::ALT), Code::KeyQ)
        }
        #[cfg(not(target_os = "macos"))]
        {
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyQ)
        }
    };

    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                handle_shortcut(app);
            }
        })
        .map_err(|e| format!("注册全局划词快捷键失败：{e}"))
}

/// 请求 macOS「辅助功能（无障碍）」权限（仅 macOS 需要，用于读取其它 App 的选中文字）。
#[tauri::command]
pub fn request_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_accessibility_client::accessibility::application_is_trusted_with_prompt()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// 查询当前是否已获得「无障碍」权限（macOS）；非 macOS 恒为 true。
#[tauri::command]
pub fn accessibility_permission_granted() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_accessibility_client::accessibility::application_is_trusted()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

// ---------------------------------------------------------------------------
// macOS 系统「服务」集成（任意 App 选中文字 → 右键「服务 → 在 AskAll 中提问」）
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
mod macos {
    use std::sync::OnceLock;

    use objc2::rc::Retained;
    use objc2::{define_class, msg_send, MainThreadOnly};
    use objc2_app_kit::{NSApplication, NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::{MainThreadMarker, NSObject, NSString};
    // Manager / Emitter 仅在 define_class! 宏生成的方法体中使用，需保持在作用域内。
    #[allow(unused_imports)]
    use tauri::{AppHandle, Emitter, Manager};

    /// 全局持有一个 AppHandle，供服务回调（主线程）拉前台 + emit 事件。
    static APP: OnceLock<AppHandle> = OnceLock::new();

    // 服务回调：把 `pboard` 中的选中文字交给主流程。
    define_class!(
        // SAFETY: NSObject 没有任何子类化要求；本类不实现 Drop。
        #[unsafe(super = NSObject)]
        #[thread_kind = MainThreadOnly]
        struct AskAllServiceProvider;

        // Inherent methods (non-protocol) go inside the macro as a plain `impl`
        #[allow(unused_imports)]
        impl AskAllServiceProvider {
            /// 对应 Info.plist 中 NSServices 的 `NSMessage`：
            /// `askAskAllQuestion:userData:error:`。
            #[unsafe(method(askAskAllQuestion:userData:error:))]
            fn ask_ask_all_question(
                &self,
                pboard: &NSPasteboard,
                _user_data: Option<&NSString>,
                _error: *mut NSString,
            ) {
                let text = unsafe { pboard.stringForType(NSPasteboardTypeString) }
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                if let Some(app) = APP.get() {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = app.emit(
                        "askall-external-ask",
                        super::ExternalAskPayload {
                            text,
                            source: "selection".into(),
                        },
                    );
                }
            }
        }
    );

    impl AskAllServiceProvider {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(());
            // SAFETY: `init` selector correct.
            let this: Retained<Self> = unsafe { msg_send![super(this), init] };
            this
        }
    }

    /// 注册 macOS「服务」。必须在主线程调用（Tauri 的 setup 即运行于主线程）。
    pub fn register_services(app: &AppHandle) {
        let _ = APP.set(app.clone());
        let Some(mtm) = MainThreadMarker::new() else {
            log::warn!("[askall] 注册 macOS「服务」需在主线程，当前线程非主线程，已跳过");
            return;
        };
        let provider = AskAllServiceProvider::new(mtm);
        // NSObject → AnyObject，作为 servicesProvider 传入。
        let obj: Retained<objc2::runtime::AnyObject> = provider.into_super().into_super();
        let shared = NSApplication::sharedApplication(mtm);
        // SAFETY: 传入的 provider 已保留，且在整个 App 生命周期内有效。
        unsafe { shared.setServicesProvider(Some(&obj)) };
        // 该 provider 需存活至 App 结束，故有意 leak。
        std::mem::forget(obj);
    }
}

/// 注册 macOS 系统「服务」。非 macOS 为空操作。在 `setup` 中调用。
pub fn setup_os_services(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::register_services(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}
