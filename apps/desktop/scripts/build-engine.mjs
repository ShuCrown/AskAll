/**
 * 把 @askall/shared 的自动化引擎（engine.ts）打包成单文件自包含 JS，
 * 输出到 src-tauri/assets/engine.js，供 Rust 侧 include_str! 后注入 AI 子 webview。
 *
 * engine.ts 只 import type（编译期擦除、无运行时依赖），esbuild 打成 IIFE，
 * 以全局名 AskAllEngine 暴露 runAutomation。桌面端与扩展端共用同一份引擎源码，
 * 站点改版只改 recipes.ts / engine.ts，桌面端随构建自动获得同样修复。
 */
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(here, '../../../packages/shared/src/automation/engine.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'AskAllEngine',
  outfile: path.join(here, '../src-tauri/assets/engine.js'),
  target: 'es2020',
  minify: false,
  logLevel: 'info',
});
