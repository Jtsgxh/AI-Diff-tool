import { diffChars, diffLines, diffWordsWithSpace, type Change } from 'diff';

export interface GhostEdit { start: number; end: number; text: string }

/** 将连续增删归为独立编辑，偏移始终对应当前真实文本。 */
function changeEdits(changes: Change[]): GhostEdit[] {
  let offset = 0;
  let edit: GhostEdit | undefined;
  const edits: GhostEdit[] = [];
  for (const change of changes) {
    if (!change.added && !change.removed) {
      if (edit) { edits.push(edit); edit = undefined; }
      offset += change.value.length;
    } else {
      edit ||= { start: offset, end: offset, text: '' };
      if (change.removed) { edit.end += change.value.length; offset += change.value.length; }
      else edit.text += change.value;
    }
  }
  if (edit) edits.push(edit);
  return edits;
}

/** 差异计算超时后用线性首尾匹配降级，避免复杂文件阻塞扩展宿主。 */
function trimEdit(current: string, target: string): GhostEdit | undefined {
  let start = 0;
  while (start < current.length && start < target.length && current.codePointAt(start) === target.codePointAt(start)) {
    start += current.codePointAt(start)! > 0xffff ? 2 : 1;
  }
  if (start === current.length && start === target.length) return;
  let suffix = 0;
  while (suffix < current.length - start && suffix < target.length - start &&
    current[current.length - suffix - 1] === target[target.length - suffix - 1]) suffix++;
  // 不把 UTF-16 代理对拆成半个字符，偏移始终可以交给原生文档定位。
  const boundary = current.charCodeAt(current.length - suffix);
  if (boundary >= 0xdc00 && boundary <= 0xdfff) suffix--;
  return { start, end: current.length - suffix, text: target.slice(start, target.length - suffix) };
}

/** 先按行定位再按字符细化，返回当前真实文本距目标最近的一处待跟写内容。 */
export function nextGhostEdit(current: string, target: string): GhostEdit | undefined {
  return ghostEdits(current, target)[0];
}

/** 标出所有新增的位置，包括注释、表达式中的行内补写。 */
export function ghostInsertionEdits(current: string, target: string): GhostEdit[] {
  return ghostEdits(current, target).filter(edit => edit.start === edit.end && edit.text);
}

/** 提前找出全文件待删除或替换的旧内容，不受第一处新增虚影的位置限制。 */
export function ghostRemovalEdits(current: string, target: string): GhostEdit[] {
  return ghostEdits(current, target).filter(edit => edit.end > edit.start);
}

/** 统一计算有序差异，虚影、定位、增删标记必须使用同一份坐标及操作，避免漏掉行内改动。 */
export function ghostEdits(current: string, target: string): GhostEdit[] {
  if (current === target) return [];
  const lines = diffLines(current, target, { timeout: 25 });
  if (!lines) {
    const edit = trimEdit(current, target);
    return edit ? [edit] : [];
  }
  const edits: GhostEdit[] = [];
  const deadline = Date.now() + 25;
  for (const block of changeEdits(lines)) {
    if (block.start === block.end || !block.text) { edits.push(block); continue; }
    const before = current.slice(block.start, block.end);
    // 多行先按词对齐已写代码，既保护正确参数，也避免借用旧方法内部的零散字符。
    const multiline = /[\r\n]/.test(before.replace(/(?:\r\n|\r|\n)$/, ''));
    const remaining = deadline - Date.now();
    const changes = remaining > 0 ? (multiline ? diffWordsWithSpace : diffChars)(before, block.text, { timeout: Math.min(20, remaining) }) : undefined;
    const fallback = changes ? undefined : trimEdit(before, block.text);
    for (const edit of changes ? changeEdits(changes) : fallback ? [fallback] : []) {
      const budget = deadline - Date.now();
      // 词级替换继续细化到实际错误字符，缩进差异不能把整行已写参数标成待删除。
      const detail = multiline && edit.text && budget > 0 ? diffChars(before.slice(edit.start, edit.end), edit.text, { timeout: Math.min(20, budget) }) : undefined;
      if (detail) {
        for (const part of changeEdits(detail)) {
          edits.push({ start: block.start + edit.start + part.start, end: block.start + edit.start + part.end, text: part.text });
        }
      } else edits.push({ start: block.start + edit.start, end: block.start + edit.end, text: edit.text });
    }
  }
  // 字符匹配可能借用原有右括号，把一次连续补写拆成“表达式前半段”和一个右括号。
  // 仅当重排后的文本完全相等时合并相邻插入，保留原有括号并一次显示完整补写片段。
  const normalized: GhostEdit[] = [];
  for (const edit of edits) {
    const previous = normalized.at(-1);
    if (previous && previous.start === previous.end && edit.start === edit.end) {
      const gap = current.slice(previous.end, edit.start);
      const combined = previous.text + gap + edit.text;
      if (gap.length <= 16 && /^[)\]}; \t]*$/.test(gap) && combined.endsWith(gap)) {
        previous.text = gap.length ? combined.slice(0, -gap.length) : combined;
        continue;
      }
    }
    normalized.push({ ...edit });
  }
  return normalized;
}
