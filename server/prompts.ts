import {
  diffCharBudgetFromWindow,
  inferContextWindowTokens,
  type ExplainTask,
  type LearnDrillTargetContext,
  type LearnExistingRouteContext,
  type LearnRequestMode,
  type PartialAIProviderConfig,
  type ScopeType,
  type TargetLineInfo,
} from '../shared/types';
import { DEFAULT_LEARN_PROMPT } from '../shared/defaultLearnPrompt';

export interface PromptContext {
  scopeType?: ScopeType;
  targetLine?: TargetLineInfo;
  diff?: string;
  filePath?: string;
  commitMessage?: string;
  userPrompt?: string;
  task?: ExplainTask;
  learnRequestMode?: LearnRequestMode;
  existingBusinessRoutes?: LearnExistingRouteContext[];
  drillPath?: LearnDrillTargetContext[];
  config?: PartialAIProviderConfig;
  /** Deterministic code-graph digest, injected for learn tasks. */
  graphDigest?: string;
}

const REVIEW_FORMAT_GUIDE = `### 🔄 核心改动前后对比 (Before vs After)
- **改动前旧逻辑**：说明先前代码的行为与局限
- **改动后新逻辑**：说明本次改动后的实现与改变

### 🔬 关键代码实现深度拆解 (Implementation Mechanics)
深入剖析核心修改语句、状态迁移、数据流转与参数语义。

### 🌐 跨模块影响与下游调用 (Callers & Impact)
明确说明修改对外部依赖、调用方或工程配置的实际影响。`;

/**
 * Pseudocode / natural-language presets are formatting instructions, not
 * questions: they must become the system prompt verbatim so the model's output
 * shape stays parseable by `parseAiPseudocodeLines`.
 */
function isFormattingPreset(userPrompt: string, task?: ExplainTask): boolean {
  if (task === 'pseudocode' || task === 'natural_language') return true;
  return (
    userPrompt.includes('伪代码') ||
    userPrompt.includes('自然语言') ||
    userPrompt.includes('单行') ||
    userPrompt.includes('简短')
  );
}

function listDiffPaths(diff: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const re = /^diff --git a\/(.+?) b\/(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(diff))) {
    const path = match[2] && match[2] !== '/dev/null' ? match[2] : match[1];
    if (!seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

function cutAtBudget(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const atNewline = slice.lastIndexOf('\n');
  if (atNewline >= Math.floor(limit * 0.8)) return slice.slice(0, atNewline);
  return slice;
}

function truncationNote(full: string, kept: string, canExplore: boolean): string {
  const allFiles = listDiffPaths(full);
  const keptFiles = listDiffPaths(kept);
  const omitted = allFiles.filter((f) => !keptFiles.includes(f));
  const partial =
    keptFiles.length > 0 && kept.length < full.length
      ? keptFiles[keptFiles.length - 1]
      : undefined;

  const lines = [
    `【截断提示】完整 Diff 共 ${full.length} 字符，此处仅保留前 ${kept.length} 字符。`,
  ];
  if (allFiles.length > 0) {
    lines.push(`涉及文件（${allFiles.length}）：${allFiles.join(', ')}`);
  }
  if (partial && omitted.length) {
    lines.push(`未完整包含：${partial}；完全未包含：${omitted.join(', ')}`);
  } else if (partial) {
    lines.push(`未完整包含：${partial}`);
  } else if (omitted.length) {
    lines.push(`完全未包含：${omitted.join(', ')}`);
  }
  lines.push(
    canExplore
      ? '被截断的内容不要臆测。请对未读完的文件调用 read_file / search_code 补全后再下结论。'
      : '被截断的内容不要臆测。如需完整审查，请按文件解释或改用 Agent 模式。'
  );
  return lines.join('\n');
}

function diffBlock(diff: string, limit: number, canExplore = false): string {
  if (diff.length <= limit) {
    return `\`\`\`diff\n${diff}\n\`\`\``;
  }
  const kept = cutAtBudget(diff, limit);
  return `\`\`\`diff\n${kept}\n\`\`\`\n\n${truncationNote(diff, kept, canExplore)}`;
}

function resolveDiffBudget(
  ctx: PromptContext,
  kind: 'fast' | 'agent'
): { full: number; line: number } {
  const tokens = inferContextWindowTokens(ctx.config ?? {});
  return {
    full: diffCharBudgetFromWindow(tokens, kind),
    line: diffCharBudgetFromWindow(tokens, 'line'),
  };
}

function focusedLineBlock(targetLine: TargetLineInfo): string {
  const marker = targetLine.type === 'delete' ? '-' : targetLine.type === 'add' ? '+' : ' ';
  return `\`\`\`\n${marker} ${targetLine.content}\n\`\`\``;
}

function splitChangedLines(diff: string): { dels: string[]; adds: string[] } {
  const dels: string[] = [];
  const adds: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) adds.push(line.slice(1));
    else if (line.startsWith('-') && !line.startsWith('---')) dels.push(line.slice(1));
  }
  return { dels, adds };
}

