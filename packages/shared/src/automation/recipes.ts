import type { Recipe, StepDef } from './types';

/**
 * 内置 Recipe 配置（纯数据）。
 *
 * 站点改版时改的是这里，而不是引擎代码；配合远程热更可以做到不发版修复。
 * 每个策略链都遵循同一条原则：先试最具体的（配置选择器），失败后逐级退到
 * 最通用的（几何 / 状态翻转 / 键盘），任何一层命中都不会走到下一层。
 */

const OBSERVE_TIMEOUT = 130_000;

/** 通用策略链：不含任何站点专属选择器，任何新站点开箱即用 */
export function genericSteps(
  inputSelectors: string[] = [],
  sendSelectors: string[] = [],
  replySelectors: string[] = [],
  attachSelectors: string[] = [],
): StepDef[] {
  return [
    {
      id: 'locate',
      timeoutMs: 20_000,
      strategies: [
        ...(inputSelectors.length
          ? [{ kind: 'locate:selector', params: { inputSelectors } }]
          : []),
        { kind: 'locate:editable-bottom' },
        { kind: 'locate:focused' },
      ],
    },
    {
      id: 'fill',
      timeoutMs: 12_000,
      strategies: [
        { kind: 'fill:auto' },
        { kind: 'fill:paste' },
        { kind: 'fill:insert-text' },
        { kind: 'fill:value-setter' },
      ],
    },
    {
      id: 'attach',
      // 覆盖最坏情况：paste 4s + trigger 3×(3.5s 轮询+5s 反馈)
      // + file-input 多候选×5s + drop 6s
      timeoutMs: 60_000,
      strategies: [
        // 配置了上传入口选择器的站点，优先走最确定性的 file-input 通道
        ...(attachSelectors.length
          ? [{ kind: 'attach:file-input', params: { attachSelectors } }]
          : []),
        { kind: 'attach:paste' },
        { kind: 'attach:trigger-file-input' },
        { kind: 'attach:file-input' },
        { kind: 'attach:drop' },
      ],
    },
    {
      id: 'submit',
      // 按钮策略内部轮询等待渲染/解禁（flip/proximate 各 20s、selector 45s，
      // 附件上传/解析期间发送按钮禁用可达几十秒），键盘策略另需 ~10s
      timeoutMs: 90_000,
      strategies: [
        { kind: 'submit:enter' },
        { kind: 'submit:enabled-flip' },
        { kind: 'submit:proximate' },
        ...(sendSelectors.length
          ? [{ kind: 'submit:selector', params: { sendSelectors } }]
          : []),
      ],
    },
    {
      id: 'confirm',
      timeoutMs: 8_000,
      optional: true,
      strategies: [{ kind: 'confirm:any' }],
    },
    {
      id: 'observe',
      timeoutMs: OBSERVE_TIMEOUT,
      strategies: [
        { kind: 'observe:diff' },
        ...(replySelectors.length
          ? [
              {
                kind: 'observe:selector',
                params: { replySelectors, timeoutMs: OBSERVE_TIMEOUT },
              },
            ]
          : []),
        { kind: 'observe:text' },
      ],
    },
  ];
}

/**
 * 把 submit 步骤里的 submit:selector 策略提到链首。
 *
 * 两阶段原则（豆包实测教训）：平台专属发送按钮（candidates[0]）只在输入框
 * 有内容后才渲染，等待它可用再点是最可靠的路径；而排在前面的键盘策略会
 * 多次派发回车、邻域策略可能误点侧栏/工具栏按钮，都会带来副作用。
 * 选择器策略内部自带轮询等待（10s），超时后照常回退到其余通用策略。
 */
function reorderSubmitSelectorFirst(steps: StepDef[]): StepDef[] {
  return steps.map((step) => {
    if (step.id !== 'submit') return step;
    const selector = step.strategies.filter(
      (s) => s.kind === 'submit:selector',
    );
    if (selector.length === 0) return step;
    const rest = step.strategies.filter((s) => s.kind !== 'submit:selector');
    return { ...step, strategies: [...selector, ...rest] };
  });
}

