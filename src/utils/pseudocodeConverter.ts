import { DiffHunk, DiffLine, SplitDiffRow } from './diffParser';

/**
 * Conceptual / Summarized Pseudocode Generator (概括性伪代码生成器)
 * Translates low-level verbose syntax lines into high-level, human-readable conceptual pseudocode blocks.
 */

export interface HunkConceptualSummary {
  oldPseudocode: string[];
  newPseudocode: string[];
}

export function generateConceptualHunkPseudocode(hunk: DiffHunk): HunkConceptualSummary {
  const oldLines = hunk.lines.filter((l) => l.type === 'delete').map((l) => l.content);
  const newLines = hunk.lines.filter((l) => l.type === 'add').map((l) => l.content);

  const oldPseudocode = summarizeLinesToConceptualSteps(oldLines, 'delete');
  const newPseudocode = summarizeLinesToConceptualSteps(newLines, 'add');

  return { oldPseudocode, newPseudocode };
}

function summarizeLinesToConceptualSteps(lines: string[], type: 'add' | 'delete'): string[] {
  if (lines.length === 0) return [];

  const steps: string[] = [];
  const joined = lines.join('\n');

  // 1. Check for Batch Registration Pattern: e.g. GasTypeRegistry.RegisterAbilityAsset(...)
  const regMatches = lines.filter((l) => /Register.*Asset|Register.*Ability|Register\w+\(/.test(l));
  if (regMatches.length >= 3) {
    steps.push(`📦 批量注册 ${regMatches.length} 项技能与玩法资产到类型注册表 (GasTypeRegistry)`);
  }

  // 2. Check for Object Instantiation with Initializers: e.g. (_, target) => new ServerHealDefinition { ... }
  const objInitMatch = joined.match(/(?:new\s+(\w+))\s*\{([^}]+)\}/s);
  if (objInitMatch) {
    const typeName = objInitMatch[1];
    const props = objInitMatch[2]
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith('//') && p.includes('='))
      .map((p) => p.split('=')[0].trim());

    const mainProps = props.slice(0, 4).join('、');
    steps.push(
      `⚡ 创建并配置「${typeName}」对象（包含 ${props.length} 项属性：${mainProps}${props.length > 4 ? ' 等' : ''}）`
    );
  } else {
    // Check for lambda / constructor without full block match
    const lambdaMatch = lines.find((l) => /=>\s*new\s+(\w+)/.test(l));
    if (lambdaMatch) {
      const match = lambdaMatch.match(/=>\s*new\s+(\w+)/);
      steps.push(`⚡ 创建「${match ? match[1] : '对象'}」新实例并绑定到回调委托`);
    }
  }

  // 3. Check for multiple Property Assignments (if not already captured by object init)
  const propAssigns = lines.filter((l) => /^\s*(\w+)\s*=\s*(.+)[,;]?$/.test(l.trim()) && !l.includes('=>') && !l.includes('function') && !l.includes('class'));
  if (propAssigns.length > 0 && !objInitMatch) {
    if (propAssigns.length === 1) {
      const p = propAssigns[0].trim().match(/^(\w+)\s*=\s*(.+)[,;]?$/);
      if (p) {
        steps.push(`🔹 设置【${p[1]}】= ${cleanValue(p[2])}`);
      }
    } else {
      const propNames = propAssigns.map((p) => p.trim().split('=')[0].trim()).slice(0, 4).join('、');
      steps.push(`🔹 调整 ${propAssigns.length} 项属性字段赋值 (${propNames}${propAssigns.length > 4 ? ' 等' : ''})`);
    }
  }

  // 4. Check for Method Calls (excluding batch registrations)
  const methodCalls = lines.filter((l) => /^\s*([\w\.]+)\(/.test(l.trim()) && !regMatches.includes(l));
  if (methodCalls.length > 0 && methodCalls.length <= 3) {
    methodCalls.forEach((mc) => {
      const m = mc.trim().match(/^([\w\.]+)\((.*)\)[,;]?$/);
      if (m) {
        steps.push(`⚙️ 调用方法「${m[1]}」${m[2] ? `(参数: ${m[2].trim().slice(0, 30)})` : ''}`);
      }
    });
  } else if (methodCalls.length > 3) {
    steps.push(`⚙️ 执行 ${methodCalls.length} 处方法调用逻辑`);
  }

  // 5. Control Flow & Defensive Checks
  const ifConditions = lines.filter((l) => /^\s*if\s*\(/.test(l.trim()));
  if (ifConditions.length > 0) {
    ifConditions.forEach((c) => {
      const cond = c.trim().replace(/^if\s*\(/, '').replace(/\)[\s\{]*$/, '');
      steps.push(`❓ 条件判断：当满足【${cond}】时执行处理`);
    });
  }

  const loops = lines.filter((l) => /^\s*(foreach|for|while)\s*\(/.test(l.trim()));
  if (loops.length > 0) {
    loops.forEach((lp) => {
      steps.push(`🔁 循环逻辑：${lp.trim().replace(/\{$/, '')}`);
    });
  }

  // 6. Usings / Imports
  const importLines = lines.filter((l) => /^\s*(using|import)\s+/.test(l.trim()));
  if (importLines.length > 0) {
    if (importLines.length === 1) {
      steps.push(`📦 引入模块：${importLines[0].trim().replace(/^(using|import)\s+/, '').replace(/;$/, '')}`);
    } else {
      steps.push(`📦 调整引入 ${importLines.length} 个命名空间与依赖模块`);
    }
  }

  // 7. Returns / Throws
  const returnLines = lines.filter((l) => /^\s*return\b/.test(l.trim()));
  if (returnLines.length > 0) {
    returnLines.forEach((r) => {
      const val = r.trim().replace(/^return\s*/, '').replace(/;$/, '');
      steps.push(`↩️ 返回：${val || 'void'}`);
    });
  }

  // Fallback if no specific pattern matched
  if (steps.length === 0) {
    const meaningfulLines = lines.filter((l) => {
      const t = l.trim();
      return t && t !== '{' && t !== '}' && t !== '},' && t !== '});' && !t.startsWith('//');
    });
    if (meaningfulLines.length > 0) {
      steps.push(`📝 包含 ${meaningfulLines.length} 行代码逻辑调整：${meaningfulLines[0].trim().slice(0, 50)}`);
    } else {
      steps.push(`📝 代码块结构与格式微调 (${lines.length} 行)`);
    }
  }

  return steps;
}

function cleanValue(val: string): string {
  const v = val.trim().replace(/[,;]$/, '');
  if (v === 'false') return '关闭/否 (false)';
  if (v === 'true') return '开启/是 (true)';
  if (v === 'null') return '空 (null)';
  return v.length > 30 ? `${v.slice(0, 30)}...` : v;
}
