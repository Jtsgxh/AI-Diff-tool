import {
  diffCharBudgetFromWindow,
  inferContextWindowTokens,
  type ExplainTask,
  type PartialAIProviderConfig,
  type ScopeType,
  type TargetLineInfo,
} from '../shared/types';

export interface PromptContext {
  scopeType?: ScopeType;
  targetLine?: TargetLineInfo;
  diff: string;
  filePath?: string;
  commitMessage?: string;
  userPrompt?: string;
  task?: ExplainTask;
  config?: PartialAIProviderConfig;
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
  const { scopeType, targetLine, diff, filePath, commitMessage, userPrompt, task, config } = ctx;
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

export function buildAgentSystemPrompt(ctx: PromptContext): string {
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
  const { scopeType, targetLine, diff, filePath, commitMessage, userPrompt } = ctx;
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
  userPrompt?: string
): string {
  const isFollowUp = Boolean(userPrompt && userPrompt.trim());

  if (explorationLog.length === 0) {
    return isFollowUp
      ? `【用户追问】:\n${userPrompt?.trim()}\n\n请直接针对用户的追问给出精准、专业、详尽的 Markdown 解答。`
      : '【探查阶段已结束】请根据上述代码修改差异，严格按照设定的审查规则，直接输出最终完整的 Markdown 深度代码审查报告。';
  }

  const contextSummary = explorationLog
    .map(
      (log, idx) =>
        `【探查结果 #${idx + 1} (${log.name} 参数: ${JSON.stringify(log.args)})】:\n${log.output}`
    )
    .join('\n\n');

  return isFollowUp
    ? `【探查阶段已结束】已在代码库中探查到以下关联源码与调用上下文：\n\n${contextSummary}\n\n【用户追问】:\n${userPrompt?.trim()}\n\n请结合上述探查到的源码与调用上下文，直接输出精准、专业、详尽的 Markdown 解答。`
    : `【探查阶段已结束】已在代码库中检索到以下关联源码与调用上下文：\n\n${contextSummary}\n\n请根据上述探查到的全部代码上下文与修改差异，严格按照设定的审查规则，直接输出最终完整的 Markdown 深度代码审查报告。`;
}