/**
 * Number every changed line so the model cannot collapse a hunk into two
 * summary bullets — the viewer maps output rows 1:1 onto the diff.
 */
function buildPseudocodeUserMessage(diff: string, file: string, message: string): string {
  const { dels, adds } = splitChangedLines(diff);
  const delList =
    dels.length === 0
      ? '（无）'
      : dels.map((line, i) => `${i + 1}. - ${line}`).join('\n');
  const addList =
    adds.length === 0
      ? '（无）'
      : adds.map((line, i) => `${i + 1}. + ${line}`).join('\n');

  return `文件: ${file}
提交信息: ${message}

本块共有 ${dels.length} 行删除、${adds.length} 行新增。
你必须输出恰好 ${dels.length} 行以 '-' 开头的中文伪代码，然后恰好 ${adds.length} 行以 '+' 开头的中文伪代码。
顺序必须与下列清单一一对应：一行对一行，不得合并，不得跳过括号/空行/注释，不要编号，不要 Markdown，不要代码围栏。

【删除行】共 ${dels.length} 行：
${delList}

【新增行】共 ${adds.length} 行：
${addList}

【输出示例】（不要复制本说明，按真实行数输出）
- // 第一条删除行在做什么
- // 第二条删除行在做什么
+ // 第一条新增行在做什么
+ // 第二条新增行在做什么`;
}

// ------------------------------ Fast diff engine ------------------------------

