# AskAll 齐问

划词同时向多个 AI 提问的浏览器扩展。选中网页任意文字，一键向 DeepSeek、豆包、文心一言、通义千问、元宝等多个 AI 同时提问，自动填充发送、自动记录历史，无需在多个标签页间手动切换。

* **浏览器扩展**：基于 [WXT](https://wxt.dev) + React，支持 Chrome / Firefox（MV3）

采用 **pnpm monorepo** 组织：共享 UI / 逻辑置于 `packages/shared`，扩展实现 `PlatformApi` 适配器注入，组件层不直接依赖浏览器 API。

> **历史说明**：项目此前含一套 Tauri 桌面端（`apps/desktop`），因其「内嵌网页」方案与插件难以同步、维护成本高，已整体移除，仅保留浏览器扩展一条主线。

## 功能特性

* **划词提问**：选中网页文字后，通过右键菜单或快捷键（默认 `Alt+Q`）唤起浮动面板

* **多 AI 同时提问**：内置 DeepSeek、豆包、文心一言、通义千问、元宝，可自由勾选，也支持自定义 AI 平台

* **自动填充发送**：在 AI 页面自动填入问题并发送，无需手动操作（可关闭，改为手动发送）

* **浮动面板**：

  * AI 多选、一键提问、追加追问（延续同一会话）

  * 面板可固定 / 最小化为悬浮球、可拖拽移动与缩放

  * 发送状态实时展示（打开中 / 发送中 / 已完成）

* **历史记录**：自动记录每次提问与回答链接，按会话分组展示，支持多轮追问回溯；点击链接可跳转回对应会话

* **回答完成通知**：AI 回答完成后弹系统通知提醒（可开关）

* **打开方式可选**：标签页或独立窗口（弹窗模式）

* **可配置快捷键**：默认 `Alt+Q`，可在设置中修改

## 安装使用

```bash
pnpm install            # 安装全部 workspace 依赖
```

```bash
pnpm --filter @askall/extension dev       # 开发模式（自动打开浏览器加载扩展）
pnpm --filter @askall/extension build     # 构建 Chrome
pnpm --filter @askall/extension build:firefox
pnpm --filter @askall/extension zip       # 打包 zip
```

选中网页文字 → 右键菜单「AskAll 齐问：打开提问面板」，或按 `Alt+Q` 提问。

### 打包发布

发布版本号与更新说明由 `version.json` 统一维护。推送至 `main` 分支（任意文件改动）即自动构建打包并创建 **draft 草稿 Release**（不直接发布）；确认无误后，在 GitHub Releases 页面手动发布即可正式上线。也可在 Actions 页面手动触发构建。

**Release 产物为浏览器扩展（Chrome / Firefox zip）**。

## 项目结构

```
packages/
  shared/                       # 扩展共用的 UI / 逻辑
    src/
      components/               # PageWorkspace / Workspace / AiConfigPanel / ChatView + ui 原子组件
      automation/               # 引擎：定位/填充/提交/观察策略 + 各 AI 平台 recipe
      lib/platform/             # PlatformApi 抽象层：types + 注册中心（getPlatform/setPlatform）
      store/                    # askStore（zustand）：会话/实时任务/历史中枢
      utils/                    # aiConfig / autoSend / history / task / attachment
apps/
  extension/                    # 浏览器扩展（WXT）
    entrypoints/                # background / content / options / workspace
    src/platform.ts             # 扩展端 PlatformApi 实现（browser.* + WXT storage）
pnpm-workspace.yaml / tsconfig.base.json
```

## 技术要点

* **自动发送**：通过 `chrome.scripting` 在 MAIN world 注入脚本，结合多级选择器候选与语义兜底，适配各 AI 站点频繁变化的 DOM；内置重试机制与超时保护

* **会话跟踪**：后台记录「AI 标签页 → 历史条目」映射，监听同域 URL 跳转并在稳定后回写真实会话地址，保证历史链接可回跳

* **并发发送**：各 AI 标签页互不等待，实现真正并行提问

* **注入安全**：内容脚本中引用的 public 资源（图标 / AI 品牌图）均在 `web_accessible_resources` 白名单中声明

## 版本历史

* **v1.0.4**（2026-09-02）：支持附件上传（图片/PDF/文档，随问题注入 AI 站点）；新增默认 AI 平台「元宝」；聊天卡片布局（田字格/单列）与 AI 顺序可配置；回答卡片新增「同步」按钮；历史存储解除容量上限、采用分级保留。移除 Tauri 桌面端代码，仅保留浏览器扩展主线。

* **v1.0.3**（2026-09-01）：浮动面板标题栏新增最大化/还原、搜索历史、新话题入口，按钮分组优化；右键菜单/划词注入的问题改为仅预填、由用户确认发送；修复同一问题重复渲染两条气泡。

* **v1.0.0**（2026-08-14）：正式发布。划词多 AI 提问、自动填充发送、历史记录与会话回跳、回答完成通知；优化历史日期中文格式、设置页全屏布局；修复 logo 加载被拦截、历史链接不匹配会话等问题。详见 `version.json`。

