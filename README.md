# AskAll 齐问

划词同时向多个 AI 提问的工具，提供 **浏览器扩展** 与 **Tauri 桌面端** 两套入口，共用同一套 UI 与业务逻辑。选中网页任意文字（扩展）或在应用内输入（桌面端），一键向 DeepSeek、豆包、文心一言、通义千问等多个 AI 同时提问，自动填充发送、自动记录历史，无需在多个标签页间手动切换。

> **入口状态**：**浏览器扩展**为当前主力入口（随 Release 自动打包发布）；**Tauri 桌面端**保留代码、暂不发布，详见文末「[桌面端状态说明](#桌面端状态说明)」。

* **浏览器扩展**：基于 [WXT](https://wxt.dev) + React，支持 Chrome / Firefox（MV3）

* **Tauri 桌面端**：基于 [Tauri 2](https://tauri.app) + React + Vite，跨平台桌面应用，AI 站点可内嵌于应用子窗口或交由系统浏览器打开

采用 **pnpm monorepo** 组织：共享 UI / 逻辑置于 `packages/shared`，两端各自实现 `PlatformApi` 适配器注入，组件层不直接依赖任何平台 API。

## 功能特性

* **划词提问**（扩展）：选中网页文字后，通过右键菜单或快捷键（默认 `Alt+Q`）唤起浮动面板

* **应用内提问**（桌面端）：桌面端默认落在「提问」Tab，输入问题即可同时向多个 AI 发送

* **多 AI 同时提问**：内置 DeepSeek、豆包、文心一言、通义千问，可自由勾选，也支持自定义 AI 平台

* **自动填充发送**：在 AI 页面自动填入问题并发送，无需手动操作（可关闭，改为手动发送）

* **双模式打开**（桌面端）：AI 站点可「内嵌」于应用子窗口（child webview，自动发送 + 回复捕获），或「浏览器」交由系统浏览器打开；在设置中切换，实时生效

* **浮动面板**（扩展）：

  * AI 多选、一键提问、追加追问（延续同一会话）

  * 面板可固定 / 最小化为悬浮球、可拖拽移动与八向缩放

  * 发送状态实时展示（打开中 / 发送中 / 已完成）

* **历史记录**：自动记录每次提问与回答链接，按会话分组展示，支持多轮追问回溯；点击链接可跳转回对应会话

* **回答完成通知**：AI 回答完成后弹系统通知提醒（可开关）

* **打开方式可选**（扩展）：标签页或独立窗口（弹窗模式）

* **可配置快捷键**（扩展）：默认 `Alt+Q`，可在设置中修改

## 安装使用

```bash
pnpm install            # 安装全部 workspace 依赖
```

### 浏览器扩展

```bash
pnpm --filter @askall/extension dev       # 开发模式（自动打开浏览器加载扩展）
pnpm --filter @askall/extension build     # 构建 Chrome
pnpm --filter @askall/extension build:firefox
pnpm --filter @askall/extension zip       # 打包 zip
```

选中网页文字 → 右键菜单「AskAll 齐问：打开提问面板」，或按 `Alt+Q` 提问。

### Tauri 桌面端

> **⚠️ 维护状态**：桌面端当前**保留代码但暂不发布 / 不参与 CI 自动打包**。
> 原因是桌面端把 AI 站点以「内嵌网页」方式承载，与插件（浏览器标签页）在
> 自动化发送、站点改版适配、附件上传等行为上**不同步、维护成本高**；代码先
> 保留，是否彻底移除待后续评估（详见下方「桌面端状态说明」）。

```bash
pnpm --filter @askall/desktop tauri:dev    # 开发模式（启动 Vite + Tauri 窗口）
pnpm --filter @askall/desktop tauri:build  # 构建桌面安装包
```

> **Linux 构建依赖**：需先安装系统库（详见 [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/)）：
>
> ```bash
> sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libglib2.0-dev \
>   libssl-dev libxdo-dev librsvg2-dev libayatana-appindicator3-dev build-essential
> ```

桌面端默认落在「提问」Tab，输入问题、勾选 AI、点击发送（⌘/Ctrl+Enter）即可。在「AI 配置」中切换「内嵌 / 浏览器」打开方式。

### 打包发布（扩展）

发布版本号与更新说明由 `version.json` 统一维护。推送至 `main` 分支（任意文件改动）即自动构建打包并创建 **draft 草稿 Release**（不直接发布）；确认无误后，在 GitHub Releases 页面手动发布即可正式上线。也可在 Actions 页面手动触发构建。

**当前 Release 仅包含浏览器扩展产物（Chrome / Firefox zip）**；桌面端已从 CI 打包流程中移除（原因见下）。

## 桌面端状态说明

* **当前策略**：`apps/desktop`（Tauri 桌面端）代码保留在仓库中，但**不参与 GitHub Actions 自动打包**，`.github/workflows/release.yml` 只构建浏览器扩展。

* **原因**：桌面端原方案把各 AI 聊天页「内嵌」到应用窗口（child webview / 独立窗口）以复用插件的自动发送引擎，但内嵌网页与真实浏览器存在 UA、渲染、焦点、后台节流等差异，站点改版时需要两端分别适配，**与插件难以同步**；实际使用中该路径易出问题。

* **后续**：是否彻底移除 `apps/desktop`（含 Tauri Rust 后端、`@askall/desktop` 子包、桌面端 `PlatformApi` 实现）待评估。移除前保留现状，不影响插件开发与发布。

## 项目结构

```
packages/
  shared/                       # 扩展 + 桌面端 共用 UI / 逻辑
    src/
      components/                # App / AskPanel / AiConfigPanel / HistoryPanel / FloatingPanel + ui 原子组件
      lib/platform/             # PlatformApi 抽象层：types + 注册中心（getPlatform/setPlatform）
      utils/                    # aiConfig / autoSend / history / task
apps/
  extension/                    # 浏览器扩展（WXT）
    entrypoints/                # background / content / popup / options
    src/platform.ts             # 扩展端 PlatformApi 实现（browser.* + WXT storage）
  desktop/                      # Tauri 桌面端
    src/
      main.tsx                  # SPA 入口：initTauriPlatform() + 渲染共享 <App>
      platform-tauri.ts         # 桌面端 PlatformApi 实现（invoke + listen + opener + localStorage）
      style.css                 # tailwind 主题 token（与扩展一致）
    src-tauri/                  # Rust 后端
      src/
        lib.rs                  # ask 编排器：child webview + JS 注入 + ai-reply 事件
        auto_send.rs            # 注入脚本模板（autoSend 的页面上下文版本）
      capabilities/             # 主窗口 + AI 子窗口（跨域）权限
      tauri.conf.json / Cargo.toml / build.rs
      icons/                    # tauri icon 生成的全套图标
pnpm-workspace.yaml / tsconfig.base.json
```

## 技术要点

* **自动发送**：通过 `chrome.scripting` 在 MAIN world 注入脚本，结合多级选择器候选与语义兜底，适配各 AI 站点频繁变化的 DOM；内置重试机制与超时保护

* **会话跟踪**：后台记录「AI 标签页 → 历史条目」映射，监听同域 URL 跳转并在稳定后回写真实会话地址，保证历史链接可回跳

* **并发发送**：各 AI 标签页互不等待，实现真正并行提问

* **注入安全**：内容脚本中引用的 public 资源（图标 / AI 品牌图）均在 `web_accessible_resources` 白名单中声明

## 版本历史

* **v1.0.0**（2026-08-14）：正式发布。划词多 AI 提问、自动填充发送、历史记录与会话回跳、回答完成通知；优化历史日期中文格式、设置页全屏布局；修复 logo 加载被拦截、历史链接不匹配会话等问题。详见 `version.json`。