export function buildFastPrompts(ctx: PromptContext): { system: string; user: string } {
  const { scopeType, targetLine, filePath, commitMessage, userPrompt, task, config } = ctx;
  const diff = ctx.diff || '';
  const file = filePath || '当前文件';
  const message = commitMessage || '无';
  const { full: fullLimit, line: lineLimit } = resolveDiffBudget(ctx, 'fast');

  if (userPrompt && userPrompt.trim()) {
    if (isFormattingPreset(userPrompt, task)) {
      if (task === 'pseudocode') {
        return {
          system: userPrompt.trim(),
          user: buildPseudocodeUserMessage(diff, file, message),
        };
      }
      return {
        system: userPrompt.trim(),
        user: `【待处理 Git Diff 差异】\n文件: ${file}\n提交信息: ${message}\n${diffBlock(
          diff,
          diff.length
        )}`,
      };
    }

    return {
      system:
        '你是一位资深架构师和代码审查专家。请结合代码改动上下文，专业、透彻地解答用户的追问。请使用排版清晰的 Markdown 输出。',
      user: `【代码改动上下文 Diff】\n文件: ${file}\n提交信息: ${message}\n${diffBlock(
        diff,
        fullLimit
      )}\n\n【用户追问】:\n${userPrompt.trim()}\n\n请针对用户的具体追问给出专业解答。`,
    };
  }

  const customPrompt =
    config?.fastDiffPrompt?.trim() ||
    config?.reviewPrompt?.trim() ||
    config?.customSystemPrompt?.trim();

  let system: string;
  if (customPrompt) {
    system = customPrompt;
  } else if (scopeType === 'line' && targetLine) {
    system =
      '你是一位资深代码审查专家。请对用户选中的具体代码行进行清晰、透彻的代码改动直解与上下文意图分析。请使用排版清晰的 Markdown 输出，直击要点，无需输出无关套话。';
  } else if (scopeType === 'chunk') {
    system =
      '你是一位资深代码审查专家。请对用户选定的代码改动块（Diff Hunks）进行深入的代码逻辑剖析与改动目的说明。请使用排版清晰的 Markdown 输出，直击要点，无需输出无关套话。';
  } else {
    system =
      '你是一位资深架构师和代码审查专家。你的任务是对给定的 Git Diff 进行深度语义分析，深入剖析代码改动的核心逻辑、语句含义与修改目的。请使用排版清晰的 Markdown 输出，直击要点，无需输出无关套话。';
  }

  const user =
    scopeType === 'line' && targetLine
      ? `【文件】: ${file}\n【聚焦代码行 (Line ${
          targetLine.lineNumber || ''
        })】:\n${focusedLineBlock(targetLine)}\n\n【周围上下文 Diff】:\n${diffBlock(
          diff,
          lineLimit
        )}\n\n请针对该聚焦行进行专业解释。`
      : `【请分析以下 Git 差异】\n文件: ${filePath || '多文件'}\n提交信息: ${message}\n${diffBlock(
          diff,
          fullLimit
        )}`;

  return { system, user };
}

// ------------------------------ Agent engine ------------------------------

export function isLearnTask(ctx: PromptContext): boolean {
  return ctx.task === 'learn' || ctx.scopeType === 'repo';
}

