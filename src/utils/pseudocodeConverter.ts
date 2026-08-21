import { DiffHunk, DiffLine, SplitDiffRow } from './diffParser';

/**
 * In-Place Pseudocode Converter (Diff 内联行级伪代码转换器)
 * Replaces changed code lines in-place within the Diff rows (Split & Unified)
 * with intuitive, readable natural language pseudocode statements.
 */

export function convertCodeLineToPseudocode(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return code;

  // Preserve leading indentation
  const indentMatch = code.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '';

  // 1. XML documentation & Comments
  if (trimmed.startsWith('/// <summary>')) return `${indent}// 📋 [功能概述]`;
  if (trimmed.startsWith('/// </summary>')) return `${indent}// 📋 [/功能概述]`;
  if (trimmed.startsWith('/// <param name="')) {
    const pMatch = trimmed.match(/name="([^"]+)">([^<]*)/);
    if (pMatch) return `${indent}// 📥 参数「${pMatch[1]}」：${pMatch[2].trim()}`;
  }
  if (trimmed.startsWith('/// <returns>')) {
    const rMatch = trimmed.match(/<returns>([^<]*)/);
    if (rMatch) return `${indent}// 📤 返回值：${rMatch[1].trim()}`;
  }
  if (trimmed.startsWith('///')) {
    return `${indent}// ${trimmed.replace(/^\/\/\/\s*/, '')}`;
  }
  if (trimmed.startsWith('//')) {
    return code; // Keep original comments
  }

  // 2. Pure syntax braces
  if (trimmed === '{' || trimmed === '}' || trimmed === '},' || trimmed === '};') {
    return code;
  }

  // 3. Method / Function Declarations: public static void LogConversion(...)
  const methodMatch = trimmed.match(
    /^(public|private|protected|internal)?\s*(static\s+)?(async\s+)?([\w<>\[\],\s\?]+)\s+([\w]+)\s*\((.*)\)\s*\{?$/
  );
  if (
    methodMatch &&
    !trimmed.startsWith('if') &&
    !trimmed.startsWith('for') &&
    !trimmed.startsWith('while') &&
    !trimmed.startsWith('switch') &&
    !trimmed.startsWith('catch')
  ) {
    const access = methodMatch[1] ? `${methodMatch[1]} ` : '';
    const isStatic = methodMatch[2] ? '静态' : '';
    const retType = methodMatch[4].trim();
    const methodName = methodMatch[5];
    const params = methodMatch[6].trim();
    const hasBrace = trimmed.endsWith('{') ? ' {' : '';
    return `${indent}// ⚙️ 定义${access}${isStatic}方法「${methodName}」(返回: ${retType}, 参数: ${params || '无'})${hasBrace}`;
  }

  // 4. Conditionals (if, else if, else, switch)
  if (/^if\s*\(/.test(trimmed)) {
    const cond = trimmed.replace(/^if\s*\(/, '').replace(/\)[\s\{]*$/, '');
    const hasBrace = trimmed.endsWith('{') ? ' {' : '';
    return `${indent}// ❓ 条件判断：如果【${cond}】为真${hasBrace}`;
  }
  if (/^else\s+if\s*\(/.test(trimmed)) {
    const cond = trimmed.replace(/^else\s+if\s*\(/, '').replace(/\)[\s\{]*$/, '');
    const hasBrace = trimmed.endsWith('{') ? ' {' : '';
    return `${indent}// ❓ 否则如果【${cond}】为真${hasBrace}`;
  }
  if (/^else\s*\{?$/.test(trimmed)) {
    const hasBrace = trimmed.endsWith('{') ? ' {' : '';
    return `${indent}// ↪️ 否则执行备用分支${hasBrace}`;
  }

  // 5. Loops (foreach, for, while)
  if (/^foreach\s*\(/.test(trimmed)) {
    const loop = trimmed.replace(/^foreach\s*\(/, '').replace(/\)[\s\{]*$/, '');
    const hasBrace = trimmed.endsWith('{') ? ' {' : '';
    return `${indent}// 🔁 遍历集合：针对【${loop}】${hasBrace}`;
  }
  if (/^for\s*\(/.test(trimmed)) {
    const loop = trimmed.replace(/^for\s*\(/, '').replace(/\)[\s\{]*$/, '');
    const hasBrace = trimmed.endsWith('{') ? ' {' : '';
    return `${indent}// 🔁 循环迭代：【${loop}】${hasBrace}`;
  }
  if (/^while\s*\(/.test(trimmed)) {
    const loop = trimmed.replace(/^while\s*\(/, '').replace(/\)[\s\{]*$/, '');
    const hasBrace = trimmed.endsWith('{') ? ' {' : '';
    return `${indent}// 🔁 当【${loop}】为真时持续循环${hasBrace}`;
  }

  // 6. Returns & Throws
  if (/^return\b/.test(trimmed)) {
    const val = trimmed.replace(/^return\s*/, '').replace(/;$/, '');
    return `${indent}// ↩️ 返回：${val || 'void'}`;
  }
  if (/^throw\s+new\s+/.test(trimmed)) {
    const ex = trimmed.replace(/^throw\s+new\s+/, '').replace(/;$/, '');
    return `${indent}// 💥 抛出异常：${ex}`;
  }

  // 7. Console & Logger Calls
  if (
    /^(Console\.(WriteLine|Write|Error\.WriteLine)|Debug\.Log(Warning|Error)?|logger\.|BackendLog\.)/.test(
      trimmed
    )
  ) {
    const logCall = trimmed.replace(/;$/, '');
    return `${indent}// 📢 输出日志：${logCall}`;
  }

  // 8. Object Instantiation (new ClassName { ... })
  if (/(=>|\=)\s*new\s+(\w+)/.test(trimmed)) {
    const hasBrace = trimmed.endsWith('{') ? ' {' : '';
    const instMatch = trimmed.match(/new\s+([\w<>]+)/);
    const typeName = instMatch ? instMatch[1] : '对象';
    return `${indent}// ⚡ 实例化「${typeName}」对象${hasBrace}`;
  }

  // 9. Property Assignment: AbilityName = "Heal",
  const propAssignMatch = trimmed.match(/^([\w]+)\s*=\s*(.+)[,;]?$/);
  if (propAssignMatch && !trimmed.includes('=>') && !trimmed.startsWith('return')) {
    const propName = propAssignMatch[1];
    const val = propAssignMatch[2].replace(/[,;]$/, '');
    return `${indent}// 🔹 配置属性「${propName}」= ${val}`;
  }

  // 10. Variable Declarations
  const varDeclMatch = trimmed.match(
    /^(var|let|const|int|string|bool|float|double|auto|List<[\w]+>|Dictionary<[\w,\s]+>)\s+([\w]+)\s*=\s*(.+);?$/
  );
  if (varDeclMatch) {
    const varName = varDeclMatch[2];
    const val = varDeclMatch[3].replace(/;$/, '');
    return `${indent}// 📌 声明变量「${varName}」并初始化为：${val}`;
  }

  // 11. Method invocations
  if (/^([\w\.]+)\s*\((.*)\);?$/.test(trimmed)) {
    const callMatch = trimmed.match(/^([\w\.]+)\s*\((.*)\);?$/);
    if (callMatch) {
      return `${indent}// ⚙️ 调用方法「${callMatch[1]}」(${callMatch[2].trim() || '无参数'})`;
    }
  }

  // 12. Imports / Usings
  if (/^(using|import)\s+/.test(trimmed)) {
    const mod = trimmed.replace(/^(using|import)\s+/, '').replace(/;$/, '');
    return `${indent}// 📦 引入模块依赖：${mod}`;
  }

  // Default fallback: Add descriptive pseudocode indicator
  return `${indent}// 📝 执行：${trimmed.replace(/;$/, '')}`;
}

/**
 * Parses AI-streamed diff pseudocode text and maps them to array of deleted & added pseudocode lines
 */
export function parseAiPseudocodeLines(aiText: string): { dels: string[]; adds: string[] } {
  const lines = aiText.split('\n');
  const dels: string[] = [];
  const adds: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('```')) continue;

    if (trimmed.startsWith('-')) {
      const clean = trimmed.replace(/^-[\s]*/, '').replace(/^\/\/\s*/, '').trim();
      if (clean) dels.push(`// ${clean}`);
    } else if (trimmed.startsWith('+')) {
      const clean = trimmed.replace(/^\+[\s]*/, '').replace(/^\/\/\s*/, '').trim();
      if (clean) adds.push(`// ${clean}`);
    }
  }

  return { dels, adds };
}
