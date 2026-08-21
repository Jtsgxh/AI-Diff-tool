/**
 * Fast Rule-Based Natural Language / Pseudocode Line Converter
 * Converts raw syntax into clear, human-readable natural language pseudocode.
 */

export function codeLineToPseudocode(line: string): string {
  if (!line || !line.trim()) return line;

  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '';
  const trimmed = line.trim();

  // 1. Comments
  if (trimmed.startsWith('//') || trimmed.startsWith('///')) {
    const commentText = trimmed.replace(/^\/\/\/?\s*/, '');
    return `${indent}💬 注释: ${commentText}`;
  }
  if (trimmed.startsWith('/*') || trimmed.startsWith('*')) {
    const commentText = trimmed.replace(/^\/\*+\s*|\*+\/\s*$|^\*\s*/, '');
    return `${indent}💬 ${commentText}`;
  }

  // 2. Namespace / Usings / Imports
  if (/^using\s+([\w\.]+);?$/.test(trimmed)) {
    const ns = trimmed.replace(/^using\s+/, '').replace(/;$/, '');
    return `${indent}📦 引入命名空间: ${ns}`;
  }
  if (/^import\s+.*from\s+['"].*['"]/.test(trimmed) || /^import\s+['"].*['"]/.test(trimmed)) {
    return `${indent}📦 引入外部模块: ${trimmed.replace(/^import\s+/, '')}`;
  }
  if (/^namespace\s+([\w\.]+)/.test(trimmed)) {
    const ns = trimmed.replace(/^namespace\s+/, '').replace(/[\{\s;]*$/, '');
    return `${indent}🏷️ 属于命名空间: ${ns}`;
  }

  // 3. Class / Interface / Struct definitions
  const classMatch = trimmed.match(/^(public|private|protected|internal|static|abstract|sealed|\s)*\s*(class|interface|struct|record|enum)\s+(\w+)(?:\s*:\s*([\w\s,<>]+))?/);
  if (classMatch) {
    const kind = classMatch[2];
    const name = classMatch[3];
    const base = classMatch[4] ? ` (继承/实现: ${classMatch[4].trim()})` : '';
    const kindCn = kind === 'class' ? '类' : kind === 'interface' ? '接口' : kind === 'struct' ? '结构体' : kind === 'enum' ? '枚举' : '记录类型';
    return `${indent}🏛️ 定义${kindCn}「${name}」${base}`;
  }

  // 4. Property Assignment inside object initializers: e.g. "AbilityName = Data.AbilityAsset.UniqueName,"
  const propInitMatch = trimmed.match(/^(\w+)\s*=\s*(.+?)([,;]?)$/);
  if (propInitMatch && !trimmed.startsWith('if') && !trimmed.startsWith('for') && !trimmed.startsWith('while') && !trimmed.startsWith('return')) {
    const propName = propInitMatch[1];
    let val = propInitMatch[2].trim();
    val = translateValue(val);
    const propLabel = translatePropName(propName);
    return `${indent}🔹 赋值 ${propLabel} (${propName}) ➔ ${val}`;
  }

  // 5. Lambda & Instantiation: e.g. "(_, target) => new ServerHealDefinition"
  const lambdaNewMatch = trimmed.match(/^\(?([\w\s,_\*\&]*)\)?\s*=>\s*new\s+(\w+)(.*)$/);
  if (lambdaNewMatch) {
    const params = lambdaNewMatch[1].trim() || '无参';
    const typeName = lambdaNewMatch[2];
    return `${indent}⚡ 传入回调 (${params}) ➔ 创建新对象「${typeName}」`;
  }

  // 6. Direct Instantiation: e.g. "new ServerHealDefinition {" or "var x = new List<int>();"
  const varNewMatch = trimmed.match(/^(?:var|[\w<>]+)\s+(\w+)\s*=\s*new\s+(\w+)(.*);?$/);
  if (varNewMatch) {
    const varName = varNewMatch[1];
    const typeName = varNewMatch[2];
    return `${indent}✨ 实例化「${typeName}」并存入变量【${varName}】`;
  }

  // 7. Method Calls: e.g. "OperationFactory.Heal("BattleAuraHeal"," or "GasTypeRegistry.RegisterAbilityAsset(...)"
  const methodCallMatch = trimmed.match(/^([\w\.]+)\((\s*.*)$/);
  if (methodCallMatch) {
    const callTarget = methodCallMatch[1];
    const restArgs = methodCallMatch[2].replace(/;$/, '');
    return `${indent}⚙️ 调用方法「${callTarget}」${restArgs ? `(参数: ${restArgs.replace(/,$/, '')})` : ''}`;
  }

  // 8. Control Flow (if / else / for / foreach / return / throw)
  if (trimmed.startsWith('if ') || trimmed.startsWith('if(')) {
    const cond = trimmed.replace(/^if\s*\(/, '').replace(/\)\s*\{?$/, '');
    return `${indent}❓ 如果满足条件【${cond}】：`;
  }
  if (trimmed.startsWith('else if ') || trimmed.startsWith('else if(')) {
    const cond = trimmed.replace(/^else\s+if\s*\(/, '').replace(/\)\s*\{?$/, '');
    return `${indent}❓ 否则如果满足条件【${cond}】：`;
  }
  if (trimmed === 'else' || trimmed === 'else {') {
    return `${indent}🔄 否则执行其他情况：`;
  }
  if (trimmed.startsWith('return ') || trimmed === 'return;' || trimmed.startsWith('return(')) {
    const retVal = trimmed.replace(/^return\s*/, '').replace(/;$/, '');
    return `${indent}↩️ 返回结果：${retVal || '空 (void)'}`;
  }
  if (trimmed.startsWith('throw new ') || trimmed.startsWith('throw ')) {
    return `${indent}💥 抛出异常错误：${trimmed.replace(/^throw\s+(new\s+)?/, '')}`;
  }
  if (trimmed.startsWith('foreach ') || trimmed.startsWith('foreach(')) {
    return `${indent}🔁 循环遍历集合：${trimmed}`;
  }
  if (trimmed.startsWith('for ') || trimmed.startsWith('for(')) {
    return `${indent}🔁 计数循环：${trimmed}`;
  }

  // 9. Bracket lines
  if (trimmed === '{') return `${indent}┌ 开始代码块：`;
  if (trimmed === '}' || trimmed === '},' || trimmed === '};') return `${indent}└ 结束代码块`;
  if (trimmed === '})' || trimmed === '});' || trimmed === '}),') return `${indent}└ 结束对象构造与方法调用`;

  // Fallback: Return formatted line with subtle prefix if it contains code
  return `${indent}${trimmed}`;
}

function translateValue(val: string): string {
  if (val === 'false') return '否 (false)';
  if (val === 'true') return '是 (true)';
  if (val === 'null') return '空值 (null)';
  if (val === '1f' || val === '1.0f' || val === '1') return '数值 1.0 (基准乘数)';
  if (val === '0f' || val === '0.0f' || val === '0') return '数值 0';
  if (/^"([^"]*)"$/.test(val)) return `字符串 "${val.slice(1, -1)}"`;
  if (val.startsWith('ServerCombatStatType.')) {
    return `战斗属性枚举【${val.replace('ServerCombatStatType.', '')}】`;
  }
  if (val.startsWith('ServerAbilityTags.')) {
    return `技能标签【${val.replace('ServerAbilityTags.', '')}】`;
  }
  if (val.startsWith('Data.AbilityAsset.')) {
    return `配置资产数据 ➔ ${val.replace('Data.AbilityAsset.', '')}`;
  }
  return val;
}

function translatePropName(name: string): string {
  const map: Record<string, string> = {
    AbilityName: '技能唯一名称',
    HealTag: '治疗类型标签',
    BaseValue: '基础数值/初值',
    HealBaseValue: '基础治疗量',
    HealScaling: '治疗缩放系数',
    CoefA: '核心加成系数 A',
    CoefB: '核心加成系数 B',
    StatA: '关联战斗属性类型',
    CanCrit: '是否允许暴击',
    MinRandomFactor: '最小随机浮动',
    MaxRandomFactor: '最大随机浮动',
    Sequence: '执行动画/动作序列',
    BattleSeedOverride: '战斗随机种子覆盖',
    EventTags: '关联事件标签集',
    hitFilters: '命中目标过滤器',
    target: '目标对象',
    context: '运行上下文',
    config: '配置参数',
  };
  return map[name] || name;
}