export function buildLearnSystemPrompt(
  ctx: PromptContext,
  phase: 'exploration' | 'structured' | 'prose' = 'exploration'
): string {
  const isFollowUp = Boolean(ctx.userPrompt && ctx.userPrompt.trim());
  const isExpansion = ctx.learnRequestMode === 'expand_graph';
  const isDrilldown = ctx.learnRequestMode === 'drilldown_graph';
  const learnPrompt = ctx.config?.learnPrompt?.trim() || DEFAULT_LEARN_PROMPT;
  if (isFollowUp && !isExpansion && !isDrilldown) {
    return `你是代码库导师。结构图谱已经由本地解析得到（节点=类/React组件/职责模块，普通函数归入所属节点；边=调用/引用/导入/继承）。结合社区与枢纽节点回答。
优先调用 search_code / read_file / repo_graph 核实后再回答。
需要查代码时只能使用 API 提供的原生函数调用；禁止在正文中用 XML、JSON、<@read_file> 或其他标签模拟工具调用。
回答必须是给人读的中文，落到真实文件路径与符号名，讲清数据怎么流、谁调用谁。禁止输出 JSON。

【用户配置的业务讲解要求】
${learnPrompt}

以上配置只决定讲解的重点、深度和表达方式；本轮仍必须直接回答用户问题，并遵守工具核实、真实证据和禁止 JSON 的规则。`;
  }

  const evidencePhase = phase === 'exploration'
    ? `【必须探查】先用 repo_overview / repo_graph 找入口候选，再用 read_file 和 search_code 沿真实调用方、被调用方、状态或数据对象追踪。每条业务路线都必须读到入口、核心处理和结果落点；没读到的符号不得写进路线。

【工具调用协议】探查只能通过 API 提供的原生函数调用完成。需要继续读代码时直接调用工具，禁止在 assistant 正文中输出或模拟“<@read_file>...</@read_file>”、XML、JSON 或任何其他工具调用标签。`
    : `【探查已完成】当前请求不提供工具。只能使用用户消息中的结构图谱和服务端附带的源码探查结果；证据不足的候选必须舍弃或标为待核实，禁止请求继续读取代码。`;
  const userGuidance = phase === 'structured'
    ? ''
    : `

【用户配置的业务分析与讲解要求】
${learnPrompt}`;

  const baseSystem = `你是代码库业务导师。界面的主视图以本地解析的社区骨架为主，你负责核实社区的业务语义，并把证据完整的业务路线作为高亮层叠加到骨架上。先读代码、确认社区边界和真实入口，再识别业务闭环并整理关键节点的先后关系。

【结构事实】用户消息里有一份本地解析的结构图谱（EXTRACTED）。它只作为候选文件、类型、社区和静态依赖证据，不等于运行时业务路线。禁止仅凭目录名或度数推断业务流程。

${evidencePhase}

【分析目标】
- 识别仓库实际存在的主要业务路线，例如一次请求、一次任务、一次结算或一个用户动作如何走完。
- 每条路线只保留解释业务闭环所必需的关键步骤，过滤通用工具、类型声明和无关引用。
- 步骤必须有明确顺序，并说明输入/状态如何变成输出以及为什么进入下一步。
- 每条路线必须以 entry 入口开始，以 result 可观察结果结束；中间按源码事实使用 process、decision、state、external，不能用节点类型代替证据。
- 每一步都要结构化列出 inputs、outputs、stateChanges、failurePaths；没有对应事实时使用空数组，不能填“无”“未知”或猜测。
- 社区用于说明职责边界；业务路线可以跨社区，但必须指出交接点。
- 不追求路线数量。只有入口、相邻步骤关系和结果落点都被工具结果证明的候选才能进入 businessRoutes；证据不完整的候选写进正文的“待核实”而不是路线数据。
- 输出前逐步反查 exploration 中读到的源码：每一步必须给出 relation（入口/调用/读取/写入/发布/回调等）和 evidence（真实调用表达式、状态字段或接口契约）；禁止用职责描述冒充证据，禁止编造行号。${userGuidance}

上述要求决定分析重点、展开深度和正文表达方式，但不能覆盖本提示词规定的工具核实要求、learn-graph 数据协议和证据门槛。`;
  const structuredStage = `【当前为结构化业务路线阶段（1/2）】本次请求启用 JSON Output。只输出一个合法 JSON 对象，不要输出 Markdown 围栏、讲解正文、工具调用、前后缀或任何 JSON 之外的字符：
{"communities":[{"id":"0","label":"业务名","summary":"职责与路线交接说明","entry":{"file":"相对路径","symbol":"真实类名"},"files":["相对路径"]}],"businessRoutes":[{"id":"route-1","label":"业务路线名称","summary":"触发条件、核心结果和适用场景","steps":[{"label":"接收请求","kind":"entry","file":"相对路径","classSymbol":"所在类名","methodSymbol":"具体方法名","relation":"入口","description":"输入或状态如何处理，以及下一步去哪里","evidence":"源码中实际出现的调用表达式、状态字段或接口契约","communityId":"0","inputs":["协议或 DTO"],"outputs":["传给下一步的对象"],"stateChanges":[],"failurePaths":["校验失败时的真实行为"]},{"label":"返回结果","kind":"result","file":"相对路径","classSymbol":"所在类名","methodSymbol":"具体方法名","relation":"返回","description":"最终结果和可观察副作用","evidence":"真实返回、发送或发布表达式","communityId":"0","inputs":["最终状态"],"outputs":["响应或事件"],"stateChanges":[],"failurePaths":[]}]}],"runtimePath":["0"]}
businessRoutes 可以为空：只有不存在任何证据完整的路线时才能输出空数组，绝不能为了非空而编造。存在路线时必须形成真实业务闭环；每个 step 的 kind、file、classSymbol、methodSymbol、relation、evidence、communityId、inputs、outputs、stateChanges、failurePaths 都是必填字段，四个数组没有事实时填空数组。kind 只能是 entry/process/decision/state/external/result，第一步必须是 entry，最后一步必须是 result。communityId 必须使用图谱已有编号。classSymbol 专门用于绑定类级节点，必须从结构图谱“可绑定类级节点”清单中逐字复制对应 label，file 和 communityId 也必须使用该清单中同一节点的值；禁止写包名、完整限定名、方法名、括号或签名。methodSymbol 必须填写该步骤实际执行的方法或函数名。DTO、枚举、接口、配置项只写进 inputs、outputs、stateChanges、description 或 evidence，不能冒充可执行类节点。任何步骤找不到清单中的所在类或具体方法时，整条候选只能写入正文“待核实”，不得放进 businessRoutes。
所有字段必须满足 learn-graph v2 约束。`;
  const proseStage = `【当前为中文讲解阶段（2/2）】机器数据已经生成并通过服务端校验。只输出给读者阅读的中文 Markdown 正文，不得再输出 JSON、代码围栏或工具调用。必须写这些章节，并点名真实符号与相对路径：
1. 业务全景 — 仓库实际提供什么产品、服务或玩法；谁触发、主要输入、最终产出和系统边界是什么
2. 主要业务路线 — 每条路线独立成节，先讲业务价值，再从触发入口开始按编号逐步写到结果落点；每一步都说明 caller -> callee、关键参数或对象、状态变化、进入下一步的条件和源码证据
3. 关键分支与失败处理 — 点明条件分支、提前返回、异常，以及源码中存在的重试、幂等、回滚或补偿；证据不足的内容放到待核实
4. 数据与状态 — 汇总关键 DTO、消息、实体、配置、缓存或持久化对象，说明谁写、谁读、生命周期如何
5. 社区职责与路线交接 — 各社区在路线中承担什么，跨社区时由哪个真实调用、事件或数据对象完成交接
6. 外部依赖与边界 — 数据库、缓存、消息系统、网络协议、第三方服务或前后端边界，以及可观察到的副作用
7. 关键节点与修改影响 — 为什么这些节点不可省略，修改会影响哪条路线、状态或调用方
8. 待核实问题 — 明确列出源码证据尚未闭合的候选，不得把猜测写成结论
9. 建议阅读顺序 — 按业务路线给出文件和符号顺序，并说明每一站要看懂什么

禁止空话（「负责业务逻辑」），不得补写已验证机器数据之外的路线或节点。`;
  const explorationStage = `【当前仅执行源码探查】本轮只调用工具收集入口、调用、数据、状态、失败路径和结果落点证据。证据足够后停止调用工具并简短回复“探查完成”；不要在本轮输出 JSON、learn-graph 围栏或讲解正文，服务端会在后续两个独立阶段生成结构化业务图和中文讲解。`;
  const system = `${baseSystem}

${phase === 'structured' ? structuredStage : phase === 'prose' ? proseStage : explorationStage}`;
  if (isExpansion) return `${system}

【本轮是用户手动补充业务总线】只分析用户点名但现有路线没有覆盖的部分。输出的 businessRoutes 只能包含本轮新增路线，禁止重复、改写或删除已有路线；路线 id 必须与已有 id 不同。仍须从入口追到结果，完全遵守上述 v2 机器数据和源码证据门槛。若问题无法形成新的证据闭环，输出空 businessRoutes，并在正文说明缺少哪段证据。`;
  if (isDrilldown) return `${system}

【本轮是业务节点递归钻取】只拆解用户选中的那个具体路线步骤，不重新分析整条顶层业务，也不输出同粒度的改写。businessRoutes 表示该步骤内部更细的执行子路线：从进入该步骤开始，到该步骤对上层可观察的产出结束。允许多个子步骤绑定同一个类或方法，但每一步仍必须有不同的真实动作、顺序和源码证据；不得为了“更细”而拆分语句或编造抽象层。若源码已经没有可证明的更细执行层，输出空 businessRoutes，并在正文明确说明已到源码证据粒度。`;
  return system;
}