export const DEFAULT_RECIPES: Recipe[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    version: 1,
    url: 'https://chat.deepseek.com/',
    steps: genericSteps(
      ['textarea', 'div[contenteditable="true"]'],
      [
        'div[role="button"][aria-label*="发送"]',
        'div[role="button"][aria-label*="Send"]',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
      ],
      ['.ds-markdown', '[class*="markdown"]'],
    ),
  },
  {
    id: 'doubao',
    name: '豆包',
    version: 5,
    url: 'https://www.doubao.com/chat/',
    steps: reorderSubmitSelectorFirst(
      genericSteps(
        [
          '.tiptap.ProseMirror',
          'div[contenteditable="true"]',
          'div[role="textbox"]',
          'textarea[placeholder]',
          'textarea',
        ],
        // 实测（2026-08）：#flow-end-msg-send 仍在，只是输入框为空时不渲染；
        // 填入后按钮出现。把它提到提交链最前（两阶段原则：先只等平台专属
        // 按钮渲染可用再点，超时才回退键盘/翻转/邻域通用策略），避免
        // 键盘策略的多次回车和邻域策略误点侧栏/工具栏按钮带来副作用。
        [
          '#flow-end-msg-send',
          'div[role="button"][aria-label*="发送"]',
          'button[aria-label*="发送"]',
          'button[class*="send"]',
        ],
        ['[class*="markdown"]', '[class*="message-content"]'],
      ),
    ),
  },
  {
    id: 'wenxin',
    name: '文心一言',
    version: 2,
    url: 'https://wenxin.baidu.com/',
    steps: genericSteps(
      [
        'textarea#chat-textarea',
        'textarea.ci-textarea',
        'textarea[placeholder]',
        'textarea',
        'div[contenteditable="true"]',
      ],
      [
        'button.ci-input-send-btn',
        'button[aria-label*="发送"]',
        'button[aria-label*="Send"]',
        'span[class*="submit-button"]',
      ],
      ['[class*="markdown"]'],
    ),
  },
  {
    id: 'qwen',
    name: '通义千问',
    version: 1,
    url: 'https://www.qianwen.com/',
    steps: genericSteps(
      [
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'div[role="textbox"]',
        'textarea',
      ],
      ['button[aria-label="发送消息"]', 'button[aria-label*="发送"]'],
      ['[class*="markdown"]'],
    ),
  },
];

/** 按 AI id 取内置 Recipe */
export function getRecipe(aiId: string): Recipe | undefined {
  return DEFAULT_RECIPES.find((r) => r.id === aiId);
}

/**
 * 为没有内置 Recipe 的站点（用户自定义 AI）生成一份通用配置。
 * 全部使用不依赖类名的通用策略，保证新站点接进来就能跑。
 */
export function buildGenericRecipe(
  aiId: string,
  name: string,
  url: string,
): Recipe {
  return { id: aiId, name, version: 0, url, steps: genericSteps() };
}

/**
 * 把站点配置的上传入口选择器（attachSelectors）注入 attach 步骤：
 * 以 selector 驱动的 attach:file-input 提到链首（最确定性通道），其余保持通用链。
 * 内置 Recipe 的步骤是静态预构建的，无法在构建期拿到用户配置，故在此统一注入。
 */
function withAttachSelectors(
  steps: StepDef[],
  attachSelectors: string[],
): StepDef[] {
  if (!attachSelectors.length) return steps;
  return steps.map((s) => {
    if (s.id !== 'attach') return s;
    return {
      ...s,
      strategies: [
        { kind: 'attach:file-input', params: { attachSelectors } },
        ...s.strategies.filter(
          (x) => !(x.kind === 'attach:file-input' && x.params?.attachSelectors),
        ),
      ],
    };
  });
}

/** 取站点 Recipe：有内置用内置，否则生成通用版 */
export function resolveRecipe(
  aiId: string,
  name: string,
  url: string,
  attachSelectors: string[] = [],
): Recipe {
  const recipe = getRecipe(aiId) ?? buildGenericRecipe(aiId, name, url);
  const steps = withAttachSelectors(recipe.steps, attachSelectors);
  return { ...recipe, steps };
}
