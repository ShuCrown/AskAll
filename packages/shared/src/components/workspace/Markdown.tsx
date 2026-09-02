/**
 * Markdown —— 回答文本的 Markdown 渲染（贴近 AI 原站点排版）。
 *
 * AI 站点的回答本身是 Markdown，原页面会渲染成标题 / 列表缩进 / 代码块 /
 * 引用 / 表格等层级排版；这里用 react-markdown + remark-gfm 做同样的渲染，
 * 让卡片里的展示尽量贴近原标签页。样式用现有 tailwind token 定制。
 *
 * 安全：react-markdown 默认不渲染原始 HTML（不启用 rehype-raw），
 * 抓取到的回答文本即使含 HTML 标签也只会按纯文本展示，无 XSS 风险。
 */
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';

const textOf = (children: unknown): string =>
  Array.isArray(children)
    ? children.map((c) => (c == null ? '' : String(c))).join('')
    : String(children ?? '');

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-1.5 mt-2.5 text-[15px] font-semibold leading-snug">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-2.5 text-sm font-semibold leading-snug">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-2 text-[13px] font-semibold leading-snug">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-2 text-xs font-semibold">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mb-1 mt-2 text-xs font-semibold">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mb-1 mt-2 text-xs font-semibold text-foreground/80">{children}</h6>
  ),
  p: ({ children }) => <p className="my-1.5">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-border/70 pl-3 text-foreground/80">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2.5 border-border/60" />,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline decoration-primary/40 underline-offset-2"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-foreground/60">{children}</del>,
  code: ({ className, children }) => {
    // 块级代码（``` 围栏）带 language- 前缀或在 pre 内；行内代码无语言标记
    const isBlock =
      /language-/.test(className ?? '') || textOf(children).includes('\n');
    if (isBlock) {
      return (
        <code className={cn('block text-[11px] leading-relaxed', className)}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground/90">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-muted/70 p-2.5 text-[11px] leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left text-[11px] font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 align-top">{children}</td>
  ),
};

export default function Markdown({
  text,
  clamped = false,
}: {
  text: string;
  /** 折叠：仅显示前 8 行（配合「展开全文」） */
  clamped?: boolean;
}) {
  return (
    <div
      className={cn(
        'markdown-body min-w-0 text-xs leading-relaxed text-foreground/90',
        clamped && 'line-clamp-[8] overflow-hidden',
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