function formatExistingRoutes(ctx: PromptContext): string {
  const routes = ctx.existingBusinessRoutes || [];
  if (!routes.length) return '（当前还没有已接受的业务路线）';
  return routes.map((route) => {
    const steps = route.steps.map((step) =>
      `${step.kind}:${step.file}::${step.classSymbol}.${step.methodSymbol}`).join(' -> ');
    return `- ${route.id} ${route.label}: ${steps}`;
  }).join('\n');
}

export function buildLearnUserMessage(ctx: PromptContext): string {
  const digest = ctx.graphDigest?.trim()
    ? `\n\n${ctx.graphDigest.trim()}\n`
    : '\n（结构图谱摘要缺失，请先调用 repo_graph）\n';
  if (ctx.userPrompt && ctx.userPrompt.trim() && ctx.learnRequestMode === 'drilldown_graph') {
    const path = ctx.drillPath || [];
    const formattedPath = path.map((target, index) =>
      `${index + 1}. ${target.routeLabel} / 第 ${target.stepIndex + 1} 步「${target.label}」\n` +
      `   ${target.file} :: ${target.classSymbol}.${target.methodSymbol} [${target.kind}]\n` +
      `   关系=${target.relation}；说明=${target.description}；证据=${target.evidence}\n` +
      `   输入=${target.inputs.join('；') || '空'}；输出=${target.outputs.join('；') || '空'}；` +
      `状态变化=${target.stateChanges.join('；') || '空'}；失败路径=${target.failurePaths.join('；') || '空'}`
    ).join('\n');
    return `${digest}【递归钻取路径】\n${formattedPath}\n\n【当前要展开的节点】\n${path[path.length - 1]?.label || ctx.userPrompt.trim()}\n\n请调用工具从这个具体步骤的源码实现向内追踪；如果已经无法再细分，记录为 businessRoutes 输出空数组。证据足够后结束探查，机器数据和本层讲解由后续阶段分别生成。`;
  }
  if (ctx.userPrompt && ctx.userPrompt.trim() && ctx.learnRequestMode === 'expand_graph') {
    const focus = ctx.filePath ? `当前聚焦文件: ${ctx.filePath}\n\n` : '';
    return `${focus}${digest}【已接受路线，禁止重复】\n${formatExistingRoutes(ctx)}\n\n【用户要求补充的业务】:\n${ctx.userPrompt.trim()}\n\n请调用工具核实这部分业务是否能形成新的完整闭环；证据足够后结束探查，新增路线机器数据和补充讲解由后续阶段分别生成。`;
  }
  if (ctx.userPrompt && ctx.userPrompt.trim()) {
    const focus = ctx.filePath ? `当前聚焦文件: ${ctx.filePath}\n\n` : '';
    return `${focus}${digest}【用户提问】:\n${ctx.userPrompt.trim()}\n\n请调用工具核实后作答，指向真实文件和符号，讲清调用关系。`;
  }
  const focus = ctx.filePath
    ? `\n请特别说明文件 ${ctx.filePath} 落在哪个社区、运行时何时进入、和哪些枢纽相连。\n`
    : '';
  return `请先分析当前仓库真正的业务入口和主要业务闭环。结构图谱只是候选证据；请用 read_file / search_code 沿调用和数据状态核实每条路线。证据足够后结束探查，业务路线机器数据和中文讲解由后续阶段分别生成。${focus}${digest}`;
}

