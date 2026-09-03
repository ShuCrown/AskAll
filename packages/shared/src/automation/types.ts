/**
 * 自动化内核类型定义。
 *
 * 这里只放「纯类型」——它们会在编译期被擦除，因此可以被引擎（注入到页面
 * MAIN world 的自包含函数）安全引用。任何带运行时值的东西都不能出现在本文件，
 * 否则注入脚本会因找不到外部标识符而报错。
 */

/**
 * 页面内执行的步骤。
 *
 * 完整流程是七步：打开 → 就绪 → 定位 → 填入 → 提交 → 确认 → 观察 → 回写。
 * 其中「打开 / 就绪 / 回写」在 background 侧完成（与页面 DOM 无关，天然稳定），
 * 这里只定义需要在页面上下文执行、因而容易受改版影响的五步。
 */
export type StepId =
  | 'locate'
  | 'fill'
  | 'attach'
  | 'submit'
  | 'confirm'
  | 'observe';

/**
 * 策略标识。命名规则 `<步骤>:<实现>`，引擎据此分发到具体实现。
 *
 * 设计原则：越靠前的策略依赖的页面特征越「物理」——可编辑性、几何位置、
 * 状态翻转这类由产品形态决定的特征，而不是类名、id、文案这些随时会改的东西。
 */
export type StrategyKind =
  // 定位输入框
  | 'locate:editable-bottom'
  | 'locate:selector'
  | 'locate:focused'
  // 填入问题
  | 'fill:auto'
  | 'fill:paste'
  | 'fill:insert-text'
  | 'fill:value-setter'
  // 附加文件（仅当本次提问携带附件时执行）
  | 'attach:paste'
  | 'attach:trigger-file-input'
  | 'attach:file-input'
  | 'attach:drop'
  // 提交发送
  | 'submit:enter'
  | 'submit:enabled-flip'
  | 'submit:selector'
  // 确认已发送
  | 'confirm:any'
  // 观察回答
  | 'observe:diff'
  | 'observe:selector'
  | 'observe:text';

/** 定位步骤参数 */
export interface LocateParams {
  /** 输入框候选选择器，按顺序尝试 */
  inputSelectors?: string[];
}

/** 提交步骤参数 */
export interface SubmitParams {
  /** 发送按钮候选选择器，按顺序尝试 */
  sendSelectors?: string[];
  /** 提交用的组合键，默认 Enter */
  combo?: 'Enter' | 'Ctrl+Enter' | 'Meta+Enter';
}

/** 附加文件步骤参数 */
export interface AttachParams {
  /** 上传入口候选选择器（纸夹按钮 / input[type=file] / 拖放区），按顺序尝试 */
  attachSelectors?: string[];
  /** 附加后等待预览反馈的时长，默认 8000ms */
  attachWaitMs?: number;
}

/** 观察步骤参数 */
export interface ObserveParams {
  /** 回答区候选选择器（兜底策略使用） */
  replySelectors?: string[];
  /** 回答文本稳定多久视为完成，默认 2500ms */
  stableMs?: number;
  /** 整体超时，默认 120000ms */
  timeoutMs?: number;
}

export type StrategyParams = LocateParams & SubmitParams & ObserveParams & AttachParams;

/**
 * 附件载荷（UI → background → 引擎注入参数）。
 * dataUrl 为 `data:<mime>;base64,...`，只在内存链路流转，绝不写入历史存储。
 */
export interface AttachmentPayload {
  name: string;
  mime: string;
  size: number;
  dataUrl: string;
}

export interface StrategyDef {
  kind: StrategyKind | string;
  params?: Partial<StrategyParams>;
  /** 单策略超时，缺省用步骤超时 */
  timeoutMs?: number;
}

export interface StepDef {
  id: StepId;
  /** 策略降级链：按数组顺序尝试，首个成功者生效 */
  strategies: StrategyDef[];
  /** 步骤超时，缺省 15000ms */
  timeoutMs?: number;
  /** 可选步骤：失败不阻断后续流程（如 confirm） */
  optional?: boolean;
}

/**
 * 一个 AI 站点的自动化流程定义。
 *
 * 这是纯数据（可 JSON 序列化），因此可以内置、可以远程热更、也可以由用户录制生成。
 * 站点改版时改的是这份数据，而不是引擎代码。
 */
export interface Recipe {
  /** 对应 AiConfig.id */
  id: string;
  name: string;
  /** 配置版本，远程热更时用于比较新旧 */
  version: number;
  /** 打开地址，可含 {query} 占位符 */
  url: string;
  steps: StepDef[];
  /**
   * 回答文本剥离标记（可选）：站点的回答里可能混入「思考过程 / 参考资料」等
   * 非正文章节。命中「以标记开头的行」即视为章节标题，该行与其后的章节内容
   * （直到下一个空行 / 下一个标记行 / 文本结尾）在回传前一并剥离。
   * 纯数据，站点改版只改这份配置。
   */
  stripSections?: string[];
}

/** 注入脚本的运行时上下文标识 */
export interface RunMeta {
  aiName: string;
  aiId: string;
  taskId: string;
}

/**
 * 单步执行结果上报。由页面脚本回传 background，用于自愈记忆与失败诊断。
 */
export interface StepReport {
  recipeId: string;
  stepId: StepId;
  /** 实际生效的策略 */
  kind: string;
  ok: boolean;
  /** 失败原因（仅 ok=false） */
  reason?: string;
  /** 失败瞬间的 DOM 摘要，用于事后修复 Recipe */
  snapshot?: DomSnapshot;
}

/** 失败时采集的页面特征摘要（不含任何用户内容，只含结构信息） */
export interface DomSnapshot {
  href: string;
  /** 页面上可编辑元素的结构摘要 */
  editables: Array<{
    tag: string;
    id?: string;
    cls?: string;
    placeholder?: string;
    role?: string;
    rect: [number, number, number, number];
  }>;
  /** 输入框附近的按钮摘要 */
  buttons: Array<{
    tag: string;
    id?: string;
    cls?: string;
    ariaLabel?: string;
    disabled: boolean;
    rect: [number, number, number, number];
  }>;
}
