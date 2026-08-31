/// <reference types="vite/client" />

// 以 ?inline 导入的 CSS（Vite 返回编译后的字符串），用于注入 shadow root
declare module '*.css?inline' {
  const css: string;
  export default css;
}