export function buildAgentSystemPrompt(ctx: PromptContext): string {
  if (isLearnTask(ctx)) return buildLearnSystemPrompt(ctx);

  const isFollowUp = Boolean(ctx.userPrompt && ctx.userPrompt.trim());

  if (isFollowUp) {
    return `你是由 OpenAI Codex 驱动的高级自主代码审查与深度探索智能体（Autonomous Codex Agent）。
当前用户正结合给定的 Git 代码差异与上下文向你发起【代码追问与技术探讨】。

【关键行动原则】：
1. 积极且优先自主调用工具探查真实代码：
   针对用户的具体提问（例如：询问某个方法/函数的调用位置、类/接口的定义、特定逻辑的调用链、上下游影响、潜在并发/异常风险、某个变量的赋值流转等），严禁凭空盲猜或假设！请【优先且主动调用】提供的工具：
   - \`search_code\`: 全库搜索关键字、方法名、类名、变量或接口调用方
   - \`read_file\`: 读取关键文件的完整源码或被调用的外部类实现
   - \`find_files\`: 查找相关工程源码文件
2. 自主动态收敛：当你通过工具探查获取到真实的工程代码上下文后，请停止调用工具，直接给出专业、切中要害的解答；
3. 输出要求：使用排版精美、层级清晰的 Markdown 输出，直击问题本质，无需机械套用初始审查报告的固定模板。`;
  }

  const userDefinedPrompt =
    ctx.config?.reviewPrompt?.trim() || ctx.config?.customSystemPrompt?.trim();

  return `你是由 OpenAI Codex 驱动的高级自主代码审查智能体（Autonomous Codex Agent）。
【核心自主规划原则】：
1. 具备全权自主规划与探查能力：根据给定的 Diff，你可以完全自主决定调用 \`read_file\`、\`search_code\`、\`find_files\` 工具探查外部类、接口契约与下游调用链；
2. 自主动态收敛：当你判断已经收集到足够理解本次改动全貌与影响的上下文后，请自主停止调用工具，直接输出完整的 Markdown 深度代码审查报告。

${
  userDefinedPrompt
    ? `【审查要求与格式指令】：\n${userDefinedPrompt}`
    : `【审查原则与排版参考】：
- 严禁空洞套话，严禁简单复述语法。精确指出涉及的类名、方法名、参数类型、数据结构与关键算法；
- 清晰对比改动前后的行为差异 (Before vs After)；
- 深入拆解实现机制与底层原因；
- 明确指出对下游调用方与工程依赖的影响。

${REVIEW_FORMAT_GUIDE}`
}`;
}

export function buildAgentUserMessage(ctx: PromptContext): string {
  if (isLearnTask(ctx)) return buildLearnUserMessage(ctx);

  const { scopeType, targetLine, filePath, commitMessage, userPrompt } = ctx;
  const diff = ctx.diff || '';
  const message = commitMessage || '无';
  const { full: fullLimit, line: lineLimit } = resolveDiffBudget(ctx, 'agent');

  if (userPrompt && userPrompt.trim()) {
    return `【代码改动上下文 Diff】:
文件: ${filePath || '多文件'}
提交信息: ${message}
${diffBlock(diff, fullLimit, true)}

【用户追问】:
${userPrompt.trim()}

【任务指令】:
请针对我提出的具体追问，主动调用工具（如 search_code / read_file）探查代码库中的相关定义、调用链或接口实现，结合真实的工程上下文给出精准专业的解答。`;
  }

  if (scopeType === 'line' && targetLine) {
    return `【文件】: ${filePath || '当前文件'}\n【聚焦代码行 (Line ${
      targetLine.lineNumber || ''
    })】:\n${focusedLineBlock(targetLine)}\n\n【周围上下文 Diff】:\n${diffBlock(
      diff,
      lineLimit,
      true
    )}\n\n请自主规划探查并进行深度代码审查。`;
  }

  return `【待审查文件】: ${filePath || '多文件'}\n【提交信息】: ${message}\n${diffBlock(
    diff,
    fullLimit,
    true
  )}\n\n请自主规划代码库探查路径并输出审查报告。`;
}

export interface ExplorationEntry {
  name: string;
  args: unknown;
  output: string;
}

/** Prompt for the fallback synthesis pass that runs when the agent loop
 *  finished without emitting a substantial report. */
export function buildSynthesisPrompt(
  explorationLog: ExplorationEntry[],
  userPrompt?: string,
  extra?: { truncatedDraft?: string; learnTask?: boolean; learnExpansion?: boolean; learnDrilldown?: boolean }
): string {
  const isFollowUp = Boolean(userPrompt && userPrompt.trim());
  const isLearn = Boolean(extra?.learnTask);
  const isExpansion = Boolean(extra?.learnExpansion);
  const isDrilldown = Boolean(extra?.learnDrilldown);

  let body: string;
  if (explorationLog.length === 0) {
    body = isDrilldown
      ? `【节点钻取探查已结束】用户要向内展开：${userPrompt?.trim()}\n\n严格按照系统规定输出该节点内部更细的 learn-graph；已经没有更细源码证据时 businessRoutes 输出空数组。`
      : isExpansion
      ? `【手动补图探查已结束】用户要补充：${userPrompt?.trim()}\n\n严格按照系统规定输出只含新增路线的 learn-graph，再输出补充讲解；没有新的证据闭环时 businessRoutes 输出空数组。`
      : isFollowUp
      ? `【用户追问】:\n${userPrompt?.trim()}\n\n请直接针对用户的追问给出精准、专业、详尽的 Markdown 解答。`
      : isLearn
        ? '【探查阶段已结束】请严格按照系统规定，先输出包含 businessRoutes 数组的 learn-graph 机器数据，再输出仓库业务讲解；没有证据完整的路线时输出空数组。'
        : '【探查阶段已结束】请根据上述代码修改差异，严格按照设定的审查规则，直接输出最终完整的 Markdown 深度代码审查报告。';
  } else {
    const contextSummary = explorationLog
      .map(
        (log, idx) =>
          `【探查结果 #${idx + 1} (${log.name} 参数: ${JSON.stringify(log.args)})】:\n${log.output}`
      )
      .join('\n\n');
    const evidenceRule =
      '以下探查结果是内部证据。禁止在 reasoning_content 或正文中逐段复述参数、源码和工具返回；只提炼与结论有关的文件、符号、调用关系和风险。';

    body = isDrilldown
      ? `【节点钻取探查已结束】已核实以下源码与调用上下文：\n${evidenceRule}\n\n${contextSummary}\n\n【当前钻取目标】:\n${userPrompt?.trim()}\n\n只提炼这个步骤内部更细的执行子路线。严格按照系统规定先输出 learn-graph，再输出本层讲解；已到源码证据粒度时 businessRoutes 输出空数组。`
      : isExpansion
      ? `【手动补图探查已结束】已在代码库中核实以下源码与调用上下文：\n${evidenceRule}\n\n${contextSummary}\n\n【用户要求补充的业务】:\n${userPrompt?.trim()}\n\n只提炼现有路线未覆盖且证据闭环的新路线。严格按照系统规定先输出只含新增路线的 learn-graph，再输出补充讲解；没有新路线时 businessRoutes 输出空数组。`
      : isFollowUp
      ? `【探查阶段已结束】已在代码库中探查到以下关联源码与调用上下文：\n${evidenceRule}\n\n${contextSummary}\n\n【用户追问】:\n${userPrompt?.trim()}\n\n请结合上述探查到的源码与调用上下文，直接输出精准、专业、详尽的 Markdown 解答。`
      : isLearn
        ? `【探查阶段已结束】已在代码库中核实以下源码与调用上下文：\n${evidenceRule}\n\n${contextSummary}\n\n请从真实入口、调用、数据和状态变化中提炼主要业务路线。严格按照系统规定，先输出包含 businessRoutes 数组的 learn-graph 机器数据，再输出正文；没有证据完整的路线时输出空数组。`
        : `【探查阶段已结束】已在代码库中检索到以下关联源码与调用上下文：\n${evidenceRule}\n\n${contextSummary}\n\n请根据上述探查到的全部代码上下文与修改差异，严格按照设定的审查规则，直接输出最终完整的 Markdown 深度代码审查报告。`;
  }

  const draft = extra?.truncatedDraft?.trim();
  if (!draft) return body;

  return `${body}

【上一轮输出被截断，尚未写完】请从中断处继续补全终审报告，不要重复已经写过的段落。

【已输出的不完整内容】:
${draft}`;
}
